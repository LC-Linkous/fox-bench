#!/usr/bin/env python3
"""Close a bench session: turn a tools/hw_smoke.py report into the catalog edits the queue expects.

    python3 tools/session_close.py REPORT.json --page 0.9.6 [--recording FILE] [--note "..."] [--target ID] [--apply]

Dry run by default. With --apply it
  1. appends a row to docs/hardware-log.md in the shape tools/bench_queue.py matches: the board column uses the
     hardware descriptor's log_names[0] and names the radio module when one ran (that is how bench_queue tells the
     FM combo from the bare chip target); the firmware column carries foxlib, page and CircuitPython versions;
  2. adds the target to boards_tested in every template.json whose template booted and keyed (ok: true);
  3. prints the status flip it would recommend (experimental -> stable). That edit stays manual: stable is a claim
     you make after looking at the recording, not something a script infers from seven clean boots.

Then run:  python3 tools/bench_queue.py --check && python3 tools/check_catalog.py --since origin/main
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
def load(p): return json.loads((ROOT / p).read_text())

def pick_target(rep, targets, hw, module):
    """The target this board id belongs to. A board with the radio module is the FM combo (a target with no
    `variants`); a bare board is the chip target (its physical boards listed as variants)."""
    bid = rep["board_id"]
    def ids(h):
        cp = h.get("circuitpython") or {}
        return {cp.get("board_id"), *(cp.get("board_ids") or [])}
    cands = []
    for tid, t in targets.items():
        for h in [t["hardware"], *(t.get("variants") or [])]:
            if bid in ids(hw.get(h, {})):
                cands.append(tid); break
    if not cands: sys.exit(f"no target in boards/ has CircuitPython board id {bid!r}")
    want_combo = bool(module)
    fit = [c for c in cands if (not targets[c].get("variants")) == want_combo]
    return (fit or cands)[0], cands

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("report", help="JSON written by tools/hw_smoke.py")
    ap.add_argument("--page", required=True, help="page version the session ran on (the footer)")
    ap.add_argument("--recording", help="the --record file, named in the row")
    ap.add_argument("--note", default="", help="goes on the result column: findings, anything odd")
    ap.add_argument("--how", default="`tools/hw_smoke.py` end to end")
    ap.add_argument("--target", help="override the target id if the guess is wrong")
    ap.add_argument("--apply", action="store_true", help="write the edits (default: print them)")
    a = ap.parse_args()

    rep = json.load(open(a.report))
    targets = {i: load(f"boards/{i}.json") for i in load("boards/index.json")}
    hw = {i: load(f"hardware/{i}.json") for i in load("hardware/index.json")}
    module = rep.get("module")
    if a.target:
        tid = a.target
        if tid not in targets: sys.exit(f"unknown target {tid!r}")
    else:
        tid, cands = pick_target(rep, targets, hw, module)
        if len(cands) > 1: print(f"board id matches {cands}; chose {tid!r} ({'module ran' if module else 'no module'}). --target to override.")
    t = targets[tid]
    h = hw[t["hardware"]]
    board = (h.get("log_names") or [h.get("name", t["hardware"])])[0]
    if module and not t.get("variants"):
        mod_name = load(f"modules/{module}.json").get("name", module) if (ROOT / f"modules/{module}.json").exists() else module
        board = f"{board} + {mod_name}"

    tpls = rep.get("templates") or {}
    passed = [k for k, x in tpls.items() if x.get("ok")]
    failed = [k for k, x in tpls.items() if not x.get("ok")]
    if not tpls: sys.exit("report has no templates — nothing to close")
    date = rep["generated"][:10]
    cp = rep.get("cp_version") or rep.get("circuitpython") or "?"
    fw = f"foxlib {rep.get('foxlib', '?')}, page {a.page}, CircuitPython {cp}"
    checked = f"{len(passed)}/{len(tpls)} templates deployed from the REPL, booted to banner, keyed: {', '.join(passed)}"
    if failed: checked += f"; did not: {', '.join(failed)}"
    sniff = rep.get("sniffer")
    if sniff and sniff != "not used": checked += "; wifi-probe seen by the sniffer"
    how = a.how + (f"; recording `{Path(a.recording).name}`" if a.recording else "")
    result = ("ok" if not failed else f"{len(failed)} template(s) failed") + (f". {a.note}" if a.note else "")
    row = f"| {date} | {board} | {fw} | {checked} | {how} | {result} |"

    edits = []
    for k in passed:
        p = ROOT / f"firmware/templates/{k}/template.json"
        if not p.exists(): print(f"  (no template.json for {k}, skipped)"); continue
        d = json.loads(p.read_text())
        if tid not in d.get("boards_tested", []): edits.append((p, d))

    print(f"target: {tid}  (status: {t.get('status')})")
    print("docs/hardware-log.md +row:\n  " + row)
    print(f"boards_tested += {tid!r}: " + (", ".join(str(p.relative_to(ROOT)) for p, _ in edits) or "already listed everywhere"))
    if t.get("status") == "experimental" and passed and not failed:
        print(f"recommend by hand: boards/{tid}.json status experimental -> stable, and a CHANGELOG line")
    if failed:
        print(f"NOT recommending a status change: {', '.join(failed)} failed")
    if not a.apply:
        print("\ndry run — add --apply to write"); return

    log = ROOT / "docs/hardware-log.md"
    text = log.read_text()
    ends = [m.end() for m in re.finditer(r"^\| 20\d\d-\d\d-\d\d \|.*\|$", text, re.M)]
    if not ends: sys.exit("could not find a dated row in docs/hardware-log.md")
    text = text[:ends[-1]] + "\n" + row + text[ends[-1]:]
    log.write_text(text)
    for p, d in edits:
        # edit the one key in place so the file keeps its formatting (json.dumps would reflow every array)
        src = p.read_text()
        m = re.search(r'"boards_tested"\s*:\s*\[(.*?)\]', src, re.S)
        if m:
            inner = m.group(1)
            new = (inner.rstrip() + (", " if inner.strip() else "") + json.dumps(tid))
            if "\n" in inner: new = inner.rstrip() + ("," if inner.strip() else "") + "\n    " + json.dumps(tid) + "\n  "
            src = src[:m.start(1)] + new + src[m.end(1):]
        else:
            src = re.sub(r'("version"\s*:\s*"[^"]*",\n)', lambda mm: mm.group(1) + f'  "boards_tested": [{json.dumps(tid)}],\n', src, count=1)
        json.loads(src)   # must still parse
        p.write_text(src)
    print(f"written: 1 row, {len(edits)} template.json. Now: python3 tools/bench_queue.py --check && python3 tools/check_catalog.py --since origin/main")

if __name__ == "__main__":
    main()
