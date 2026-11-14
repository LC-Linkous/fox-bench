# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netstealth.py -- how hard a network fox is to find (the `stealth` section, phase C of
# docs/network-fox-payloads-plan.md).
#
#   rotate_mac     per-cycle: a new locally administered address every cycle; per-boot: one per power-up
#   rotate_name    the payload names drawn at random instead of in turn
#   duty_jitter_s  each wake and sleep lengthened or shortened by up to N s, at random
#   start          after_s: silent for N s after power-on; at: silent until a wall-clock time (the board clock, set by
#                  the page at deploy). Across deep sleep the fox remembers it has started (alarm.sleep_memory).
#   decoys         Wi-Fi: extra SSIDs the access point cycles through, a few seconds each, so the list shows several
#   ble_only       the Wi-Fi radio is never enabled (a split clue's Wi-Fi half is dropped)
#
# Random choices are seeded from the chip id and the cycle, so a fleet does not move in lockstep and the simulator
# is deterministic. No `random` module: CircuitPython's is optional on small boards; an LCG is enough here.
import time
import microcontroller

DECOY_HOLD_S = 3          # seconds on each SSID when decoys are on
ARMED_LED = "armed"
STARTED_MARK = 0xF0       # alarm.sleep_memory[0] once the fox has started (survives deep sleep, not a power cycle)


class Rng:
    """A small LCG: next() in [0, 2**31). Seeded from the chip uid and a salt."""

    def __init__(self, salt=0):
        seed = salt & 0x7FFFFFFF
        try:
            for b in microcontroller.cpu.uid:
                seed = (seed * 31 + b) & 0x7FFFFFFF
        except Exception:
            pass
        self.s = seed or 1

    def next(self):
        self.s = (1103515245 * self.s + 12345) & 0x7FFFFFFF
        return self.s

    def below(self, n):
        return self.next() % n if n > 0 else 0


def random_mac(rng):
    """Locally administered, unicast: first byte with bit 1 set and bit 0 clear."""
    b = [rng.below(256) for _ in range(6)]
    b[0] = (b[0] | 0x02) & 0xFE
    return ":".join("%02X" % x for x in b)


def parse_at(s):
    """'YYYY-MM-DDTHH:MM:SS[zone]' -> (Y, M, D, h, m, s); the zone is ignored (the board clock's zone is the page's)."""
    try:
        return (int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19]))
    except Exception:
        return None


def clock_tuple():
    try:
        import rtc
        t = rtc.RTC().datetime
        if t.tm_year < 2020:
            return None
        return (t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec)
    except Exception:
        return None


