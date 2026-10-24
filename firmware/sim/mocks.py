# SPDX-License-Identifier: GPL-3.0-or-later
# sim/mocks.py -- fake CircuitPython hardware with a virtual clock.
# install(scenario) puts fake `board`, `microcontroller`, `digitalio`, `pwmio`,
# `busio`, `analogio` and a virtual `time` into sys.modules, and returns a
# Recorder holding everything the firmware did: tone events, PTT edges, UART
# traffic, LED edges, prints.
import sys
import types


ACTIVE = [True]   # set False by the runner after a run, so generator finalizers of a finished run cannot raise SimDone


class Reboot(BaseException):    # a deep sleep's wake: the runner starts code.py again, as the board does
    pass


class SimDone(BaseException):   # BaseException so the firmware's `except Exception` never swallows it
    pass


class Clock:
    def __init__(self, cap_ms):
        self.ns = 0
        self.cap_ns = int(cap_ms * 1e6)
        self.on_tick = None
        self.stop_requested = None   # set by the recorder (e.g. "unkeys"); raised at the next advance, never from inside a pin setter

    def advance(self, ns):
        self.ns += int(ns)
        if ACTIVE[0] and self.stop_requested:
            raise SimDone(self.stop_requested)
        if self.ns > self.cap_ns and ACTIVE[0]:
            raise SimDone("time cap")
        if self.on_tick:
            self.on_tick()


class Recorder:
    def __init__(self):
        self.tones = []        # (start_ms, end_ms, hz)
        self.ptt = []          # (t_ms, keyed_bool)
        self.led = []          # (t_ms, on_bool)
        self.uart = []         # (t_ms, line)
        self.prints = []
        self.retunes = []      # (t_ms, mhz, accepted)
        self._tone_hz = 0
        self._tone_start = 0
        self.stop_after_unkeys = None
        self.unkeys = 0

    def tone(self, t_ms, hz):
        if hz == self._tone_hz:
            return
        if self._tone_hz:
            self.tones.append((self._tone_start, t_ms, self._tone_hz))
        self._tone_hz = hz
        self._tone_start = t_ms

    def keyed_intervals(self):
        out, start = [], None
        for t, k in self.ptt:
            if k and start is None:
                start = t
            elif not k and start is not None:
                out.append((start, t))
                start = None
        if start is not None:
            out.append((start, None))
        return out


