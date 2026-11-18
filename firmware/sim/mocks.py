# SPDX-License-Identifier: GPL-3.0-or-later
# sim/mocks.py -- fake CircuitPython hardware with a virtual clock.
# install(scenario) puts fake `board`, `microcontroller`, `digitalio`, `pwmio`,
# `busio`, `analogio` and a virtual `time` into sys.modules, and returns a
# Recorder holding everything the firmware did: tone events, PTT edges, UART
# traffic, LED edges, prints.
import time as _REAL_TIME   # the host's time module, captured before install() replaces sys.modules['time']
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
        self.checks = []             # run after every advance (the watchdog mock)
        self.stop_requested = None   # set by the recorder (e.g. "unkeys"); raised at the next advance, never from inside a pin setter

    def advance(self, ns):
        self.ns += int(ns)
        if ACTIVE[0] and self.stop_requested:
            raise SimDone(self.stop_requested)
        if self.ns > self.cap_ns and ACTIVE[0]:
            raise SimDone("time cap")
        if self.on_tick:
            self.on_tick()
        for f in self.checks:
            f()


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
    import sys as _sys
    _sys.platform = scenario.get("platform", "Espressif ESP32-S3")       # what CircuitPython's sys.platform says on the board
    rec.break_module = scenario.get("break_module")
    rec.code_patch = scenario.get("code_patch")          # [old, new]: code.py edited before it runs (a body that raises)
    now_ms = lambda: clock.ns / 1e6

    # ---- time
    t = types.ModuleType("time")
    t.monotonic = lambda: clock.ns / 1e9
    def monotonic_ns():
        clock.advance(50_000)          # a call costs 50 us, so busy-waits terminate
        return clock.ns
    t.monotonic_ns = monotonic_ns
    pre_sleep = []                     # callables run before virtual time moves (the BLE mock flushes a pending stop)
    def sleep(s):
        for f in pre_sleep: f()
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
    mc.nvm = bytearray(b"\xff" * 16)       # erased flash reads 0xFF, as a new board's does
    if scenario.get("nvm0") is not None:   # safemode.py's consecutive-reset count, as left by earlier boots
        mc.nvm[0] = scenario["nvm0"]
    rec.nvm = mc.nvm
    # the hardware watchdog: armed by foxlib.guard from cycle.run(). If virtual time passes `timeout` without a
    # feed() the board would reset; the mock records the bite (rec.watchdog_bite) and the runner fails the scenario.
    wdm = types.ModuleType("watchdog")
    wdm.WatchDogMode = types.SimpleNamespace(RESET="reset", RAISE="raise")
    rec.watchdog_bite = None
    rec.watchdog_feeds = 0
    class _WDT:
        def __init__(self):
            self._timeout = None; self.mode = None; self._fed_ns = 0
        @property
        def timeout(self): return self._timeout
        @timeout.setter
        def timeout(self, v):
            if not (0 < float(v) <= 3600): raise ValueError("watchdog timeout")
            self._timeout = float(v)
        def feed(self):
            if self.mode is None: raise ValueError("watchdog not running")
            self._fed_ns = clock.ns; rec.watchdog_feeds += 1
        def deinit(self): self.mode = None
        def _check(self):
            if self.mode and rec.watchdog_bite is None and clock.ns - self._fed_ns > self._timeout * 1e9:
                rec.watchdog_bite = (self._fed_ns / 1e6, clock.ns / 1e6)
    mc.watchdog = _WDT()
    rec.wdt = mc.watchdog
    clock.checks.append(mc.watchdog._check)
    sys.modules["watchdog"] = wdm

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
                if keyed and getattr(rec, "module_present", False) and rec.module_mhz is None:
                    rec.keyed_on_default += 1
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
            if d and scenario.get("pwm_fail_at_s") is not None and clock.ns / 1e9 >= scenario["pwm_fail_at_s"]:
                scenario["pwm_fail_at_s"] = None        # once: the port refuses the PWM, as a RuntimeError
                raise RuntimeError("All timers in use")
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
            rec.module_present = True
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
            if scenario.get("module_silent_until_s") is not None and clock.ns / 1e9 < scenario["module_silent_until_s"]:
                return                       # the module is still booting / not yet powered
            if line == "AT+DMOCONNECT":
                self._out += b"+DMOCONNECT:0\r\n"
            elif line.startswith("AT+DMOSETGROUP="):
                mhz = float(line.split("=")[1].split(",")[1])
                ok = any(lo <= mhz <= hi for lo, hi in ranges)
                rec.retunes.append((now_ms(), mhz, ok))
                if ok: rec.module_mhz = mhz
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
    rec.module_mhz = None          # the channel the scripted module is on (None: its power-on default)
    rec.module_resets = 0
    rec.keyed_on_default = 0       # key-ups while the module was on no channel: a fox that sounds dead
    def module_dip():
        # scenario module_reset_at_s: the module lost power and came back on its default channel
        t = scenario.get("module_reset_at_s")
        if t is not None and clock.ns / 1e9 >= t:
            scenario["module_reset_at_s"] = None; rec.module_mhz = None; rec.module_resets += 1
    clock.checks.append(module_dip)

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
            # As ports/espressif/common-hal/wifi/Radio.c has it: the radio is started at boot; a MAC setter raises
            # unless its interface's mode is on (start_ap / start_station, also while the radio is disabled, when
            # they only configure); enabling resets tx_power to the build's default. scenario.factory_mac: the
            # chip's own addresses (default 7C:DF:A1:00:00:0A station, ...0B access point).
            _enabled = True; tx_power = 20.0; _pending_stop = None; _pending_probe = None
            _ap_mode = False; _sta_mode = False; _on_air = False
            _mac_sta = bytes.fromhex(scenario.get("factory_mac", "7C:DF:A1:00:00:0A").replace(":", ""))
            _mac_ap = _mac_sta[:5] + bytes([(_mac_sta[5] + 1) & 0xFF])
            @property
            def enabled(self): return self._enabled
            @enabled.setter
            def enabled(self, v):
                if self._enabled and not v:
                    self._flush(); self._flush_probe(); net_event("wifi_disabled")
                elif v and not self._enabled:
                    self.tx_power = 20.0
                    # off and on again with no virtual time between is a restart (the drivers' MAC change), not a radio
                    # that was turned off
                    if rec.net and rec.net[-1][1] == "wifi_disabled" and rec.net[-1][0] == now_ms():
                        rec.net.pop(); net_event("wifi_restart")
                self._enabled = v
            def _set_mac(self, which, mode, b):
                if scenario.get("mac_fixed"): raise NotImplementedError("mac is read-only on this build")
                if not mode: raise RuntimeError("Interface must be started")
                if len(b) != 6: raise ValueError("Invalid MAC address")
                if b[0] & 1: raise RuntimeError("Invalid multicast MAC address")
                setattr(self, which, bytes(b))
            mac_address_ap = property(lambda self: self._mac_ap, lambda self, b: self._set_mac("_mac_ap", self._ap_mode, b))
            mac_address = property(lambda self: self._mac_sta, lambda self, b: self._set_mac("_mac_sta", self._sta_mode, b))
            def start_station(self): self._sta_mode = True
            # stop_ap + start_ap with no virtual time between is an SSID swap (the stealth decoys), not an unkey
            def _flush(self):
                if self._pending_stop is not None:
                    self._pending_stop = None; net_event("ap_down")
            def start_ap(self, ssid, password="", *, channel=1, max_connections=4, authmode=None):
                if scenario.get("ap_fail_at_s") is not None and clock.ns / 1e9 >= scenario["ap_fail_at_s"]:
                    scenario["ap_fail_at_s"] = None; raise RuntimeError("AP could not be started")     # once
                self._ap_mode = True
                if not self._enabled: return          # configured; nothing on the air until the radio is enabled
                self._on_air = True
                detail = "%s ch=%d mac=%s psk=%s" % (ssid, channel, ":".join("%02X" % b for b in self.mac_address_ap), "open" if not password else "yes")
                if self._pending_stop is not None and self._pending_stop == now_ms():
                    self._pending_stop = None; net_event("ap_swap", detail); return
                self._flush(); net_event("ap_up", detail)
            def stop_ap(self):
                self._ap_mode = False
                if not self._on_air: return           # an access point that never started has nothing to stop
                self._on_air = False
                self._flush(); self._pending_stop = now_ms()
            # connect() scans for the network until its timeout, then gives up: one round of probe requests. A round
            # that follows the last with no virtual time between is the same burst going on (probe_more when the
            # network sought changed); the station is off the air once a round is not followed (probe_done).
            def _flush_probe(self):
                if self._pending_probe is not None:
                    t, self._pending_probe = self._pending_probe[0], None
                    rec.net.append((t, "probe_done", "")); rec.ptt.append((t, False)); rec.unkeys += 1     # when the round ended
                    if rec.stop_after_unkeys and rec.unkeys >= rec.stop_after_unkeys:
                        clock.stop_requested = "unkeys"
            def connect(self, ssid, password="", *, timeout=None):
                if not self._enabled: raise RuntimeError("wifi is not enabled")
                self._sta_mode = True
                detail = "%s mac=%s" % (ssid, ":".join("%02X" % b for b in self.mac_address))
                if self._pending_probe is not None and now_ms() - self._pending_probe[0] <= 100:      # the runner's bookkeeping between rounds
                    if self._pending_probe[1] != detail: net_event("probe_more", detail)
                    self._pending_probe = None
                else:
                    self._flush_probe(); net_event("probe", detail)
                sleep(min(timeout or 2, 2)); self._pending_probe = (now_ms(), detail)
                raise ConnectionError("no such network")
            def stop_station(self):
                self._sta_mode = False; self._flush_probe()
            def start_scanning_networks(self):
                if not self._enabled: raise RuntimeError("wifi is not enabled")
                self._sta_mode = True
                # scenario.world.ssids: [{ssid, rssi, ch, from_s, to_s}] -- another fox on the air (relay), and when
                t0 = clock.ns / 1e9
                sleep(1.5)
                net_event("wifi_scan", "")
                world = (scenario.get("world") or {}).get("ssids")
                if world is None:
                    world = [{"ssid": "Neighbour", "rssi": -55, "ch": 6}, {"ssid": "AnotherAP", "rssi": -70, "ch": 11}]
                for n in world:
                    if n.get("from_s", 0) <= t0 < n.get("to_s", 1e12): yield _Net(n["ssid"], n["rssi"], n.get("ch", 6))
            def stop_scanning_networks(self): pass
            class _Ip:
                packed = bytes([192, 168, 4, 1])
                def __str__(self): return "192.168.4.1"
            ipv4_address_ap = _Ip()
            @property
            def stations_ap(self):
                # scenario.world.stations: [{mac, ip, rssi, from_s, to_s}]; default: the scripted phone, always there
                t = clock.ns / 1e9
                world = (scenario.get("world") or {}).get("stations")
                if world is None:
                    world = [{"mac": "DA:11:22:33:44:55", "ip": "192.168.4.2", "rssi": -50}]
                return [types.SimpleNamespace(mac_address=bytes.fromhex(s["mac"].replace(":", "")), ipv4_address=s.get("ip", "192.168.4.9"), rssi=s.get("rssi", -60))
                        for s in world if s.get("from_s", 0) <= t < s.get("to_s", 1e12)]
        wifi.radio = _Radio(); wifi.AuthMode = types.SimpleNamespace(OPEN=0, WPA2=1)
        if not scenario.get("no_monitor"):
            # wifi.Monitor: scenario.world.probes [{mac, ssid, rssi, at_s}] arrive as probe-request frames on any channel
            wifi.Packet = types.SimpleNamespace(CH="CH", LEN="LEN", RAW="RAW", RSSI="RSSI")
            class Monitor:
                def __init__(self, channel=1, queue=128):
                    self.channel, self.done, self.t0 = channel, set(), clock.ns / 1e9; net_event("monitor", "ch=%d" % channel)
                def packet(self):
                    t = clock.ns / 1e9
                    for i, p in enumerate((scenario.get("world") or {}).get("probes", [])):
                        if i not in self.done and self.t0 - 1 <= p["at_s"] <= t:      # heard only while listening
                            self.done.add(i)
                            ssid = p.get("ssid", "").encode()
                            raw = bytes([0x40, 0, 0, 0]) + b"\xff" * 6 + bytes.fromhex(p["mac"].replace(":", "")) + b"\xff" * 6 + b"\x10\x00" + bytes([0, len(ssid)]) + ssid
                            return {"CH": self.channel, "LEN": len(raw), "RAW": raw, "RSSI": p.get("rssi", -60)}
                    return {}
                def deinit(self): pass
            wifi.Monitor = Monitor
        pre_sleep.append(wifi.radio._flush); pre_sleep.append(wifi.radio._flush_probe)
        sys.modules["wifi"] = wifi
        _install_socketpool(scenario, clock, rec, net_event, wifi)
    else:
        sys.modules.pop("wifi", None); sys.modules.pop("socketpool", None)
    if "ble" in radios:
        bleio = types.ModuleType("_bleio")
        class Address:
            # shared-bindings/_bleio/Address.c: the bytes are little-endian (the written form's last octet first)
            PUBLIC, RANDOM_STATIC = 0, 1
            def __init__(self, b, kind=0):
                if len(b) != 6: raise ValueError("Address must be 6 bytes long")
                self.b, self.type = bytes(b), kind
            @property
            def address_bytes(self): return self.b
            def __str__(self): return "<Address %s>" % ":".join("%02x" % x for x in reversed(self.b))
            __repr__ = __str__
        class UUID:
            def __init__(self, v): self.v = v
            def __repr__(self): return "UUID(%s)" % self.v
        class Attribute:
            OPEN, NO_ACCESS = 1, 0
        class Service:
            def __init__(self, uuid, secondary=False): self.uuid, self.chars = uuid, []
        class Characteristic:
            READ, WRITE, WRITE_NO_RESPONSE, NOTIFY = 2, 8, 4, 16
            def __init__(self, uuid, properties, initial_value):
                self.uuid, self.properties, self.value = uuid, properties, initial_value
            @staticmethod
            def add_to_service(service, uuid, properties=0, read_perm=1, write_perm=1, max_length=20, fixed_length=False, initial_value=b""):
                c = Characteristic(uuid, properties, initial_value); service.chars.append(c)
                net_event("ble_char", "%s props=%d value=%s" % (uuid.v, properties, (initial_value or b"").decode("utf-8", "replace")))
                return c
        class CharacteristicBuffer:
            """The scripted central's writes (scenario.central = [{"at_s": t, "write": "W1ABC"}]) arrive here once their time has come."""
            def __init__(self, characteristic, timeout=0, buffer_size=64):
                self.c, self.pending = characteristic, b""
                rec.ble_buffers.append(self)
            @property
            def in_waiting(self):
                self._pull(); return len(self.pending)
            def read(self, n=None):
                self._pull(); out, self.pending = self.pending[:n], self.pending[n:] if n else b""; return out
            def _pull(self):
                for ev in scenario.get("central", []):
                    if not ev.get("_done") and "write" in ev and clock.ns / 1e9 >= ev["at_s"]:
                        ev["_done"] = True; self.pending += ev["write"].encode(); net_event("ble_write", ev["write"])
        rec.ble_buffers = []
        class _Adapter:
            name = ""; _pending_stop = None; advertising = False
            _scanned = False       # scenario ble_refuse_after_scan: start_advertising raises until the adapter is toggled
            _en = False
            @property
            def enabled(self): return self._en
            @enabled.setter
            def enabled(self, v):
                if not v: self._scanned = False; self.advertising = False
                self._en = v
            _address = Address(bytes(reversed(bytes.fromhex(scenario.get("factory_mac", "7C:DF:A1:00:00:0A").replace(":", "")[:10] + "0c"))))
            @property
            def address(self): return self._address
            @address.setter
            def address(self, a):
                # espressif: ble_hs_id_set_rnd; nordic: sd_ble_gap_addr_set. Static random only, its two top bits set,
                # and not while advertising; anything else is BluetoothError("Could not set address")
                if scenario.get("mac_fixed") or a.type != Address.RANDOM_STATIC or (a.b[5] & 0xC0) != 0xC0 or self.advertising:
                    raise RuntimeError("Could not set address")
                self._address = a
            @property
            def connected(self):
                # a scripted central is "connected" for 2 s around each of its events
                return any(abs(clock.ns / 1e9 - ev["at_s"]) < 1.0 for ev in scenario.get("central", []))
            # A stop followed by a start with no virtual time in between is a frame swap (the payload feature rotating
            # iBeacon / Eddystone frames), recorded as adv_swap and not as an unkey; a stop that stands is adv_down.
            def _flush(self):
                if self._pending_stop is not None:
                    self._pending_stop = None; net_event("adv_down")
            def start_advertising(self, data, *, scan_response=b"", connectable=True, interval=0.1, tx_power=0):
                if len(data) > 31 or len(scan_response) > 31: raise ValueError("Data too large")
                if self.advertising: raise RuntimeError("Already advertising")      # _bleio raises BluetoothError
                if self._scanned and scenario.get("ble_refuse_after_scan"):
                    # the XIAO ESP32S3 (CircuitPython 10.3.2) after a scan from the same adapter: HCI invalid parameters,
                    # until the adapter is turned off and on (netradio's second try); "restart" = a plain retry clears it
                    if scenario["ble_refuse_after_scan"] == "restart": self._scanned = False
                    net_event("adv_refused"); raise RuntimeError("Unknown system firmware error: 530")
                if scenario.get("ble_power_steps") == "nrf" and tx_power not in (-40, -20, -16, -12, -8, -4, 0, 2, 3, 4, 5, 6, 7, 8):
                    raise RuntimeError("Unknown system firmware error: 7")       # NRF_ERROR_INVALID_PARAM from the SoftDevice
                # the name: the 0x09 AD structure wherever it sits in the scan response
                name, svc, i = "", "", 0
                while i < len(scan_response) - 1:
                    ln, typ = scan_response[i], scan_response[i + 1]
                    if typ == 0x09: name = scan_response[i + 2:i + 1 + ln].decode("utf-8", "replace")
                    if typ == 0x07: svc = bytes(reversed(scan_response[i + 2:i + 1 + ln])).hex()
                    i += 1 + ln
                detail = "len=%d name=%s interval=%.3f tx=%d frame=%s%s%s mac=%s" % (len(data), name, interval, tx_power, bytes(data).hex(), " connectable" if connectable else "", (" service=" + svc) if svc else "",
                                                                                   ":".join("%02X" % x for x in reversed(self._address.b)))
                self.advertising = True
                if self._pending_stop is not None and self._pending_stop == now_ms():
                    self._pending_stop = None; net_event("adv_swap", detail); return
                self._flush(); net_event("adv_up", detail)
            def stop_advertising(self):
                if not self.advertising: return       # nothing on the air: nothing to stop
                self.advertising = False
                self._flush(); self._pending_stop = now_ms()
            def start_scan(self, timeout=2, minimum_rssi=-100):
                self._scanned = True
                # scenario.world.advertisers: [{name, mac, rssi, from_s, to_s}] -- who is nearby, and when; default: one
                # neighbour beacon. Entries carry advertisement_bytes (the 0x09 name), as _bleio's ScanEntry does.
                t0 = clock.ns / 1e9
                sleep(timeout)
                net_event("ble_scan", "%.1f s" % timeout)
                world = (scenario.get("world") or {}).get("advertisers")
                if world is None:
                    world = [{"name": "Neighbour beacon", "mac": "C0:00:00:00:00:01", "rssi": -60}]
                # An active scan reports the advertisement and the scan response as two entries. The name is in the
                # scan response, as a fox-bench beacon's and most tags' is, unless the advertiser says name_in: "adv".
                for a in world:
                    if a.get("from_s", 0) <= t0 < a.get("to_s", 1e12) and a["rssi"] >= minimum_rssi:
                        nm = a.get("name", "").encode()
                        named = (bytes([len(nm) + 1, 0x09]) + nm) if nm else b""
                        mac = Address(bytes(reversed(bytes.fromhex(a["mac"].replace(":", "")))), Address.RANDOM_STATIC)
                        in_adv = a.get("name_in") == "adv"
                        yield types.SimpleNamespace(rssi=a["rssi"], address=mac, advertisement_bytes=bytes([2, 0x01, 0x06]) + (named if in_adv else b""), connectable=False, scan_response=False)
                        if named and not in_adv:
                            yield types.SimpleNamespace(rssi=a["rssi"] - 2, address=mac, advertisement_bytes=named, connectable=False, scan_response=True)
            def stop_scan(self): pass
        bleio.adapter = _Adapter(); bleio.Address = Address
        bleio.UUID, bleio.Attribute, bleio.Service, bleio.Characteristic, bleio.CharacteristicBuffer = UUID, Attribute, Service, Characteristic, CharacteristicBuffer
        pre_sleep.append(bleio.adapter._flush)
        sys.modules["_bleio"] = bleio
    else:
        sys.modules.pop("_bleio", None)
    alarm = types.ModuleType("alarm")
    class TimeAlarm:
        def __init__(self, *, monotonic_time): self.when = monotonic_time
    alarm.time = types.SimpleNamespace(TimeAlarm=TimeAlarm); alarm.wake_alarm = None
    alarm.sleep_memory = bytearray(16)      # survives the simulated deep sleep (the module is kept across the re-exec), not a new scenario
    def deep_sleep(*alarms):
        for f in pre_sleep: f()                 # a pending radio stop is a real stop once the board sleeps
        when = max(a.when for a in alarms)
        net_event("deep_sleep", "%.0f s" % (when - clock.ns / 1e9))
        clock.advance(max(0.0, when - clock.ns / 1e9) * 1e9)
        alarm.wake_alarm = alarms[0]
        raise Reboot()                        # the runner starts code.py again, as the board does after deep sleep
    alarm.exit_and_deep_sleep_until_alarms = deep_sleep
    sys.modules["alarm"] = alarm
    # rtc: the board clock. CircuitPython boots at 2000-01-01 until something sets it; scenario["clock"] = "YYYY-MM-DDTHH:MM:SS"
    # pretends the page set it at deploy. Setting rtc.RTC().datetime is recorded as a net event.
    rtcm = types.ModuleType("rtc")
    _base = [2000, 1, 1, 0, 0, 0]
    if scenario.get("clock"):
        c = scenario["clock"]; _base = [int(c[0:4]), int(c[5:7]), int(c[8:10]), int(c[11:13]), int(c[14:16]), int(c[17:19])]
    class _RTC:
        @property
        def datetime(self):
            secs = int(clock.ns / 1e9)
            y, mo, d, h, mi, se = _base
            se += secs; mi += se // 60; se %= 60; h += mi // 60; mi %= 60; d += h // 24; h %= 24
            return _REAL_TIME.struct_time((y, mo, d, h, mi, se, 0, 0, -1))
        @datetime.setter
        def datetime(self, t):
            _base[:] = [t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec]
            net_event("clock_set", "%04d-%02d-%02dT%02d:%02d:%02d" % tuple(_base))
    _one = _RTC()
    rtcm.RTC = lambda: _one
    sys.modules["rtc"] = rtcm
    if not hasattr(board, "LED"): board.LED = Pin("LED")

    for name, mod in (("time", t), ("board", board), ("microcontroller", mc), ("digitalio", dio), ("pwmio", pwm), ("busio", bus), ("analogio", an)):
        sys.modules[name] = mod
    rec.stop_after_unkeys = scenario.get("stop_after_unkeys")
    rec.clock = clock
    rec.flush = lambda: [f() for f in pre_sleep]      # the runner calls it when the script ends: pending stops become stops
    return rec


