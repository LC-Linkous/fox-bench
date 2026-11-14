#!/usr/bin/env python3
"""Goldens for foxlib/netpayload.py: Eddystone-URL encoding, the TLM frame, Morse names. Runs on the host."""
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
check("morse name", np.morse_name("KY4ZR"), "-.- -.-- ....- --.. .-.")
check("morse name two words", np.morse_name("DE W1"), "-.. . / .-- .----")
check("morse name cut at 32", len(np.morse_name("FOXHUNTING")) <= 32, True)
print("%d check(s), %d failed" % (14, fails))
sys.exit(1 if fails else 0)
