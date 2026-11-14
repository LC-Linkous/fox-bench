# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netpayload.py -- what a network fox says (the `payload` section, phase B of docs/network-fox-payloads-plan.md).
#
#   kind: static      the configured name / callsign (what NetFox does on its own)
#         rotate      one of payload.names per cycle, in order (stealth.rotate_name draws at random -- phase C)
#         morse-name  the Morse of payload.morse_of as the name: "-.- -.-- ....", cut to 32 bytes
#   code              iBeacon major/minor when either is non-zero (a checkpoint number, a grid reference)
#   eddystone.url     an Eddystone-URL frame beside the iBeacon one (the phone offers to open it)
#   eddystone.tlm     an Eddystone-TLM frame: battery mV, temperature, advertising count, uptime
#   interleave_ms     how often the BLE advertisement switches to the next frame while the radio is up
#   split             a clue in two halves: this fox also runs its other radio with the other half as the name
#
# Attached through fox.hooks: before_up picks the name and frames, while_up rotates the frames, after_down takes the
# second radio down. Everything here is plain CircuitPython; the simulator records the frames as net events.
import time
from . import morse, netradio

EDDYSTONE_UUID = b"\xAA\xFE"
# Eddystone-URL scheme prefixes (byte 0 of the encoded URL) and the expansion codes a URL may use inside
_URL_SCHEMES = (("http://www.", 0), ("https://www.", 1), ("http://", 2), ("https://", 3))
_URL_CODES = ((".com/", 0), (".org/", 1), (".edu/", 2), (".net/", 3), (".info/", 4), (".biz/", 5), (".gov/", 6),
              (".com", 7), (".org", 8), (".edu", 9), (".net", 10), (".info", 11), (".biz", 12), (".gov", 13))


def encode_url(url):
    """The Eddystone-URL body (scheme byte + encoded text), or None when the URL does not fit in 17 bytes."""
    scheme = None
    for prefix, code in _URL_SCHEMES:
        if url.startswith(prefix):
            scheme, rest = code, url[len(prefix):]
            break
    if scheme is None:
        return None
    out = bytearray([scheme])
    i = 0
    while i < len(rest):
        hit = False
        for text, code in _URL_CODES:
            if rest.startswith(text, i):
                out.append(code)
                i += len(text)
                hit = True
                break
        if not hit:
            out += rest[i].encode("utf-8")
            i += 1
    if len(out) > 18:          # 1 scheme byte + 17 of URL
        return None
    return bytes(out)


def eddystone_url_frame(url, tx_power_dbm):
    body = encode_url(url)
    if body is None:
        return None
    svc = bytes([0x10, tx_power_dbm & 0xFF]) + body                       # frame type 0x10, calibrated power at 0 m
    return bytes([3, 0x03]) + EDDYSTONE_UUID + bytes([len(svc) + 3, 0x16]) + EDDYSTONE_UUID + svc


def eddystone_tlm_frame(batt_mv, temp_c, adv_count, uptime_s):
    temp = 0x8000 if temp_c is None else (int(temp_c * 256) & 0xFFFF)   # 8.8 fixed point; 0x8000 = not supported
    svc = bytes([0x20, 0x00]) + int(batt_mv).to_bytes(2, "big") + temp.to_bytes(2, "big") \
        + (int(adv_count) & 0xFFFFFFFF).to_bytes(4, "big") + (int(uptime_s * 10) & 0xFFFFFFFF).to_bytes(4, "big")
    return bytes([3, 0x03]) + EDDYSTONE_UUID + bytes([len(svc) + 3, 0x16]) + EDDYSTONE_UUID + svc


def morse_name(word):
    """'KY4ZR' -> '-.- -.-- ....- --.. .-.' cut to 32 bytes at a space."""
    words = morse.encode(word)
    s = " / ".join(" ".join(chars) for chars in words)
    if len(s) > 32:
        s = s[:32].rstrip()
        if " " in s:
            s = s[:s.rfind(" ")]
    return s or "-"