def _install_socketpool(scenario, clock, rec, net_event, wifi):
    """socketpool with a scripted phone: scenario.phone = [{"at_s": 12, "dns": "captive.apple.com"},
    {"at_s": 13, "get": "/hotspot-detect.html"}, {"at_s": 20, "post": "callsign=W1ABC"}]. A DNS event becomes a query
    on the UDP socket; a get/post becomes one accepted TCP client whose request is read with recv_into and whose
    response (send) is recorded as a net event (http_response status=... body contains the page)."""
    import types as _t, errno as _errno
    rec.http = []          # (t_ms, method, path, status, body)
    rec.dns = []           # (t_ms, name, answer_ip)
    phone = scenario.get("phone", [])
    def due(kind):
        for ev in phone:
            if kind in ev and not ev.get("_done") and clock.ns / 1e9 >= ev["at_s"]:
                ev["_done"] = True
                return ev
        return None
    def dns_query(name, qid=0x1234):
        q = bytes([qid >> 8, qid & 0xFF, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0])
        for label in name.split("."):
            q += bytes([len(label)]) + label.encode()
        return q + b"\x00\x00\x01\x00\x01"
    class _Sock:
        def __init__(self, pool, fam, typ):
            self.typ, self.bound, self.blocking, self.timeout = typ, None, True, None
            self.req, self.sent, self.ev, self.closed = b"", b"", None, False
        def setsockopt(self, *a): pass
        def bind(self, addr): self.bound = addr
        def listen(self, n): pass
        def setblocking(self, v): self.blocking = v
        def settimeout(self, t): self.timeout = t
        def close(self): self.closed = True
        # ---- TCP listener
        def accept(self):
            ev = due("get") or due("post")
            if ev is None: raise OSError(_errno.EAGAIN)
            c = _Sock(None, 0, 1); c.ev = ev
            if "get" in ev: c.req = ("GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: CaptiveNetworkSupport\r\n\r\n" % (ev["get"], ev.get("host", "captive.apple.com"))).encode()
            else:
                body = ev["post"].encode()
                c.req = ("POST /find HTTP/1.1\r\nHost: 192.168.4.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: %d\r\n\r\n" % len(body)).encode()
                c.body_later = body if ev.get("split") else b""
                if not ev.get("split"): c.req += body
            return c, ("192.168.4.2", 50000)
        # ---- TCP client
        def recv_into(self, buf):
            clock.advance(2_000_000)      # 2 ms on the wire
            if self.req:
                data, self.req = self.req[:len(buf)], self.req[len(buf):]
            elif getattr(self, "body_later", b""):
                data, self.body_later = self.body_later, b""
            else:
                raise OSError(_errno.ETIMEDOUT)
            buf[:len(data)] = data
            return len(data)
        def send(self, data):
            self.sent += bytes(data)
            head, _, body = self.sent.partition(b"\r\n\r\n")
            status = head.split(b"\r\n")[0].decode(errors="replace")
            m = self.ev
            rec.http.append((clock.ns / 1e6, "GET" if "get" in m else "POST", m.get("get", "/find"), status, body.decode("utf-8", "replace")))
            net_event("http_response", "%s %s %s len=%d" % ("GET" if "get" in m else "POST", m.get("get", "/find"), status, len(body)))
            return len(data)
        # ---- UDP (DNS)
        def recvfrom_into(self, buf):
            ev = due("dns")
            if ev is None: raise OSError(_errno.EAGAIN)
            q = dns_query(ev["dns"]); buf[:len(q)] = q; self.last_name = ev["dns"]
            return len(q), ("192.168.4.2", 53000)
        def sendto(self, data, addr):
            ip = ".".join(str(b) for b in data[-4:]) if len(data) > 16 and data[7] == 1 else "-"
            rec.dns.append((clock.ns / 1e6, self.last_name, ip)); net_event("dns_answer", "%s -> %s" % (self.last_name, ip))
            return len(data)
    class SocketPool:
        AF_INET, SOCK_STREAM, SOCK_DGRAM, SOL_SOCKET, SO_REUSEADDR = 2, 1, 2, 1, 4
        def __init__(self, radio): pass
        def socket(self, fam=2, typ=1, proto=0): return _Sock(self, fam, typ)
    sp = _t.ModuleType("socketpool"); sp.SocketPool = SocketPool
    sys.modules["socketpool"] = sp
