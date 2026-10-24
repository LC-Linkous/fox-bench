#!/usr/bin/env python3
"""atten_sweep.py — measure the PicoFox attenuator (foxlib-c, rev 3 boards): a sweep of codes with a timed carrier at each,
you read the meter, the script keeps the table.

    pip install pyserial
    python3 tools/atten_sweep.py --port COM7 [--codes 0,8,16,24,32,40,48,56,64,80,96,112,127] [--hold 6] [--out atten.csv]
    python3 tools/atten_sweep.py --port /dev/ttyACM0 --meter manual      # the default: you type each reading
    python3 tools/atten_sweep.py --port ... --meter none                 # just the sweep, for an instrument that logs by itself

What it does, per code: `atten <code>` (the fox stops its cycle, applies, and restarts), `stop` to keep the cycle off the
air, `key <hold>` for an unmodulated carrier, and — while the carrier is up — asks for the meter reading (dBm, or an
S-meter / relative figure, whatever the instrument gives; keep the unit the same for the whole sweep). The result is a
CSV of code → reading → dB relative to code 0, and a summary of dB per step over the linear part. The last row is
code 0 again, so a drift of the reference reading over the session shows.

Set up first: the fox on a dummy load or a fixed attenuator into the meter (never an antenna — the sweep keys for
`--hold` seconds per code, 13 codes, ~80 s on the air at full power), the console closed in the page (this script
takes the port), fox.json with a callsign (bench actions obey the callsign gate). This is the only measurement on the
PicoFox nobody has made; `docs/picofox-hardware.md` says why it matters (the word format is unverified too — a step
size that is not ~0.25 dB per code, or a non-monotonic curve, is the word format question answering itself).
"""
import argparse, csv, sys, time
from datetime import datetime

try: import serial
except ImportError: sys.exit("pip install pyserial")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True)
    ap.add_argument("--codes", default="0,8,16,24,32,40,48,56,64,80,96,112,127")
    ap.add_argument("--hold", type=float, default=6, help="seconds of carrier per code")
    ap.add_argument("--meter", choices=["manual", "none"], default="manual")
    ap.add_argument("--out", default="atten_sweep.csv")
    ap.add_argument("--unit", default="dBm", help="what you are reading (dBm, S, mW…), recorded in the CSV")
    a = ap.parse_args()
    codes = [int(x) for x in a.codes.split(",") if x.strip()] + [0]
    s = serial.Serial(a.port, 115200, timeout=0.2)

    def cmd(text, wait_ok=True, timeout=5):
        s.reset_input_buffer(); s.write((text + "\r\n").encode()); out = []; t0 = time.time()
        while time.time() - t0 < timeout:
            line = s.readline().decode(errors="replace").strip()
            if line: out.append(line)
            if line == "ok" or line.startswith("ok ") or line.startswith("err"): break
            if not wait_ok and time.time() - t0 > 0.5: break
        return out

    time.sleep(0.3); cmd("stop")
    st = cmd("status")
    rev = next((l for l in st if l.startswith("revision=")), "")
    if "revision=3" not in rev: sys.exit(f"this is not a rev 3 board (no attenuator): {rev or st[:2]}")
    print(f"port {a.port}: {st[0] if st else '?'}\n{rev}")
    print(f"sweep of {len(codes)} codes, {a.hold} s carrier each — readings in {a.unit}; Ctrl-C stops and unkeys\n")
    rows = []
    try:
        for code in codes:
            r = cmd(f"atten {code}")
            if not any(l.startswith("attenuation") for l in r): print(f"  atten {code}: {r}"); continue
            cmd("stop")
            cmd(f"key {a.hold}", wait_ok=False)                       # the ok comes when the carrier ends
            t_key = time.time()
            reading = ""
            if a.meter == "manual":
                try: reading = input(f"  code {code:3d}: carrier up for {a.hold:.0f} s — reading ({a.unit})? ").strip()
                except EOFError: reading = ""
            remaining = a.hold - (time.time() - t_key)
            if remaining > 0: time.sleep(remaining + 0.3)
            s.reset_input_buffer()
            rows.append({"code": code, "reading": reading, "unit": a.unit, "t": datetime.now().isoformat(timespec="seconds")})
            if a.meter == "none": print(f"  code {code:3d}: keyed {a.hold:.0f} s")
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        cmd("stop"); cmd("atten 0"); s.close()
    # dB relative to the first code-0 reading, when the readings are numbers
    ref = next((float(r["reading"]) for r in rows if r["code"] == 0 and r["reading"].replace("-", "").replace(".", "").isdigit()), None)
    for r in rows:
        try: r["rel_db"] = f"{float(r['reading']) - ref:.2f}" if ref is not None else ""
        except ValueError: r["rel_db"] = ""
    with open(a.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["code", "reading", "unit", "rel_db", "t"]); w.writeheader(); w.writerows(rows)
    print(f"\n{len(rows)} rows → {a.out}")
    pts = [(r["code"], float(r["rel_db"])) for r in rows if r["rel_db"] and r["code"] != 0 or (r["rel_db"] == "0.00")]
    if len(pts) >= 3:
        # dB per code over the sweep (least squares), and the biggest non-monotonic step
        n = len(pts); sx = sum(c for c, _ in pts); sy = sum(d for _, d in pts); sxx = sum(c * c for c, _ in pts); sxy = sum(c * d for c, d in pts)
        slope = (n * sxy - sx * sy) / (n * sxx - sx * sx) if n * sxx - sx * sx else 0
        worst = max((abs((pts[i + 1][1] - pts[i][1])) for i in range(len(pts) - 1) if (pts[i + 1][1] - pts[i][1]) * slope < 0), default=0)
        print(f"dB per code ≈ {slope:.3f} (datasheet: 0.25 dB per code → ~31.75 dB at 127); largest step against the trend {worst:.2f} dB")
        print("A slope far from 0.25, or steps against the trend, points at the word format (player.c atten_write) rather than the part.")
    if rows and rows[-1]["code"] == 0 and rows[0]["code"] == 0 and rows[0]["rel_db"] and rows[-1]["rel_db"]:
        print(f"reference drift over the session: {float(rows[-1]['rel_db']):+.2f} dB")
    print("Put the table in docs/hardware-log.md (F10) and the slope in docs/picofox-hardware.md.")
    return 0

if __name__ == "__main__": sys.exit(main())
