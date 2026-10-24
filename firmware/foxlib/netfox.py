# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netfox.py -- the runner for network foxes: the SoC's own radio on a duty cycle.
#
#   from foxlib.netfox import NetFox
#   fox = NetFox("fox.json", defaults="defaults.json", version="1.0.0")
#   for tx in fox.cycles():
#       tx.beacon()          # radio up for schedule.wake_s, then down for schedule.sleep_s (or deep sleep)
#
# Same banner shape as Fox (the page's Listen only parses it the same way), same log style, same bench entry points
# (key_for, rssi) so the Bench tab works unchanged. quiet=True for bench use from the REPL: no banner, nothing on air.
import time
import board
import microcontroller
from . import netcfg, netradio, led

try:
    __version__ = open(__file__.rsplit("/", 1)[0] + "/VERSION").read().strip()
except Exception:
    __version__ = "0"


class Tx:
    """What a template body gets per cycle."""

    def __init__(self, fox, cycle):
        self.fox = fox
        self.cycle = cycle
        self.name = fox.name

    def beacon(self, seconds=None):
        """Radio up for the wake time (or `seconds`), then down."""
        s = seconds if seconds is not None else self.fox.cfg["schedule"]["wake_s"]
        self.fox.radio.up()
        self.fox.log("%s up: %s (%s) for %d s" % (self.fox.radio.kind, self.name, self.fox.radio.mac(), s))
        self.fox.led.hold(s * 1000, "tx" if self.fox.cfg["led"]["enabled"] else None)
        self.fox.radio.down()
        self.fox.log("%s down" % self.fox.radio.kind)


class NetFox:
    def __init__(self, path="fox.json", defaults="defaults.json", version="?", quiet=False):
        self.quiet = quiet
        self.template_version = version
        self.board_id = getattr(board, "board_id", "unknown")
        self.uid = "".join("%02x" % b for b in microcontroller.cpu.uid)
        self.radios = self._radios()
        self.cfg, self.report = netcfg.load(path, defaults, self.board_id, self.radios)
        self.fatal = self.report.fatal
        self.radio = None
        self.led = led.Status(None)
        self.name = ""
        self.woke_from_sleep = self._woke()
        if self.cfg is None:
            self.id_ok = False
            self._banner()
            return
        c = self.cfg
        try:
            pin = getattr(board, "LED", None)
            self.led = led.Status(pin if c["led"]["enabled"] else None)
        except Exception:
            self.led = led.Status(None)
        self.id_ok = netcfg.id_ok(c)
        self.name = netcfg.display_name(c)
        if not self.fatal:
            try:
                self.radio = netradio.make(c["net"], self.name)
                self.radio.setup()
            except Exception as e:
                self.fatal = "hardware(%s:%s)" % (e.__class__.__name__, str(e).replace(" ", "_")[:40])
        self._banner()

    @staticmethod
    def _radios():
        """What this chip has, by what imports: the validator uses it for channel/band checks."""
        out = []
        try:
            import wifi  # noqa: F401
            out.append("wifi24")
        except ImportError:
            pass
        try:
            import _bleio  # noqa: F401
            out.append("ble")
        except ImportError:
            pass
        return out

    @staticmethod
    def _woke():
        try:
            import alarm
            return alarm.wake_alarm is not None
        except Exception:
            return False

    def deinit(self):
        for part in (self.radio, self.led):
            if part is not None:
                try:
                    part.deinit()
                except Exception:
                    pass
        self.radio = None

    # ---- output
    def log(self, text):
        if not self.quiet:
            print(text)

    def banner_line(self):
        c = self.cfg or {}
        net = c.get("net", {}) if c else {}
        return "FOX template=%s/%s foxlib=%s board=%s uid=%s cfg=%s radio=%s id=%s freq=none net=%s name=%s mac=%s" % (
            c.get("template", "?") if c else "?", self.template_version, __version__, self.board_id, self.uid,
            ("fatal(%s)" % self.fatal) if self.fatal else self.report.status(), (self.radio.status if self.radio else "skipped"),
            "set" if self.id_ok else "unset", net.get("kind", "?"), _quote(self.name), net.get("mac", "?"))

    def _banner(self):
        if self.quiet:
            return
        print("initializing system ... ")
        print(self.banner_line())
        for key, reason in self.report.items:
            print("  cfg: %s -> default (%s)" % (key, reason))
        if self.fatal:
            print("** fatal: %s -- staying silent **" % self.fatal)
        elif self.radio and self.radio.status.startswith("ok(hidden"):
            print("  note: this firmware cannot hide the SSID; it is broadcast")
        if self.woke_from_sleep:
            print("woke from deep sleep")

    # ---- the loop
    def cycles(self):
        """One Tx per wake. Between wakes: sleep_s with the radio off (schedule.sleep = off), or deep sleep (= deep),
        from which the board reboots into this loop again -- the cycle count then restarts at 0, as kitsune's does."""
        c = self.cfg
        if self.fatal or not self.radio or not self.radio.status.startswith("ok"):
            self.log("unconfigured (%s): silent" % (self.fatal or (self.radio.status if self.radio else "no radio")))
            while True:
                self.led.hold(20000, "fatal")
            return
        n = 0
        try:
            while True:
                self.log("cycle %d" % n)
                yield Tx(self, n)
                n += 1
                sleep_s = c["schedule"]["sleep_s"]
                if sleep_s <= 0:
                    continue
                if c["schedule"]["sleep"] == "deep":
                    self.log("deep sleep %d s" % sleep_s)
                    self._deep_sleep(sleep_s)
                    # a real board never gets here; the simulator does
                    n = 0
                else:
                    self.log("sleep %d s" % sleep_s)
                    self.led.hold(sleep_s * 1000, None)
        finally:
            if self.radio:
                self.radio.down()

    def _deep_sleep(self, seconds):
        import alarm
        self.deinit()
        a = alarm.time.TimeAlarm(monotonic_time=time.monotonic() + seconds)
        alarm.exit_and_deep_sleep_until_alarms(a)

    # ---- bench (the page's Bench tab: the same names Fox has)
    def key_for(self, seconds):
        """Radio up for `seconds`: the net fox's key test."""
        if not self.radio or not self.radio.status.startswith("ok"):
            return "err: radio %s" % (self.radio.status if self.radio else "none")
        self.radio.up()
        time.sleep(seconds)
        self.radio.down()
        return "ok %s %s for %.1f s" % (self.radio.kind, self.name, seconds)

    def rssi(self):
        """Not a receiver's RSSI: the strongest neighbours this radio can see, as a sanity check that it is alive."""
        if not self.radio:
            return "err: no radio"
        return " | ".join("%d %s" % (x[0], x[1]) for x in self.radio.scan()) or "nothing heard"


def _quote(s):
    return '"' + s.replace('"', "'") + '"' if " " in s or not s else s
