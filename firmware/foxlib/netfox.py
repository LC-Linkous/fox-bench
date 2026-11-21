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
# The radio stacks first, before anything else is compiled: on the ESP32-C3 the Python heap grows into the same RAM
# the Wi-Fi driver (esp_wifi_init, run by `import wifi`) and the BLE stack need, and foxlib's own modules fill it.
# Imported here they take their share while the heap is small; _radios() below finds them already loaded.
for _m in ("wifi", "_bleio"):
    try:
        __import__(_m)
    except Exception:
        pass
from . import netcfg, netradio, led, netfeatures, netvary, netmodes, guard

try:
    __version__ = open(__file__.rsplit("/", 1)[0] + "/VERSION").read().strip()
except Exception:
    __version__ = "0"

WATCHDOG_S = 90           # the hardware watchdog while the fox runs: a hang (the SoC's radio stack, a stuck console)
                          # resets the board instead of ending the hunt; safemode.py brings it back (guard.py)
DEEP_SLEEP_MARGIN_S = 60  # with schedule.sleep = deep the timeout covers the sleep too: a nordic watchdog in RESET mode
                          # cannot be stopped and keeps counting through System ON sleep (espressif's task watchdog
                          # does stop; guard.disarm() before the sleep is for it)


def watchdog_s(cfg):
    """The watchdog timeout for this schedule: WATCHDOG_S, or long enough to sleep through where the sleep is deep
    (the sleep, stealth's jitter on it, and a margin)."""
    s = cfg["schedule"]
    if s.get("sleep") != "deep":
        return WATCHDOG_S
    st = cfg.get("stealth") or {}
    return max(WATCHDOG_S, int(s["sleep_s"]) + int(st.get("duty_jitter_s") or 0) + DEEP_SLEEP_MARGIN_S)


def trace_on():
    """FOX_TRACE in settings.toml (the Deploy tab's 'Trace the boot', or hw_smoke --trace): every init step is printed
    before the banner, so a board that hangs on the way up says where. Off by default: nothing before the banner."""
    try:
        import os
        return bool(os.getenv("FOX_TRACE"))
    except Exception:
        return False


def _free():
    try:
        import gc
        gc.collect()
        return str(gc.mem_free())
    except Exception:
        return "?"


def _trace(step):
    try:
        import gc
        print("init: %s (free %d)" % (step, gc.mem_free()))
    except Exception:
        print("init: %s" % step)


