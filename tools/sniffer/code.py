# SPDX-License-Identifier: GPL-3.0-or-later
# tools/sniffer/code.py -- a Wi-Fi probe-request sniffer on a second XIAO ESP32-C3 / C6 (CircuitPython).
#
# Puts the radio in monitor mode and prints one line of JSON per probe request it hears:
#   {"t":"hello","role":"sniffer","proto":1,"channels":[1,6,11]}        once, on boot
#   {"t":"probe","mac":"f2:b0:00:00:00:05","ssid":"FOXBENCH WiFi Probe","rssi":-48,"ch":6,"ms":12345}
#   {"t":"idle","ms":12345}                                             after IDLE_MS without a probe
#
# This is what verifies the wifi-probe fox: its probe requests carry the SSID and the spoofed MAC, and nothing a
# phone shows will tell you they went out. tools/hw_smoke.py --sniffer <port> reads these lines while the fox runs.
#
# Monitor mode: `wifi.Monitor(channel=n)` (CircuitPython >= 8.1 on the ESP32 family). `.packet()` returns None or a
# dict with Packet.CH, Packet.RSSI, Packet.RAW (the 802.11 frame, FCS stripped). Hopping is done here: a frame's
# channel is the one the monitor was on when it arrived.
#
# 802.11 management frame, as much as is parsed (all little-endian):
#   0..1   frame control: bits 2-3 type (0 = management), bits 4-7 subtype (4 = probe request)
#   2..3   duration
#   4..9   addr1 (destination; broadcast for a probe request)
#   10..15 addr2 (source = the station's MAC -- the fox's spoofed one)
#   16..21 addr3 (BSSID; broadcast)
#   22..23 sequence control
#   24..   body: information elements, each  tag(1) len(1) value(len);  tag 0 is the SSID
# A probe request's body starts at the IEs directly (no fixed fields), so SSID is at 24 when it is first --
# but the parser walks the IEs rather than assuming that.

import json
import sys
import time

CHANNELS = (1, 6, 11)       # where a station probing for a 2.4 GHz network sends; hop among them
DWELL_S = 0.5               # per channel
IDLE_MS = 3000
PROBE_REQ = (0, 4)          # (type, subtype)


def now_ms():
    return time.monotonic_ns() // 1_000_000 & 0xFFFFFFFF


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")))
    sys.stdout.write("\n")


def parse_probe_request(raw):
    """(mac, ssid) for a probe-request frame, else None. Pure function; firmware/sim/test_sniffer_parse.py feeds it."""
    if len(raw) < 24:
        return None
    fc = raw[0]
    if ((fc >> 2) & 3, (fc >> 4) & 0xF) != PROBE_REQ:
        return None
    mac = ":".join("%02x" % b for b in raw[10:16])
    ssid = ""
    i = 24
    while i + 2 <= len(raw):
        tag, ln = raw[i], raw[i + 1]
        if i + 2 + ln > len(raw):
            break
        if tag == 0:
            try:
                ssid = bytes(raw[i + 2:i + 2 + ln]).decode()
            except UnicodeError:
                ssid = bytes(raw[i + 2:i + 2 + ln]).hex()
            break
        i += 2 + ln
    return mac, ssid


def main():
    import wifi
    wifi.radio.enabled = True
    emit({"t": "hello", "role": "sniffer", "proto": 1, "channels": list(CHANNELS)})
    last = now_ms()
    idle_sent = False
    ci = 0
    while True:
        ch = CHANNELS[ci % len(CHANNELS)]
        ci += 1
        mon = wifi.Monitor(channel=ch)
        t_end = time.monotonic() + DWELL_S
        try:
            while time.monotonic() < t_end:
                p = mon.packet()
                if not p:
                    if now_ms() - last > IDLE_MS and not idle_sent:
                        emit({"t": "idle", "ms": now_ms()})
                        idle_sent = True
                    time.sleep(0.005)
                    continue
                r = parse_probe_request(p[wifi.Packet.RAW])
                if r is None:
                    continue
                emit({"t": "probe", "mac": r[0], "ssid": r[1], "rssi": p[wifi.Packet.RSSI], "ch": p[wifi.Packet.CH], "ms": now_ms()})
                last = now_ms()
                idle_sent = False
        finally:
            mon.deinit()


# CircuitPython runs code.py as __main__; the sim's parser test imports this file on CPython, where it must not.
if sys.implementation.name == "circuitpython":
    main()