class Payload:
    def __init__(self, fox):
        self.fox = fox
        self.cfg = fox.cfg["payload"]
        self.frames = []            # BLE frames to rotate through while up (the beacon's own first)
        self.frame_i = 0
        self.next_switch = 0
        self.adv_count = 0
        self.second = None          # the other radio, for a split clue
        self.name = fox.name

    # -- what the name is this cycle
    def name_for(self, cycle):
        c = self.cfg
        if c["kind"] == "rotate" and c["names"]:
            return c["names"][cycle % len(c["names"])]
        if c["kind"] == "morse-name" and c["morse_of"]:
            return morse_name(c["morse_of"])
        return self.fox.name

    # -- hooks
    def before_up(self, fox, cycle):
        self.name = self.name_for(cycle)
        if self.name != fox.radio.name:
            fox.radio.name = self.name
            fox.log("payload: name this cycle %s" % _q(self.name))
        if fox.radio.kind == "ble":
            self._build_frames()
            fox.radio.frame = self._first_frame
        if self.second is not None:
            try:
                self.second.name = self.cfg["split"]["ble"] if self.second.kind == "ble" else self.cfg["split"]["wifi"]
                self.second.up()
                fox.log("payload: split clue on %s: %s" % (self.second.kind, _q(self.second.name)))
            except Exception as e:
                fox.log("payload: second radio failed (%s)" % e.__class__.__name__)

    def while_up(self, fox, cycle):
        if fox.radio.kind != "ble" or len(self.frames) < 2:
            return
        now = time.monotonic()
        if now < self.next_switch:
            return
        self.next_switch = now + self.cfg["interleave_ms"] / 1000.0
        self.frame_i = (self.frame_i + 1) % len(self.frames)
        self.adv_count += 1
        try:
            fox.radio.down()
            fox.radio.frame = lambda: self._frame(self.frame_i)
            fox.radio.up()
        except Exception as e:
            fox.log("payload: frame switch failed (%s)" % e.__class__.__name__)

    def after_down(self, fox, cycle):
        if self.second is not None:
            self.second.down()

    # -- BLE frames
    def _build_frames(self):
        c, r = self.cfg, self.fox.radio
        if c["code"]["major"] or c["code"]["minor"]:
            r.cfg["major"], r.cfg["minor"] = c["code"]["major"], c["code"]["minor"]
        frames = [netradio.BleBeacon.frame(r)]
        if c["eddystone"]["url"]:
            f = eddystone_url_frame(c["eddystone"]["url"], r.cfg["tx_power_dbm"])
            if f is None:
                self.fox.log("payload: Eddystone URL does not fit in 17 bytes; not sent")
            else:
                frames.append(f)
        if c["eddystone"]["tlm"]:
            frames.append(None)       # built fresh each time: it carries the counters
        self.frames = frames
        self.frame_i = 0
        self.next_switch = time.monotonic() + c["interleave_ms"] / 1000.0
        if len(frames) > 1:
            self.fox.log("payload: %d BLE frames, every %d ms" % (len(frames), c["interleave_ms"]))

    def _frame(self, i):
        f = self.frames[i]
        if f is None:
            batt = 0
            try:
                b = getattr(self.fox, "batt", None)
                if b is not None:
                    batt = int(b.read() * 1000)
            except Exception:
                pass
            return eddystone_tlm_frame(batt, None, self.adv_count, time.monotonic())
        return f

    def _first_frame(self):
        return self._frame(0)


def attach(fox):
    p = Payload(fox)
    c = p.cfg
    if c["split"]["wifi"] and c["split"]["ble"] and "wifi24" in fox.radios and "ble" in fox.radios:
        other = "ble" if fox.radio.kind != "ble" else "wifi-ap"
        p.second = netradio.make({**_second_defaults(other, fox.cfg["net"]), "kind": other}, "")
        if not p.second.setup():
            fox.log("payload: split clue needs the %s radio (%s); skipped" % (other, p.second.status))
            p.second = None
    fox.hooks["before_up"].append(p.before_up)
    fox.hooks["while_up"].append(p.while_up)
    fox.hooks["after_down"].append(p.after_down)
    fox.payload = p
    return p


def _second_defaults(kind, net):
    """A minimal net section for the other radio: same MAC, open, sensible power."""
    if kind == "ble":
        return {"uuid": "F0B0F0B0-0000-4000-8000-000000000002", "major": 0, "minor": 0, "signal_power_dbm": -59,
                "adv_min": 200, "adv_max": 400, "tx_power_dbm": 0, "mac": net.get("mac")}
    return {"ssid": "", "psk": "", "channel": 1, "hidden": False, "max_clients": 1, "tx_power_dbm": 13, "mac": net.get("mac")}


def _q(s):
    return '"' + s + '"' if " " in s else s
