#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# sim/pty_sniffer.py -- a fake tools/sniffer board on a pseudo-terminal, for testing tools/hw_smoke.py --sniffer
# without a second board.
#
#   python3 firmware/sim/pty_sniffer.py --mac F2:B0:00:00:00:05 --ssid "W1ABC FOX DE W1ABC"     prints its port
#
# Prints the sniffer's hello, then one synthetic probe line per second from the given MAC with the given SSID
# (plus the odd stranger, so a check that filters by MAC has something to filter), and idle lines when told to be
# quiet. Same line-JSON as tools/sniffer/code.py. Linux/macOS only (openpty).
import argparse, json, os, pty, sys, time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mac", default="F2:B0:00:00:00:05", help="the fox's MAC the probes come from")
    ap.add_argument("--ssid", default="FOXBENCH WiFi Probe")
    ap.add_argument("--rate", type=float, default=1.0, help="probes per second")
    ap.add_argument("--quiet-after", type=float, default=0, help="stop probing after this many seconds (0 = never): the fox went to sleep")
    a = ap.parse_args()
    master, slave = pty.openpty()
    print(os.ttyname(slave), flush=True)
    def emit(o): os.write(master, (json.dumps(o, separators=(",", ":")) + "\n").encode())
    t0 = time.monotonic(); n = 0; idle_sent = False; hello_at = -99
    while True:
        t = time.monotonic() - t0
        if t - hello_at > 2:       # a real board says hello once at boot; this one repeats it so a reader that opens late still sees one
            emit({"t": "hello", "role": "sniffer", "proto": 1, "channels": [1, 6, 11]}); hello_at = t
        time.sleep(1.0 / a.rate)
        t = time.monotonic() - t0
        if a.quiet_after and t > a.quiet_after:
            if not idle_sent: emit({"t": "idle", "ms": int(t * 1000)}); idle_sent = True
            continue
        n += 1
        emit({"t": "probe", "mac": a.mac.lower(), "ssid": a.ssid, "rssi": -40 - (n % 7), "ch": (1, 6, 11)[n % 3], "ms": int(t * 1000)})
        if n % 4 == 0:   # a passer-by's phone probing for its home network
            emit({"t": "probe", "mac": "3c:22:fb:%02x:%02x:%02x" % (n, n * 3 & 0xff, n * 7 & 0xff), "ssid": "xfinitywifi", "rssi": -71, "ch": 6, "ms": int(t * 1000)})


if __name__ == "__main__":
    try: main()
    except (BrokenPipeError, OSError): pass
