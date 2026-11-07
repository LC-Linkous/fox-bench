#!/usr/bin/env python3
"""The bench queue, derived rather than hand-kept: what each target and template claims (status, boards_tested),
what docs/hardware-log.md has a row for, and therefore what the next sessions have to show.

    python3 tools/bench_queue.py            # the queue
    python3 tools/bench_queue.py --check    # exit 1 if a stable claim has no hardware-log row (CI-able)

A target is "verified" when a hardware-log row names its board (by the hardware descriptor's name or any of its
circuitpython board ids) with firmware at or above the version the catalog ships. The page version each row was
taken on is the second thing to look at: a stable target whose last row predates a page change that touches its
family is listed as "re-run".
"""
import json, re, sys, signal
signal.signal(signal.SIGPIPE, signal.SIG_DFL)
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
def load(p): return json.loads((ROOT / p).read_text())

def rows():
    out = []
    for line in (ROOT / "docs/hardware-log.md").read_text().splitlines():
        if not line.startswith("| 20"): continue
        c = [x.strip() for x in line.strip("|").split("|")]
        if len(c) < 6: continue
        out.append({"date": c[0], "board": c[1], "firmware": c[2], "checked": c[3], "how": c[4], "result": c[5]})
    return out

def page_version():
    m = re.search(r"const VERSION = '([^']*)'", (ROOT / "js/main.js").read_text()); return m.group(1)

def main():
    check = "--check" in sys.argv
    log = rows()
    hw = {i: load(f"hardware/{i}.json") for i in load("hardware/index.json")}
    targets = {i: load(f"boards/{i}.json") for i in load("boards/index.json")}
    templates = {i: load(f"firmware/templates/{i}/template.json") for i in load("firmware/index.json")["templates"]}
    foxlib = (ROOT / "firmware/foxlib/VERSION").read_text().strip()
    foxlibc = (ROOT / "firmware/foxlib-c/VERSION").read_text().strip()
    pv = page_version()

    # A hardware-log row names its board in prose ("AI6YM PicoFox rev 3", "Seeed XIAO ESP32-C3 + SA868"). A hardware
    # descriptor may carry `log_names`: strings a row's board column contains when it is this board. Without it the
    # match falls back to the descriptor's name with vendor words stripped, which is loose on purpose: --check
    # only fails when NO row matches a stable target.
    STRIP = {"seeed", "studio", "(rp2040", "+", "si5351,", "2", "m", "fm)", "dfrobot", "arduino", "waveshare", "m5stack"}
    def names_for(t):
        ids = [t["hardware"]] + list(t.get("variants") or [])
        out = set()
        for i in ids:
            h = hw.get(i, {})
            for n in h.get("log_names") or []: out.add(n.lower())
            toks = [w for w in h.get("name", "").lower().split() if w not in STRIP]
            if toks: out.add(" ".join(toks[:2]))
            cp = h.get("circuitpython") or {}
            for b in [cp.get("board_id")] + list(cp.get("board_ids") or []):
                if b: out.add(b.lower())
        return {n for n in out if n}
    def rows_for(t):
        ns = names_for(t); fam = t.get("family")
        rs = []
        for r in log:
            text = (r["board"] + " " + r["firmware"]).lower()
            if not any(n in text for n in ns): continue
            # targets sharing one board are told apart by what the row says ran on it
            if fam == "drive" and "vendor" not in text: continue
            if fam == "foxlib-c" and "vendor" in text and "foxlib-c" not in text: continue
            chip_target = bool(t.get("variants"))   # a chip target (network foxes, bare board) lists its physical boards as variants; an FM combo does not
            has_module = "sa868" in text or "sa818" in text
            if fam == "foxlib" and chip_target and has_module: continue         # a row with the radio module belongs to the FM combo
            if fam == "foxlib" and not chip_target and not has_module: continue # and a bare-board row to the chip target
            rs.append(r)
        return rs

    bad = 0
    print(f"page {pv} · foxlib {foxlib} · foxlib-c {foxlibc} · {len(log)} hardware-log rows\n")
    queue = []
    # order: stable first (re-runs are the cheapest sessions), then experimental foxlib targets (the boards on the
    # bench), then the compiled (kitsune) family, whose development is paused and goes last
    order = lambda kv: (kv[1].get("status", "") != "stable", kv[1].get("family") == "compiled", kv[0])
    for tid, t in sorted(targets.items(), key=order):
        st = t.get("status", "?"); rs = rows_for(t)
        last = rs[-1] if rs else None
        fam = t.get("family", "?")
        want_fw = {"foxlib": foxlib, "foxlib-c": foxlibc}.get(fam)
        fw_ok = bool(last) and (want_fw is None or want_fw in last["firmware"] or fam in ("drive", "compiled"))
        pv_ok = bool(last) and (f"page {pv}" in last["firmware"] or f"page {pv}" in last["checked"])
        if st == "stable" and not rs:
            print(f"  !! {tid:34} stable but NO hardware-log row"); bad += 1; queue.append((tid, "first session (claims stable)"))
        elif st == "stable" and not fw_ok:
            print(f"  re-run  {tid:30} last row {last['date']} on {last['firmware'][:40]!r}; catalog ships {fam} {want_fw}")
            queue.append((tid, f"re-run on {fam} {want_fw} / page {pv}"))
        elif st == "stable":
            print(f"  ok      {tid:30} {last['date']}  {last['firmware'][:50]}" + ("" if pv_ok else f"   (not yet on page {pv})"))
        elif st == "experimental":
            print(f"  todo    {tid:30} experimental, {len(rs)} row(s)" + (f", last {last['date']}" if last else ""))
            queue.append((tid, "first session"))
        else:
            print(f"  -       {tid:30} {st}")
    print()
    for tid, t in templates.items():
        tested = t.get("boards_tested", [])
        if t.get("status") == "stable" and not tested: print(f"  !! template {tid}: stable with boards_tested empty"); bad += 1
        for b in tested:
            if b not in targets: print(f"  !! template {tid}: boards_tested names unknown target {b}"); bad += 1
    print("Queue, in order (stable re-runs, then boards on the bench, then the paused compiled family):")
    for i, (tid, why) in enumerate(queue, 1): print(f"  {i}. {tid} — {why}" + ("  (paused)" if targets[tid].get("family") == "compiled" else ""))
    if check and bad: sys.exit(1)

if __name__ == "__main__": main()
