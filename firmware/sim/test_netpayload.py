#!/usr/bin/env python3
"""Goldens for foxlib/netpayload.py (Eddystone-URL encoding, the TLM frame, Morse names) and for the netradio.py drivers
against the mocked radios (the BLE address byte order, the bench scan, the access point's MAC at up()). Runs on the host."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run as simrun                                   # loads foxlib through the simulator's package shim
simrun.load_fw("morse"); simrun.load_fw("netradio")
np = simrun.load_fw("netpayload")
fails = 0
def check(name, got, want):
    global fails
    ok = got == want
    fails += 0 if ok else 1
    print("%s %s%s" % ("ok  " if ok else "FAIL", name, "" if ok else " — got %r want %r" % (got, want)))
check("url https://www.example.com", np.encode_url("https://www.example.com").hex(), "01" + "example".encode().hex() + "07")
check("url http://fox.example/3", np.encode_url("http://fox.example/3").hex(), "02" + "fox.example/3".encode().hex())
check("url .org/ code", np.encode_url("https://a.org/x").hex(), "03" + b"a".hex() + "01" + b"x".hex())
check("url too long is None", np.encode_url("https://this-is-a-very-long-hostname.example/path"), None)
check("url no scheme is None", np.encode_url("fox.example"), None)
f = np.eddystone_url_frame("https://fox.example/3", -7)
check("url frame header", f[:6].hex(), "0303aafe" + ("%02x" % (len(f) - 5)) + "16")   # LL = type + uuid(2) + svc
check("url frame body", f[6:].hex(), "aafe10f9" + np.encode_url("https://fox.example/3").hex())
t = np.eddystone_tlm_frame(3700, None, 12, 61.5)
check("tlm frame", t.hex(), "0303aafe" + "1116" + "aafe2000" + "0e74" + "8000" + "0000000c" + "00000267")
check("morse name", np.morse_name("W1ABC"), ".-- .---- .- -... -.-.")
check("morse name two words", np.morse_name("DE W1"), "-.. . / .-- .----")
check("morse name cut at 32", len(np.morse_name("FOXHUNTING")) <= 32, True)
# the drivers against the mocked radios (which follow the CircuitPython ports: see mocks.py)
import mocks
mocks.install({"cap_ms": 600000, "pin_roles": {}, "board_id": "esp32c3", "board_names": [],
               "world": {"advertisers": [{"name": "HUNT-RED", "mac": "C0:00:00:00:00:07", "rssi": -60}, {"name": "", "mac": "C0:00:00:00:00:08", "rssi": -70}]}})
nr = simrun.load_fw("netradio")
ble = nr.make({"kind": "ble", "uuid": "F0B0F0B0-0000-4000-8000-000000000001", "major": 1, "minor": 1, "signal_power_dbm": -59, "adv_min": 100, "adv_max": 100, "tx_power_dbm": 0, "mac": "02:11:22:33:44:55"}, "FOX")
check("ble setup", ble.setup(), True)
check("ble address: little-endian, top bits set, read back as written", ble.mac(), "C2:11:22:33:44:55")
check("ble address bytes", bytes(ble.adapter.address.address_bytes).hex(), "5544332211c2")
check("ble scan: one row per device, the name from the scan response", ble.scan(), [(-60, "HUNT-RED C0:00:00:00:00:07"), (-70, "C0:00:00:00:00:08")])
ap = nr.make({"kind": "wifi-ap", "ssid": "FOX", "psk": "", "channel": 6, "hidden": False, "max_clients": 2, "tx_power_dbm": 13, "mac": "F2:B0:00:00:00:01"}, "FOX")
check("ap setup leaves the MAC for up()", (ap.setup(), ap.mac()), (True, "7C:DF:A1:00:00:0B"))
ap.up()
check("ap up: MAC applied, power set again after the restart", (ap.mac(), ap.mac_error, ap.wifi.radio.tx_power), ("F2:B0:00:00:00:01", None, 13.0))
ap.down()
print("%d check(s), %d failed" % (20, fails))
sys.exit(1 if fails else 0)
