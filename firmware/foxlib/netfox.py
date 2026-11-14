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
from . import netcfg, netradio, led, netfeatures

try:
    __version__ = open(__file__.rsplit("/", 1)[0] + "/VERSION").read().strip()
except Exception:
    __version__ = "0"


class Tx:
    """What a template body gets per cycle."""

    def __init__(self, fox, cycle):
        self.fox = fox
        self.cycle = cycle
        self.name = fox.radio.name if fox.radio is not None else fox.name      # the payload feature may change it per cycle

    def beacon(self, seconds=None):
        """Radio up for the wake time (or `seconds`), then down."""
        s = seconds if seconds is not None else (self.fox.override_wake_s or self.fox.cfg["schedule"]["wake_s"])
        self.fox.radio.up()
        self.fox.log("%s up: %s (%s) for %d s" % (self.fox.radio.kind, self.name, self.fox.radio.mac(), s))
        pattern = "tx" if self.fox.cfg["led"]["enabled"] else None
        if self.fox.hooks["while_up"]:
            # features that work while the radio is up (a portal, a scan slot) get a tick every ~slot
            end = time.monotonic() + s
            while time.monotonic() < end:
                self.fox.led.hold(min(1000, max(1, int((end - time.monotonic()) * 1000))), pattern)
                self.fox._run_hooks("while_up", self.cycle)
        else:
            self.fox.led.hold(s * 1000, pattern)
        self.fox.radio.down()
        self.fox.log("%s down" % self.fox.radio.kind)


class NetFox:
    def __init__(self, path="fox.json", defaults="defaults.json", version="?", quiet=False):
        self.quiet = quiet
        self.template_version = version
        self.board_id = getattr(board, "board_id", "unknown")
        self.uid = "".join("%02x" % b for b in microcontroller.cpu.uid)
        self.radios = self._radios()
        self.cfg, self.report = netcfg.load(path, defaults, self.board_id, self.radios, dir(board))
        self.fatal = self.report.fatal
        self.radio = None
        self.led = led.Status(None)
        self.name = ""
        self.woke_from_sleep = self._woke()
        self.features = []
        self.unbuilt = []
        self.hooks = {"before_up": [], "while_up": [], "after_down": []}
        if self.cfg is None:
            self.id_ok = False
            self._banner()
            return
        c = self.cfg
        try:
            name = (c.get("pins") or {}).get("led")                 # the variant's LED pin; null = no LED on this board
            pin = getattr(board, name, None) if isinstance(name, str) else None
            self.led = led.Status(pin if (c["led"]["enabled"] and pin is not None) else None)
        except Exception:
            self.led = led.Status(None)
        self.id_ok = netcfg.id_ok(c)
        self.name = netcfg.display_name(c)
        self.features = netcfg.enabled_features(c)
        self.hooks = {"before_up": [], "while_up": [], "after_down": []}     # the contest features register here
        self.override_wake_s = None          # a feature (stealth jitter) may set this cycle's timing in before_up
        self.override_sleep_s = None
        if not self.fatal:
            try:
                self.radio = netradio.make(c["net"], self.name)
                self.radio.setup()
            except Exception as e:
                self.fatal = "hardware(%s:%s)" % (e.__class__.__name__, str(e).replace(" ", "_")[:40])
        if not self.fatal:
            self.unbuilt = netfeatures.attach(self)          # features without firmware yet, named once in the banner
        else:
            self.unbuilt = []
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

    def id_state(self):
        """set: a callsign is recorded. none: the placeholder, but the callsign is not the name on the air (a Part 15
        device need not identify; the fleet record is just empty). unset: the placeholder would be the name on the air."""
        if self.id_ok:
            return "set"
        c = self.cfg or {}
        return "unset" if (c.get("id") or {}).get("use_callsign_as_name") else "none"

    def banner_line(self):
        c = self.cfg or {}
        net = c.get("net", {}) if c else {}
        line = "FOX template=%s/%s foxlib=%s board=%s uid=%s cfg=%s radio=%s id=%s freq=none net=%s name=%s mac=%s" % (
            c.get("template", "?") if c else "?", self.template_version, __version__, self.board_id, self.uid,
            ("fatal(%s)" % self.fatal) if self.fatal else self.report.status(), (self.radio.status if self.radio else "skipped"),
            self.id_state(), net.get("kind", "?"), _quote(self.name), net.get("mac", "?"))
        if self.features:
            line += " features=" + ",".join(self.features)
        line += " clock=" + clock_text()
        return line

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
        for name in self.unbuilt:
            print("  note: %s is accepted but not in foxlib %s yet; the fox runs without it" % (name, __version__))
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
                self.override_wake_s = self.override_sleep_s = None
                self._run_hooks("before_up", n)
                yield Tx(self, n)
                self._run_hooks("after_down", n)
                n += 1
                sleep_s = c["schedule"]["sleep_s"] if self.override_sleep_s is None else self.override_sleep_s
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

    def _run_hooks(self, name, cycle):
        for fn in self.hooks.get(name, ()):
            try:
                fn(self, cycle)
            except Exception as e:
                self.log("%s hook failed: %s" % (name, e.__class__.__name__))

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


def clock_text():
    """The board's idea of now, ISO-ish, or 'unset' (CircuitPython boots at 2000-01-01 until something sets the RTC)."""
    try:
        import rtc
        t = rtc.RTC().datetime
        if t.tm_year < 2020:
            return "unset"
        return "%04d-%02d-%02dT%02d:%02d:%02d" % (t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec)
    except Exception:
        return "unset"


def _quote(s):
    return '"' + s.replace('"', "'") + '"' if " " in s or not s else s