class Stealth:
    def __init__(self, fox):
        self.fox = fox
        self.cfg = fox.cfg["stealth"]
        self.rng = Rng(7)
        self.started = False
        self.boot_mac = None
        self.decoy_i = 0
        self.decoy_next = 0
        self.names = []           # the decoy rotation this cycle: [the name] + decoys

    # -- hooks
    def before_up(self, fox, cycle):
        c = self.cfg
        if not self.started:
            self._wait_for_start(fox)
        # a new address: per cycle, or once per boot
        if c["rotate_mac"] == "per-cycle" or (c["rotate_mac"] == "per-boot" and self.boot_mac is None):
            mac = random_mac(Rng(cycle * 7919 + 13)) if c["rotate_mac"] == "per-cycle" else random_mac(self.rng)
            if c["rotate_mac"] == "per-boot":
                self.boot_mac = mac
            if _set_mac(fox.radio, mac):
                fox.log("stealth: mac this cycle %s" % mac)
        # names drawn at random from the payload list
        pl = fox.cfg.get("payload")
        if c["rotate_name"] and pl and pl.get("enabled") and pl.get("kind") == "rotate" and pl.get("names"):
            pick = pl["names"][Rng(cycle * 104729 + 3).below(len(pl["names"]))]
            if pick != fox.radio.name:
                fox.radio.name = pick
                fox.log("stealth: name this cycle %s" % _q(pick))
        # timing jitter: this cycle's wake and sleep
        j = c["duty_jitter_s"]
        if j:
            r = Rng(cycle * 31337 + 5)
            dw, ds = r.below(2 * j + 1) - j, r.below(2 * j + 1) - j
            fox.override_wake_s = max(1, fox.cfg["schedule"]["wake_s"] + dw)
            fox.override_sleep_s = max(0, fox.cfg["schedule"]["sleep_s"] + ds)
            fox.log("stealth: this cycle wake %d s, sleep %d s" % (fox.override_wake_s, fox.override_sleep_s))
        # decoys: the access point walks through [name] + decoys while up
        if c["decoys"] and fox.radio.kind == "wifi-ap":
            self.names = [fox.radio.name] + list(c["decoys"])
            self.decoy_i = 0
            self.decoy_next = time.monotonic() + DECOY_HOLD_S

    def while_up(self, fox, cycle):
        if len(self.names) < 2 or fox.radio.kind != "wifi-ap":
            return
        now = time.monotonic()
        if now < self.decoy_next:
            return
        self.decoy_next = now + DECOY_HOLD_S
        self.decoy_i = (self.decoy_i + 1) % len(self.names)
        try:
            fox.radio.down()
            fox.radio.name = self.names[self.decoy_i]
            fox.radio.up()
        except Exception as e:
            fox.log("stealth: decoy switch failed (%s)" % e.__class__.__name__)

    def after_down(self, fox, cycle):
        if self.names:
            fox.radio.name = self.names[0]      # back to the real name for the next cycle's hooks
            self.names = []

    # -- the silent start
    def _wait_for_start(self, fox):
        c = self.cfg["start"]
        if _started_before():
            fox.log("stealth: already started before this deep sleep")
            self.started = True
            return
        waited = False
        if c["after_s"] > 0:
            fox.log("stealth: silent for %d s" % c["after_s"])
            self._hold(fox, c["after_s"])
            waited = True
        if c["at"]:
            at = parse_at(c["at"])
            now = clock_tuple()
            if at is None or now is None:
                fox.log("stealth: start.at %s but the board clock is %s; starting now" % (c["at"], "unset" if now is None else "unreadable"))
            else:
                fox.log("stealth: silent until %s (clock %s)" % (c["at"], "%04d-%02d-%02dT%02d:%02d:%02d" % now))
                while clock_tuple() is not None and clock_tuple() < at:
                    self._hold(fox, 5)
                waited = True
        if waited:
            fox.log("stealth: starting")
        self.started = True
        _mark_started()

    def _hold(self, fox, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            fox.led.hold(min(2000, max(1, int((end - time.monotonic()) * 1000))), ARMED_LED if fox.cfg["led"]["enabled"] else None)


def _set_mac(radio, mac):
    try:
        radio.cfg["mac"] = mac
        b = bytes(int(p, 16) for p in mac.split(":"))
        if radio.kind == "wifi-ap":
            radio.wifi.radio.mac_address_ap = b
        elif radio.kind == "wifi-probe":
            radio.wifi.radio.mac_address = b
        elif radio.kind == "ble":
            radio.adapter.address = radio._bleio.Address(b, radio._bleio.Address.RANDOM_STATIC)
        return True
    except Exception:
        return False


def _started_before():
    try:
        import alarm
        return alarm.wake_alarm is not None and alarm.sleep_memory[0] == STARTED_MARK
    except Exception:
        return False


def _mark_started():
    try:
        import alarm
        alarm.sleep_memory[0] = STARTED_MARK
    except Exception:
        pass


def attach(fox):
    s = Stealth(fox)
    c = s.cfg
    if c["ble_only"]:
        try:
            import wifi
            wifi.radio.enabled = False
            fox.log("stealth: BLE only; Wi-Fi radio off")
        except Exception:
            pass
        p = getattr(fox, "payload", None)
        if p is not None and p.second is not None and p.second.kind != "ble":
            p.second = None
            fox.log("stealth: BLE only; the split clue's Wi-Fi half is dropped")
    fox.hooks["before_up"].append(s.before_up)
    fox.hooks["while_up"].append(s.while_up)
    fox.hooks["after_down"].append(s.after_down)
    fox.stealth = s
    return s


def _q(x):
    return '"' + x + '"' if " " in x else x
