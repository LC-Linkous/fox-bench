#!/usr/bin/env python3
"""console_test.py — the console corpus against the real console.c (host build) and the page's FakeConsoleLink.

    python3 console_test.py [--bin build/console_sim] [-v]

Fails when the firmware's reply to a command stops matching the corpus, or when the fake the page's demo and unit
tests run against answers differently from the firmware (the two had drifted: `batt` without `note=`, `status`
without `uptime=`/`version=`). Regexes marked c_only are checked on the firmware only.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__)); FW = os.path.dirname(os.path.dirname(HERE))
def key(c): return " ; ".join([c["cmd"], *c.get("then", [])])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--bin", default=os.path.join(HERE, "build", "console_sim")); ap.add_argument("-v", action="store_true"); a = ap.parse_args()
    corpus = json.load(open(os.path.join(HERE, "console_corpus.json")))
    fails = 0; n = 0
    d = tempfile.mkdtemp(prefix="foxlibc-console-")
    try:
        defaults = json.load(open(os.path.join(FW, "templates", "morse-songs", "defaults", "picofox-foxlibc.json")))
        json.dump(defaults, open(os.path.join(d, "defaults.json"), "w"))
        fox = json.loads(json.dumps(defaults)); fox["id"]["callmessage"] = corpus["drive"]["callsign"]
        json.dump(fox, open(os.path.join(d, "fox.json"), "w"))
        # one console_sim run per case: each needs its own advance_ms, and a bench action must not bleed into the next
        c_out = {}
        for c in corpus["cases"]:
            # "then": more commands in the same run; the case's checks apply to the last reply
            r = subprocess.run([a.bin, d, "--advance-ms", str(c.get("advance_ms", 100)), c["cmd"], *c.get("then", [])], capture_output=True, text=True, check=True)
            c_out[key(c)] = json.loads(r.stdout)[-1]
        # F15: with no callsign the cycle is silent, and so must the bench actions be (key/tone/id used to go on the air)
        fox["id"]["callmessage"] = "N0CALL DECOY DECOY N0CALL"; json.dump(fox, open(os.path.join(d, "fox.json"), "w"))
        unset = {}
        for cmd in ("key 1", "tone 800 1", "id"):
            r = subprocess.run([a.bin, d, "--advance-ms", "1500", cmd], capture_output=True, text=True, check=True)
            unset[cmd] = json.loads(r.stdout)[0]
    finally: shutil.rmtree(d)
    for cmd, co in unset.items():
        n += 1
        if not re.search(r"^err: callsign unset", co["out"]) or co["keyed"]: fails += 1; print(f"FAIL firmware {cmd!r} with the callsign unset: {co['out']!r} keyed={co['keyed']}")
    node = shutil.which("node")
    j_out = {}
    if node:
        r = subprocess.run([node, os.path.join(HERE, "host_sim", "console_fake.mjs"), os.path.join(HERE, "console_corpus.json")], capture_output=True, text=True, check=True)
        j_out = {x["cmd"]: x for x in json.loads(r.stdout)}
    for c in corpus["cases"]:
        co = c_out[key(c)]; c_only = set(c.get("c_only", []))
        if c.get("then"): c_only |= set(c["expect"])   # a sequence is firmware-only
        for rx in c["expect"]:
            n += 1
            if not re.search(rx, co["out"]): fails += 1; print(f"FAIL firmware {c['cmd']!r}: no match for {rx!r} in {co['out']!r}")
            if j_out and rx not in c_only and c["cmd"] in j_out:
                n += 1
                if not re.search(rx, j_out[c["cmd"]]["out"]): fails += 1; print(f"FAIL fake     {c['cmd']!r}: no match for {rx!r} in {j_out[c['cmd']]['out']!r}")
        if "keyed_after" in c and bool(co["keyed"]) != c["keyed_after"]: fails += 1; print(f"FAIL firmware {key(c)!r}: keyed={co['keyed']} after {co['ms']} ms, expected {c['keyed_after']}")
        if c.get("bootsel") and not co["bootsel"]: fails += 1; print(f"FAIL firmware {c['cmd']!r}: no bootloader request")
        if a.v: print(f"{key(c)!r}: C {co['out']!r}" + (f"\n{'':>{len(c['cmd'])+4}}JS {j_out[c['cmd']]['out']!r}" if j_out and c['cmd'] in j_out else ""))
    print(f"console: {len(corpus['cases'])} command(s), {n} check(s){'' if node else ' (node not found: firmware only)'}, {fails} failed")
    return 1 if fails else 0

if __name__ == "__main__": sys.exit(main())
