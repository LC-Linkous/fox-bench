#!/usr/bin/env python3
"""si5351_ref.py — the Si5351 register math of picofox/si5351.c against the datasheet's formulas (AN619).

    python3 si5351_ref.py [--bin build/si5351_sim] [-v]

Runs the host build of the real driver over a fake I2C controller for a sweep of 2 m frequencies and checks:
the even-integer MultiSynth divider keeps the VCO in 600–900 MHz; PLLA = a + b/c with c = 2^20 − 1 encodes to
registers 26..33 exactly as AN619 says (P1 = 128a + ⌊128b/c⌋ − 512, P2 = 128b − c⌊128b/c⌋, P3 = c); the carrier
the registers encode is within 2 Hz of the request; the deviation counts for 2.5 kHz follow dev·div/xtal·c; an FM
offset rewrites only registers 28..33 (6 bytes), an identical offset touches the bus not at all; after a write
times out the next offset rewrites the whole 26..33 block; outputs are off after init; a correction_ppm moves the
registers, not the reported carrier.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
C = (1 << 20) - 1; XTAL = 25e6

def divider(hz):
    d = int(900e6 / hz); d -= d & 1; d = max(6, min(254, d))
    while hz * d < 600e6 and d < 254: d += 2
    return d

def encode(a, b, c):
    q = (128 * b) // c
    p1, p2, p3 = 128 * a + q - 512, 128 * b - c * q, c
    return bytes([(p3 >> 8) & 0xFF, p3 & 0xFF, (p1 >> 16) & 3, (p1 >> 8) & 0xFF, p1 & 0xFF, ((p3 >> 12) & 0xF0) | ((p2 >> 16) & 0x0F), (p2 >> 8) & 0xFF, p2 & 0xFF]).hex()

def pll(hz, xtal, d):
    mult = hz * d / xtal; a = int(mult); b = int((mult - a) * C + 0.5)
    if b >= C: b = 0; a += 1
    return a, b

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--bin", default=os.path.join(HERE, "build", "si5351_sim")); ap.add_argument("-v", action="store_true"); a = ap.parse_args()
    fails = 0; checks = 0
    def check(cond, what):
        nonlocal fails, checks; checks += 1
        if not cond: fails += 1; print("FAIL " + what)
    sweep = [144.0e6 + k * 12.5e3 for k in range(0, 321, 7)] + [146565000.0, 147999000.0, 144100000.0, 146.52e6]
    def run(*flags):
        return json.loads(subprocess.run([a.bin, *flags, *[f"{hz:.1f}" for hz in sweep]], capture_output=True, text=True, check=True).stdout)
    r = run()
    check(r["init"] == 1, "init with a chip that answers")
    check(r["reg3"] == 0xFF, f"outputs all disabled after init (reg 3 = {r['reg3']:#x})")
    check(r["reg16"] == 0x4C, f"CLK0 control: MS0 integer mode, PLLA, 2 mA (reg 16 = {r['reg16']:#x})")
    check(r["reg183"] == 0x52, "XTAL_CL 6 pF")
    check(r["ms0"] == encode(6, 0, 1), f"MS0 integer 6 encodes as AN619 says ({r['ms0']})")
    for c in r["carriers"]:
        hz = c["hz"]; d = divider(hz); a_, b_ = pll(hz, XTAL, d)
        vco = hz * d
        check(c["ok"] == 1, f"{hz:.0f}: set_carrier ok")
        check(c["div"] == d and d % 2 == 0 and 6 <= d <= 254, f"{hz:.0f}: divider {c['div']} (ref {d})")
        check(600e6 <= vco <= 900e6, f"{hz:.0f}: VCO {vco / 1e6:.1f} MHz in 600–900")
        check(c["pll"] == encode(a_, b_, C), f"{hz:.0f}: PLLA registers {c['pll']} (ref {encode(a_, b_, C)} for a={a_} b={b_})")
        enc = XTAL * (a_ + b_ / C) / d
        check(abs(c["carrier"] - hz) < 2.0 and abs(c["carrier"] - enc) < 0.01, f"{hz:.0f}: carrier from registers {c['carrier']:.3f} (ref {enc:.3f}, request {hz:.1f})")
        check(c["counts"] == int(2500.0 * d / XTAL * C + 0.5), f"{hz:.0f}: deviation counts {c['counts']} (ref {int(2500.0 * d / XTAL * C + 0.5)})")
        check(c["offset_write"] == [28, 6] and c["offset_writes"] == 1, f"{hz:.0f}: FM offset writes 28..33 once ({c['offset_write']}, {c['offset_writes']} write(s))")
        check(c["repeat_writes"] == 0, f"{hz:.0f}: an identical offset does not touch the bus ({c['repeat_writes']})")
        check(c["set_writes"] == 2 if c["div"] == 6 else c["set_writes"] == 3, f"{hz:.0f}: set_carrier writes PLLA + reset (+ MS0 when the divider changed): {c['set_writes']}")
        check(c["out_enabled"] == 0, f"{hz:.0f}: output still disabled (nothing keys the carrier but si5351_output)")
    check(r["bus_errors"] == 0, "no bus errors in the clean run")
    # a write that times out: recover() counts it, and the next FM offset rewrites the whole block (the chip's 28..33 are unknown)
    first_set_write = r["init_writes"] + 1
    rf = json.loads(subprocess.run([a.bin, "--fail-write", str(first_set_write), "146565000.0"], capture_output=True, text=True, check=True).stdout)
    c = rf["carriers"][0]
    check(rf["bus_errors"] == 1, f"a timed-out write is counted ({rf['bus_errors']})")
    check(c["ok"] == 0, "set_carrier reports the failed write")
    check(c["offset_write"] == [26, 8], f"after a bus error the next offset rewrites 26..33 as one block ({c['offset_write']})")
    check(rf["i2c_reinits"] == 0, f"the controller abort completed, so no bus clear / re-init ({rf['i2c_reinits']})")
    rs = json.loads(subprocess.run([a.bin, "--stuck-abort", "--fail-write", str(first_set_write), "146565000.0"], capture_output=True, text=True, check=True).stdout)
    check(rs["i2c_reinits"] == 1 and rs["bus_errors"] == 1, f"an abort that never completes → bus clear and one re-init ({rs['i2c_reinits']} re-init(s), {rs['bus_errors']} error(s))")
    check(rs["carriers"][0]["offset_write"] == [26, 8], "…and the next offset still rewrites the whole block")
    # correction: +10 ppm (TCXO fast) → registers computed against 25 MHz × (1 + 1e-5); the reported carrier stays the request
    rp = json.loads(subprocess.run([a.bin, "--ppm", "10", "146565000.0"], capture_output=True, text=True, check=True).stdout)
    c = rp["carriers"][0]; a_, b_ = pll(146565000.0, XTAL * (1 + 10e-6), 6)
    check(c["pll"] == encode(a_, b_, C), f"+10 ppm: registers computed against the corrected reference ({c['pll']} vs {encode(a_, b_, C)})")
    check(abs(c["carrier"] - 146565000.0) < 2.0, f"+10 ppm: carrier reported from the corrected reference {c['carrier']:.3f}")
    check(c["pll"] != r["carriers"][-4]["pll"], "+10 ppm changes the registers")
    if a.v: print(json.dumps(r, indent=1)[:2000])
    print(f"si5351: {len(sweep)} frequencies, {checks} checks, {fails} failed")
    return 1 if fails else 0

if __name__ == "__main__": sys.exit(main())