class Tx:
    """What a template body gets per cycle."""

    def __init__(self, fox, cycle):
        self.fox = fox
        self.cycle = cycle
        self.name = fox.radio.name if fox.radio is not None else fox.name      # the payload feature may change it per cycle

    def beacon(self, seconds=None):
        """Radio up for the wake time (or `seconds`), then down."""
        fox = self.fox
        radio = fox.radio
        s = seconds if seconds is not None else (fox.override_wake_s or fox.cfg["schedule"]["wake_s"])
        pattern = "tx" if fox.cfg["led"]["enabled"] else None
        end = time.monotonic_ns() + int(s * 1e9)     # the wake includes the start (a probing station's first round)
        try:
            radio.up()
        except Exception as e:
            # a radio that would not start this once (a driver hiccup, a value this chip refuses) costs the wake, not
            # the fox: said, silent for the wake, tried again at the next one
            fox.log("%s did not start (%s: %s); silent this wake" % (radio.kind, e.__class__.__name__, str(e)[:60]))
            try:
                radio.down()
            except Exception:
                pass
            fox.led.hold(s * 1000, "fatal" if pattern else None)
            return
        fox.log("%s up: %s (%s) for %d s" % (radio.kind, self.name, radio.mac(), s))
        fox._radio_notes(radio)
        fox._run_hooks("on_up", self.cycle)
        keep = getattr(radio, "keep", None)          # a probing station sends a round of probes per call (netradio)
        if keep:
            # round after round until the wake is over, the features ticking in between (a round takes ~2 s)
            fox.led.set(bool(pattern))
            while not fox.done:
                left = (end - time.monotonic_ns()) / 1e9
                if left < 0.5 or fox.radio is not radio or not radio.is_up:
                    break
                t0 = time.monotonic_ns()
                fox._run_hooks("while_up", self.cycle)
                keep(min(2, left))
                guard.feed()
                if time.monotonic_ns() - t0 < 200000000:
                    fox.led.hold(200, None)          # a round that returned at once must not spin
            left = (end - time.monotonic_ns()) // 1000000
            if left > 0 and not fox.done:
                fox.led.hold(left, None)
            fox.led.set(False)
        elif fox.hooks["while_up"]:
            # features that work while the radio is up get a tick every fox.tick_ms (1 s; a portal asks for 50 ms, and
            # then the LED is simply on for the window: a blink pattern cannot be sliced that fine)
            tick = fox.tick_ms
            if tick < 1000 and pattern:
                fox.led.set(True)
                pattern = None
            while time.monotonic_ns() < end and not fox.done:
                fox.led.hold(min(tick, max(1, (end - time.monotonic_ns()) // 1000000)), pattern)
                fox._run_hooks("while_up", self.cycle)
            fox.led.set(False)
        else:
            fox.led.hold(s * 1000, pattern)
        radio.down()
        fox.log("%s down" % radio.kind)


class NetFox:
    def __init__(self, path="fox.json", defaults="defaults.json", version="?", quiet=False):
        self.quiet = quiet
        if quiet:
            guard.disarm()        # a bench session: never under a watchdog a previous code.py may have armed (as Fox does)
        self.template_version = version
        self.board_id = getattr(board, "board_id", "unknown")
        self.uid = "".join("%02x" % b for b in microcontroller.cpu.uid)
        self.trace = trace_on() and not quiet
        t = _trace if self.trace else (lambda step: None)
        try:
            import gc
            gc.collect()                   # the import garbage goes before the radio takes the heap it needs
        except Exception:
            pass
        t("start %s" % self.board_id)
        self.workflow_note = self._quiet_workflow()      # CircuitPython's own BLE advertising off while the fox runs
        t("ble workflow %s" % ("switched off" if self.workflow_note else "already off"))
        self.radios = self._radios()
        t("radios %s" % ",".join(self.radios))
        self.cfg, self.report = netcfg.load(path, defaults, self.board_id, self.radios, dir(board))
        t("config %s" % (self.report.fatal or "ok"))
        self.fatal = self.report.fatal
        self.radio = None
        self.led = led.Status(None)
        self.name = ""
        self.woke_from_sleep = self._woke()
        t("alarm %s" % ("woke" if self.woke_from_sleep else "cold"))
        self.features = []
        self.unbuilt = []
        self.hooks = {"before_up": [], "on_up": [], "while_up": [], "after_down": []}
        self.tick_ms = 1000
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
        self.hooks = {"before_up": [], "on_up": [], "while_up": [], "after_down": []}     # the contest features register here
        self.failed_features = []            # [(section, exception name)]: built, but would not load or attach here
        self.skip = None                     # a feature (sense) may keep this wake off the air: the reason, logged
        self.done = None                     # a feature (checkpoint stop) ends the fox's day: the reason; radio off for good
        self.override_wake_s = None          # a feature (stealth jitter) may set this cycle's timing in before_up
        self.override_sleep_s = None
        self._mac_said = set()
        t("led %s" % ("on" if self.led.pin is not None else "none"))
        if not self.fatal:
            try:
                t("radio %s setup" % c["net"]["kind"])
                self.radio = netradio.make(c["net"], self.name)
                self.radio.setup()
                t("radio %s" % self.radio.status)
            except Exception as e:
                self.fatal = "hardware(%s:%s)" % (e.__class__.__name__, str(e).replace(" ", "_")[:40])
        if not self.fatal:
            t("features %s" % ",".join(self.features))
            self.unbuilt = netfeatures.attach(self)          # features without firmware yet, named once in the banner
            st = c.get("stealth") or {}
            if st.get("enabled") and st.get("modes"):
                netmodes.attach(self)                        # the radio kind per wake (phase H)
            if netvary.wanted(c):
                netvary.attach(self)                         # channel / probe-list / power draws per wake (phase G)
            t("features attached")
        else:
            self.unbuilt = []
        self._banner()

    @staticmethod
    def _quiet_workflow():
        """CircuitPython's BLE workflow advertises the board as CIRCUITPYxxxx: always on builds without native USB
        (espressif: CIRCUITPY_USB_DEVICE = 0, so the board boots in discovery mode), and on the others after a
        double-tap reset. It keeps the BLE stack busy beside the fox's own radio and gives the board away to any
        scanner. Switched off for this run (supervisor.runtime.ble_workflow; back at the next reset) and any
        advertising already running is stopped. Returns a note for the banner when it was on, None otherwise."""
        try:
            import supervisor
            if not supervisor.runtime.ble_workflow:
                return None
            supervisor.runtime.ble_workflow = False
        except Exception:
            return None
        try:
            import _bleio
            _bleio.adapter.stop_advertising()
        except Exception:
            pass
        return "CircuitPython's own BLE advertising (CIRCUITPYxxxx) is off while the fox runs"

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
        line += " mem=" + _free()           # the heap left after init: the number a marginal board (the ESP32-C3) is judged by
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
        if self.workflow_note:
            print("  note: %s" % self.workflow_note)
        for name, why in self.failed_features:
            print("** %s failed to load on this board (%s): the fox runs without it **" % (name, why))
        n = guard.resets()
        if n and not self.woke_from_sleep:
            print("  note: %d safe-mode reset%s since the last completed wake (brownout; see safemode.py)" % (n, "" if n == 1 else "s"))
        if self.woke_from_sleep:
            print("woke from deep sleep")

    # ---- the loop
    def cycles(self):
        """One Tx per wake. Between wakes: sleep_s with the radio off (schedule.sleep = off), or deep sleep (= deep),
        from which the board reboots into this loop again -- the cycle count then restarts at 0."""
        c = self.cfg
        if self.fatal or not self.radio or not self.radio.status.startswith("ok"):
            self.log("unconfigured (%s): silent" % (self.fatal or (self.radio.status if self.radio else "no radio")))
            while True:
                self.led.hold(20000, "fatal")
            return
        n = 0
        self.log("watchdog %s" % guard.arm(watchdog_s(self.cfg)))
        try:
            while True:
                guard.feed()
                self.log("cycle %d" % n)
                self.override_wake_s = self.override_sleep_s = None
                self.skip = None
                self._run_hooks("before_up", n)
                if self.done:
                    self._run_hooks("after_down", n)
                    self._finish()
                if self.skip:
                    wake_s = self.override_wake_s or c["schedule"]["wake_s"]
                    self.log("silent this wake (%s)" % self.skip)
                    self.led.hold(wake_s * 1000, "armed" if c["led"]["enabled"] else None)
                else:
                    yield Tx(self, n)
                self._run_hooks("after_down", n)
                if self.done:
                    self._finish()
                guard.healthy()                      # a wake completed: clear safemode.py's consecutive-reset count
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

    def _finish(self):
        """The 'done' state (checkpoint.stop_at): radio off until power-cycled, LED 'done'."""
        try:
            self.radio.down()
        except Exception:
            pass
        self.log("done: %s; off the air until power-cycled" % self.done)
        while True:
            self.led.hold(60000, "done" if self.cfg["led"]["enabled"] else None)

    def _radio_notes(self, radio):
        """Once each: what the radio did differently from the config, and a MAC that is not the configured one."""
        for note in radio.take_notes():
            self.log("  note: %s" % note)
        want, got = radio.wanted_mac(), radio.mac()
        if want and got != want and (radio.kind, want) not in self._mac_said:
            self._mac_said.add((radio.kind, want))
            self.log("  note: MAC %s was asked for, the radio reports %s%s" % (want, got, (" (%s)" % radio.mac_error) if radio.mac_error else ""))

    def _run_hooks(self, name, cycle):
        for fn in self.hooks.get(name, ()):
            try:
                fn(self, cycle)
            except Exception as e:
                self.log("%s hook failed: %s" % (name, e.__class__.__name__))

    def _deep_sleep(self, seconds):
        import alarm
        guard.disarm()                       # a RESET watchdog must not fire into the sleep
        self.deinit()
        a = alarm.time.TimeAlarm(monotonic_time=time.monotonic() + seconds)
        alarm.exit_and_deep_sleep_until_alarms(a)

    # ---- bench (the page's Bench tab: the same names Fox has)
    def key_for(self, seconds):
        """Radio up for `seconds`: the net fox's key test."""
        if not self.radio or not self.radio.status.startswith("ok"):
            return "err: radio %s" % (self.radio.status if self.radio else "none")
        self.radio.up()
        mac = self.radio.mac()               # read back while up: the address this radio is on the air with
        time.sleep(seconds)
        self.radio.down()
        return "ok %s %s (%s) for %.1f s" % (self.radio.kind, self.name, mac, seconds)

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
