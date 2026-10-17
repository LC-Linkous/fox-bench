# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/radio.py -- radio module drivers, selected by fox.json radio.family.
#
# Nothing here changes the module's own firmware. A driver owns the control
# pins (PTT, PD, HL) and the UART dialect. Families:
#   dmo   NiceRF "DMO" AT dialect: SA818, SA818S, SA868, SA868S, DRA818.
#         AT+DMOCONNECT / AT+DMOSETGROUP / AT+DMOSETVOLUME / RSSI? / AT+VERSION
# Add a family: subclass Base, implement _setup/_retune/_rssi, register in DRIVERS.

import time
import busio
import digitalio


def _out(pin, value):
    d = digitalio.DigitalInOut(pin)
    d.direction = digitalio.Direction.OUTPUT
    d.value = value
    return d


class Base:
    family = "base"

    def __init__(self, pins, cfg):
        self.cfg = cfg
        self.status = "noreply"
        self.freq_mhz = None
        self.keyed = False
        self.keyed_since = None
        self.ptt = _out(pins["ptt"], True)        # True = receive
        self.pd = _out(pins["pd"], True)          # True = awake
        self.hl = _out(pins["hl"], bool(cfg.get("high_power", False)))
        self.uart = busio.UART(pins["uart_tx"], pins["uart_rx"], baudrate=cfg.get("baud", 9600), timeout=0.5)
        time.sleep(0.6)                           # module boot

    # ---- keying. ALWAYS release in a finally; cycle.py relies on it.
    def key(self):
        self.ptt.value = False
        self.keyed = True
        self.keyed_since = time.monotonic()

    def unkey(self):
        self.ptt.value = True
        self.keyed = False

    def keyed_ms(self):
        return 0 if not self.keyed else (time.monotonic() - self.keyed_since) * 1000

    def key_for(self, seconds):
        """bench: key unmodulated for N seconds, then release"""
        self.key()
        try:
            time.sleep(seconds)
        finally:
            self.unkey()
        return "ok"

    # ---- to implement per family
    def setup(self):
        return False

    def retune(self, mhz):
        return False

    def rssi(self):
        return None

    def probe(self, freqs=(146.5, 433.5)):
        """which test frequencies does the fitted module accept? receive-only, nothing transmitted"""
        out = {}
        for f in freqs:
            out[str(f)] = bool(self.retune(f))
        if self.freq_mhz:
            self.retune(self.freq_mhz)
        return out


class Dmo(Base):
    family = "dmo"

    def _cmd(self, text, wait=0.15, retries=2):
        """send one AT line, return the reply text (may be '')"""
        for _ in range(retries + 1):
            self.uart.reset_input_buffer() if hasattr(self.uart, "reset_input_buffer") else None
            self.uart.write((text + "\r\n").encode())
            time.sleep(wait)
            raw = self.uart.read(64)
            if raw:
                try:
                    return raw.decode().strip()
                except Exception:
                    return repr(raw)
        return ""

    def setup(self):
        r = self._cmd("AT+DMOCONNECT", wait=0.5)
        if "+DMOCONNECT:0" not in r:
            self.status = "noreply" if not r else "err(%s)" % r.replace(" ", "")
            return False
        c = self.cfg
        self._cmd("AT+DMOSETVOLUME=%d" % max(1, min(8, int(c.get("volume", 5)))))
        self.status = "ok"
        return True

    def retune(self, mhz):
        c = self.cfg
        r = self._cmd("AT+DMOSETGROUP=%d,%.4f,%.4f,0000,%d,0000" % (int(c.get("bandwidth", 1)), mhz, mhz, int(c.get("squelch", 3))))
        ok = "+DMOSETGROUP:0" in r
        if ok:
            self.freq_mhz = mhz
            if self.status != "ok":
                self.status = "ok"
        elif r:
            self.status = "err(DMOSETGROUP:1)" if ":1" in r else "err(%s)" % r.replace(" ", "")
        else:
            self.status = "noreply"
        return ok

    def rssi(self):
        r = self._cmd("RSSI?")
        if "RSSI=" in r:
            try:
                return int(r.split("RSSI=")[1].strip().split()[0])
            except Exception:
                return None
        return None

    def version(self):
        return self._cmd("AT+VERSION")


DRIVERS = {"dmo": Dmo}


def make(pins, cfg):
    cls = DRIVERS.get(cfg.get("family"))
    if cls is None:
        raise ValueError("radio.family %r has no driver" % cfg.get("family"))
    return cls(pins, cfg)
