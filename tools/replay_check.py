#!/usr/bin/env python3
"""Replay a bench recording into the pty board, run tools/hw_smoke.py against it, and fail unless every template
passes and every command the script sent was in the recording.

    python3 tools/replay_check.py tests/fixtures/bench/pty-c3-all-fm.json

This is how a bench run becomes a CI test: record one with `hw_smoke.py --record`, commit the file under
tests/fixtures/bench/, and this script replays it on every push. A change to hw_smoke.py that sends a command the
recording never saw shows up as a miss; a change to what the script expects shows up as a failed template.
The recording carries the args the run was made with; the same templates and callsign are used here.
"""
import json, os, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    rec_path = sys.argv[1]
    rec = json.load(open(rec_path))
    args = rec.get("args", {})
    tmp = tempfile.mkdtemp(prefix="replay-")
    report, rreport, portf = (os.path.join(tmp, n) for n in ("report.json", "replay.json", "port"))
    with open(portf, "w") as pf:
        board = subprocess.Popen([sys.executable, os.path.join(ROOT, "firmware/sim/pty_board.py"), "--quiet", "--replay", rec_path, "--replay-report", rreport], stdout=pf)
    for _ in range(50):
        time.sleep(0.1)
        port = open(portf).read().strip()
        if port: break
    else: board.kill(); sys.exit("pty board did not start")
    cmd = [sys.executable, os.path.join(ROOT, "tools/hw_smoke.py"), "--port", port, "--yes-antenna", "--report", report,
           "--board", args.get("board", "seeed_xiao_esp32c3"), "--templates", args.get("templates", "all"), "--call", args.get("call", "N0CALL DECOY DECOY N0CALL"),
           "--observe", str(args.get("observe", 0.5)), "--key-seconds", str(args.get("key_seconds", 1))]
    if args.get("freq"): cmd += ["--freq", str(args["freq"])]
    if args.get("module"): cmd += ["--module", args["module"]]
    if args.get("variant"): cmd += ["--variant", args["variant"]]
    p = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(p.stdout[-1500:])
    board.terminate()
    try: board.wait(timeout=5)
    except subprocess.TimeoutExpired: board.kill()
    rr = json.load(open(rreport)) if os.path.exists(rreport) else {"misses": ["(no replay report)"], "used": 0, "total": 0}
    rep = json.load(open(report)) if os.path.exists(report) else None
    bad = []
    if p.returncode != 0: bad.append("hw_smoke exited %d: %s" % (p.returncode, p.stderr.strip().splitlines()[-1:] ))
    if rr["misses"]: bad.append("%d command(s) not in the recording: %s" % (len(rr["misses"]), "; ".join(rr["misses"][:4])))
    if rep:
        failed = [t for t, x in rep["templates"].items() if x.get("ok") is False]
        if failed: bad.append("templates failed on replay: " + ", ".join(failed))
        if rep["uid"] != rec["uid"]: bad.append("uid differs: %s vs recorded %s" % (rep["uid"], rec["uid"]))
    print("\nreplay of %s: %d/%d exchanges used, %d misses, templates %s" % (os.path.basename(rec_path), rr["used"], rr["total"], len(rr["misses"]),
          "all ok" if rep and not [t for t, x in rep["templates"].items() if x.get("ok") is False] else "FAILED"))
    if bad:
        for b in bad: print("  !! " + b)
        sys.exit(1)

if __name__ == "__main__": main()
