#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# The 802.11 parser in tools/sniffer/code.py against hand-built frames. Run: python3 firmware/sim/test_sniffer_parse.py
import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("sniffer", os.path.join(HERE, "..", "..", "tools", "sniffer", "code.py"))
sniffer = importlib.util.module_from_spec(spec); spec.loader.exec_module(sniffer)
parse = sniffer.parse_probe_request


def frame(fc0, src, ies):
    """Management frame: fc(2) dur(2) addr1(6) addr2(6) addr3(6) seq(2) body."""
    bc = b"\xff" * 6
    body = b"".join(bytes([tag, len(val)]) + val for tag, val in ies)
    return bytes([fc0, 0]) + b"\x00\x00" + bc + bytes.fromhex(src.replace(":", "")) + bc + b"\x10\x00" + body


PROBE_REQ_FC0 = 0x40     # type 0 (management), subtype 4: bits 4-7 = 0100
BEACON_FC0 = 0x80        # subtype 8
PROBE_RESP_FC0 = 0x50    # subtype 5

fails = 0
def check(name, got, want):
    global fails
    ok = got == want
    fails += not ok
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  got %r want %r" % (got, want)))

print("sniffer parser")
f = frame(PROBE_REQ_FC0, "F2:B0:00:00:00:05", [(0, b"FOXBENCH WiFi Probe"), (1, b"\x02\x04\x0b\x16")])
check("probe request: fox MAC + SSID", parse(f), ("f2:b0:00:00:00:05", "FOXBENCH WiFi Probe"))
check("rates IE first, SSID second: still found", parse(frame(PROBE_REQ_FC0, "aa:bb:cc:dd:ee:ff", [(1, b"\x02\x04"), (0, b"W1ABC")])), ("aa:bb:cc:dd:ee:ff", "W1ABC"))
check("wildcard probe (empty SSID)", parse(frame(PROBE_REQ_FC0, "aa:bb:cc:dd:ee:ff", [(0, b"")])), ("aa:bb:cc:dd:ee:ff", ""))
check("no SSID IE at all", parse(frame(PROBE_REQ_FC0, "aa:bb:cc:dd:ee:ff", [(1, b"\x02")])), ("aa:bb:cc:dd:ee:ff", ""))
check("beacon is not a probe request", parse(frame(BEACON_FC0, "aa:bb:cc:dd:ee:ff", [(0, b"X")])), None)
check("probe response is not a probe request", parse(frame(PROBE_RESP_FC0, "aa:bb:cc:dd:ee:ff", [(0, b"X")])), None)
check("data frame (type 2) ignored", parse(frame(0x08, "aa:bb:cc:dd:ee:ff", [])), None)
check("runt frame", parse(b"\x40\x00\x00"), None)
check("truncated IE does not run past the end", parse(frame(PROBE_REQ_FC0, "aa:bb:cc:dd:ee:ff", []) + bytes([0, 40]) + b"short"), ("aa:bb:cc:dd:ee:ff", ""))
check("non-UTF-8 SSID comes out as hex", parse(frame(PROBE_REQ_FC0, "aa:bb:cc:dd:ee:ff", [(0, b"\xff\xfe")])), ("aa:bb:cc:dd:ee:ff", "fffe"))
check("memoryview input (what wifi.Monitor hands over)", parse(memoryview(f)), ("f2:b0:00:00:00:05", "FOXBENCH WiFi Probe"))
print("%d check(s), %d failed" % (11, fails))
sys.exit(1 if fails else 0)