def install(scenario):
    """scenario: dict with keys module_ranges, battery (list of [t_s, volts]) or None,
    cap_ms, stop_after_unkeys, board_names, pin_roles (to know which pin is PTT/LED)."""
    clock = Clock(scenario.get("cap_ms", 600000))
    rec = Recorder()
    now_ms = lambda: clock.ns / 1e6

    # ---- time
    t = types.ModuleType("time")
    t.monotonic = lambda: clock.ns / 1e9
    def monotonic_ns():
        clock.advance(50_000)          # a call costs 50 us, so busy-waits terminate
        return clock.ns
    t.monotonic_ns = monotonic_ns
    def sleep(s):
        clock.advance(s * 1e9)
    t.sleep = sleep
    t.time = lambda: clock.ns / 1e9

    # ---- board
    class Pin:
        def __init__(self, name):
            self.name = name
        def __repr__(self):
            return "board." + self.name
    board = types.ModuleType("board")
    board.board_id = scenario.get("board_id", "seeed_xiao_esp32c3")
    for n in scenario.get("board_names", ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "A0", "A1", "A2", "A3", "TX", "RX"]):
        setattr(board, n, Pin(n))

    mc = types.ModuleType("microcontroller")
    mc.cpu = types.SimpleNamespace(uid=bytes(range(0x10, 0x18)))

    roles = scenario.get("pin_roles", {})
    ptt_name, led_name = roles.get("ptt", "D3"), roles.get("led", "D10")

    # CircuitPython refuses to claim a pin a second time until the first owner is deinit'ed (or collected).
    # The mocks do the same, so a second Fox in one VM without Fox.deinit() fails here as it does on the board.
    claimed = {}
    def claim(pin, owner):
        if pin is None:
            raise ValueError("pin is None")
        if pin.name in claimed:
            raise ValueError("%s in use" % pin.name)
        claimed[pin.name] = owner
    def release(pin):
        if pin is not None:
            claimed.pop(pin.name, None)

    # ---- digitalio
    dio = types.ModuleType("digitalio")
    class Direction:
        OUTPUT, INPUT = "out", "in"
    class DigitalInOut:
        def __init__(self, pin):
            claim(pin, self)
            self.pin = pin
            self.direction = Direction.INPUT
            self._v = False
        @property
        def value(self):
            return self._v
        @value.setter
        def value(self, v):
            v = bool(v)
            if self.pin.name == ptt_name and v != self._v:
                keyed = not v
                was_keyed = bool(rec.ptt) and rec.ptt[-1][1]
                rec.ptt.append((now_ms(), keyed))
                if not keyed and was_keyed:
                    rec.unkeys += 1
                    if rec.stop_after_unkeys and rec.unkeys >= rec.stop_after_unkeys:
                        clock.stop_requested = "unkeys"   # raised at the next time advance: a pin setter may be running in a finally/finalizer
            if self.pin.name == led_name and v != self._v:
                rec.led.append((now_ms(), v))
            self._v = v
        def deinit(self):
            release(self.pin)
    dio.Direction = Direction
    dio.DigitalInOut = DigitalInOut
    dio.Pull = types.SimpleNamespace(UP="up", DOWN="down")

    # ---- pwmio
    pwm = types.ModuleType("pwmio")
    class PWMOut:
        def __init__(self, pin, frequency=500, duty_cycle=0, variable_frequency=False):
            claim(pin, self)
            self.pin = pin
            self._f = frequency
            self._d = duty_cycle
            self.variable_frequency = variable_frequency
        @property
        def frequency(self):
            return self._f
        @frequency.setter
        def frequency(self, f):
            self._f = int(f)
            if self._d:
                rec.tone(now_ms(), self._f)
        @property
        def duty_cycle(self):
            return self._d
        @duty_cycle.setter
        def duty_cycle(self, d):
            self._d = d
            rec.tone(now_ms(), self._f if d else 0)
        def deinit(self):
            self.duty_cycle = 0
            release(self.pin)
    pwm.PWMOut = PWMOut

    # ---- busio.UART with a scripted DMO module
    ranges = scenario.get("module_ranges", [[134.0, 174.0]])
    bus = types.ModuleType("busio")
    class UART:
        def __init__(self, tx, rx, baudrate=9600, timeout=1.0, **kw):
            claim(tx, self); claim(rx, self)
            self._pins = (tx, rx)
            self._out = b""
        def deinit(self):
            for p in self._pins:
                release(p)
        def write(self, data):
            line = data.decode(errors="replace").strip()
            rec.uart.append((now_ms(), line))
            if scenario.get("module_silent"):
                return
            if line == "AT+DMOCONNECT":
                self._out += b"+DMOCONNECT:0\r\n"
            elif line.startswith("AT+DMOSETGROUP="):
                mhz = float(line.split("=")[1].split(",")[1])
                ok = any(lo <= mhz <= hi for lo, hi in ranges)
                rec.retunes.append((now_ms(), mhz, ok))
                self._out += b"+DMOSETGROUP:0\r\n" if ok else b"+DMOSETGROUP:1\r\n"
            elif line.startswith("AT+DMOSETVOLUME"):
                self._out += b"+DMOSETVOLUME:0\r\n"
            elif line == "RSSI?":
                self._out += b"RSSI=72\r\n"
            elif line == "AT+VERSION":
                self._out += b"+VERSION:SA868S-V4.0\r\n"
        def read(self, n=64):
            out, self._out = self._out[:n], self._out[n:]
            return out or None
        def reset_input_buffer(self):
            self._out = b""
    bus.UART = UART

    # ---- analogio with a scripted battery
    sched = scenario.get("battery")
    an = types.ModuleType("analogio")
    class AnalogIn:
        reference_voltage = 3.3
        def __init__(self, pin):
            claim(pin, self)
            self.pin = pin
        @property
        def value(self):
            if not sched:
                return 0
            t_s = clock.ns / 1e9
            v = sched[0][1]
            for ts, volts in sched:
                if t_s >= ts:
                    v = volts
            ratio = scenario.get("divider_ratio", 2.0)
            return int(v / ratio / 3.3 * 65535)
        def deinit(self):
            release(self.pin)
    an.AnalogIn = AnalogIn

    # ---- the SoC's own radios (network foxes): wifi, _bleio, alarm. Up/down is recorded as keyed/unkeyed so the
    # same stop condition and keyed_intervals serve both kinds of fox; rec.net keeps what went on the air.
    rec.net = []           # (t_ms, event, detail)
    def net_event(ev, detail=""):
        rec.net.append((now_ms(), ev, detail))
        if ev in ("ap_up", "probe", "adv_up"):
            rec.ptt.append((now_ms(), True))
        elif ev in ("ap_down", "probe_done", "adv_down"):
            rec.ptt.append((now_ms(), False)); rec.unkeys += 1
            if rec.stop_after_unkeys and rec.unkeys >= rec.stop_after_unkeys:
                clock.stop_requested = "unkeys"
    radios = scenario.get("radios", ["wifi24", "ble"])
    if "wifi24" in radios or "wifi5" in radios:
        wifi = types.ModuleType("wifi")
        class _Net:
            def __init__(self, ssid, rssi, ch): self.ssid, self.rssi, self.channel = ssid, rssi, ch
        class _Radio:
            enabled = False; mac_address_ap = bytes(6); mac_address = bytes(6); tx_power = 8.5
            def start_ap(self, ssid, password="", *, channel=1, max_connections=4, authmode=None):
                net_event("ap_up", "%s ch=%d mac=%s psk=%s" % (ssid, channel, ":".join("%02X" % b for b in self.mac_address_ap), "open" if not password else "yes"))
            def stop_ap(self): net_event("ap_down")
            def connect(self, ssid, password="", *, timeout=None):
                net_event("probe", "%s mac=%s" % (ssid, ":".join("%02X" % b for b in self.mac_address)))
                sleep(min(timeout or 2, 2)); net_event("probe_done")
                raise ConnectionError("no such network")
            def stop_station(self): pass
            def start_scanning_networks(self):
                for n in (("Neighbour", -55, 6), ("AnotherAP", -70, 11)): yield _Net(*n)
            def stop_scanning_networks(self): pass
        wifi.radio = _Radio(); wifi.AuthMode = types.SimpleNamespace(OPEN=0, WPA2=1)
        sys.modules["wifi"] = wifi
    else:
        sys.modules.pop("wifi", None)
    if "ble" in radios:
        bleio = types.ModuleType("_bleio")
        class Address:
            RANDOM_STATIC = 1
            def __init__(self, b, kind=0): self.b, self.kind = b, kind
            def __str__(self): return ":".join("%02x" % x for x in self.b) + " (random)"
        class _Adapter:
            enabled = False; name = ""; address = Address(bytes(6))
            def start_advertising(self, data, *, scan_response=b"", connectable=True, interval=0.1, tx_power=0):
                net_event("adv_up", "len=%d name=%s interval=%.3f tx=%d" % (len(data), scan_response[2:].decode("utf-8", "replace") if len(scan_response) > 2 else "", interval, tx_power))
            def stop_advertising(self): net_event("adv_down")
            def start_scan(self, timeout=2, minimum_rssi=-100):
                sleep(timeout)
                yield types.SimpleNamespace(rssi=-60, address=Address(bytes([0xC0, 0, 0, 0, 0, 1])), complete_name="Neighbour beacon")
            def stop_scan(self): pass
        bleio.adapter = _Adapter(); bleio.Address = Address
        sys.modules["_bleio"] = bleio
    else:
        sys.modules.pop("_bleio", None)
    alarm = types.ModuleType("alarm")
    class TimeAlarm:
        def __init__(self, *, monotonic_time): self.when = monotonic_time
    alarm.time = types.SimpleNamespace(TimeAlarm=TimeAlarm); alarm.wake_alarm = None
    def deep_sleep(*alarms):
        when = max(a.when for a in alarms)
        net_event("deep_sleep", "%.0f s" % (when - clock.ns / 1e9))
        clock.advance(max(0.0, when - clock.ns / 1e9) * 1e9)
        alarm.wake_alarm = alarms[0]
        raise Reboot()                        # the runner starts code.py again, as the board does after deep sleep
    alarm.exit_and_deep_sleep_until_alarms = deep_sleep
    sys.modules["alarm"] = alarm
    if not hasattr(board, "LED"): board.LED = Pin("LED")

    for name, mod in (("time", t), ("board", board), ("microcontroller", mc), ("digitalio", dio), ("pwmio", pwm), ("busio", bus), ("analogio", an)):
        sys.modules[name] = mod
    rec.stop_after_unkeys = scenario.get("stop_after_unkeys")
    rec.clock = clock
    return rec
