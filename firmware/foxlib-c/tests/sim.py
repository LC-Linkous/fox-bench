#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Run the foxlib-c runner (fox.c, host build with stubbed hardware) through the
same scenarios as the Python firmware (firmware/sim/scenarios.json) and judge the
result with the same decoder. Scenarios that need things this board does not have
(pins, a battery divider, the SA868 UART) are skipped; everything else — banner
status, decoded ID text, kinds of audio, waits between transmissions, keydown
limits, retunes, dead-phase wakes — must hold for the C runner too.

Templates covered: every template whose template.json lists the foxlib-c family
and that has defaults for picofox-foxlibc."""
import argparse, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FW = os.path.join(REPO, "firmware")
sys.path.insert(0, os.path.join(FW, "sim"))
import decode  # noqa: E402

BOARD = "picofox-foxlibc"
SKIP_KEYS = ("battery", "module_silent", "module_ranges", "uart")          # scenario features this family has no hardware for

# scenarios only this family can run (its charger-status telemetry word)
FOXLIBC_ONLY = [
    {"name": "chg-telemetry-charging", "charging": True, "stop_after_unkeys": 1, "cap_ms": 120000,
     "fox": {"id": {"callmessage": "W1ABC FOX", "telemetry": ["chg"]}}, "expect": {"banner": {"cfg": "ok"}, "id_contains": ["W1ABC FOX CHG"]}},
    {"name": "chg-telemetry-idle", "stop_after_unkeys": 1, "cap_ms": 120000,
     "fox": {"id": {"callmessage": "W1ABC FOX", "telemetry": ["chg"]}}, "expect": {"banner": {"cfg": "ok"}, "id_contains": ["W1ABC FOX"], "id_not_contains": ["CHG"]}},
    {"name": "batt-telemetry-ignored-here", "stop_after_unkeys": 1, "cap_ms": 120000,
     "fox": {"id": {"callmessage": "W1ABC FOX", "telemetry": ["batt"]}}, "expect": {"banner": {"cfg": "ok"}, "id_contains": ["W1ABC FOX"], "id_not_contains": ["BAT"]}},
]


def deep_merge(base, over):
    out = json.loads(json.dumps(base))
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def applicable(scen):
    if any(k in scen for k in SKIP_KEYS):
        return False
    fox = scen.get("fox") or {}
    if "pins" in fox:
        return False
    exp = scen.get("expect", {})
    if "uart_contains" in exp:
        return False
    return True


def keyed_intervals(ptt):
    out, start = [], None
    for t, k in ptt:
        if k and start is None:
            start = t
        elif not k and start is not None:
            out.append((start, t))
            start = None
    if start is not None:
        out.append((start, None))
    return out


def check(scen, rec, eff):
    exp = scen.get("expect", {})
    fails = []
    prints = rec["prints"].split("\n")
    banner = next((l for l in prints if l.startswith("FOX ")), None)
    kv = dict(re.findall(r"(\w+)=(\S+)", banner or ""))
    for k, want in exp.get("banner", {}).items():
        got = kv.get(k)
        if k == "cfg":
            # the C family has no pins: Python's pin complaints never appear here
            want = re.sub(r"pins\.\w+,?", "", want).replace("(,", "(").replace(",)", ")")
            if want == "partial()":
                want = "ok"
        if got is None or not (got == want or got.startswith(want)):
            fails.append("banner %s=%s, want %s" % (k, got, want))
    keyed = keyed_intervals(rec["ptt"])
    tones = [(s, e, hz) for s, e, hz in rec["tones"]]
    if exp.get("never_keyed") and keyed:
        fails.append("keyed %d times, expected never" % len(keyed))
    if exp.get("keyed_min") and len(keyed) < exp["keyed_min"]:
        fails.append("keyed %d times, want >= %d" % (len(keyed), exp["keyed_min"]))
    if exp.get("ptt_released", True) and rec["keyed_now"]:
        fails.append("PTT left keyed at end")
    tone_hz = eff["id"]["tone_hz"]
    unit = (eff["payload"].get("dit_s") or (1200 / eff["id"]["wpm"] / 1000)) * 1000 if eff["payload"]["kind"] == "none" else 1200 / eff["id"]["wpm"]
    texts, kinds = [], set()
    for s, e in keyed:
        t = decode.tones_in(tones, s, e)
        texts.append(decode.morse_text(t, tone_hz, unit))
        kinds |= decode.classify(t, tone_hz)
    for i, want in enumerate(exp.get("id_contains", [])):
        if want is None:
            continue
        if i >= len(texts) or want not in texts[i]:
            fails.append("tx %d decoded %r, want it to contain %r" % (i, texts[i] if i < len(texts) else None, want))
    for i, bad_word in enumerate(exp.get("id_not_contains", [])):
        if texts and bad_word in texts[0]:
            fails.append("tx 0 decoded %r, must not contain %r" % (texts[0], bad_word))
    for k in exp.get("kinds", []):
        if k not in kinds:
            fails.append("no %s heard (kinds=%s)" % (k, sorted(kinds)))
    for k in exp.get("not_kinds", []):
        if k in kinds:
            fails.append("%s heard but should not be" % k)
    if "max_keyed_ms" in exp:
        worst = max([(e - s) for s, e in keyed if e] or [0])
        if worst > exp["max_keyed_ms"]:
            fails.append("longest keydown %.0f ms > %d" % (worst, exp["max_keyed_ms"]))
    if "retunes_min" in exp and len(rec["retunes"]) < exp["retunes_min"]:
        fails.append("retunes %d < %d" % (len(rec["retunes"]), exp["retunes_min"]))
    if "waits" in exp and len(keyed) >= 2:
        gaps = [keyed[i + 1][0] - keyed[i][1] for i in range(len(keyed) - 1)]
        lo, hi = exp["waits"]
        bad = [g for g in gaps if not (lo <= g <= hi)]
        if bad:
            fails.append("gaps between transmissions outside [%d,%d]: %s" % (lo, hi, [round(g) for g in bad][:6]))
    for want in exp.get("prints_contain", []):
        if not any(want in l for l in prints):
            fails.append("no print containing %r" % want)
    return fails, banner, texts, sorted(kinds), keyed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", default=os.path.join(HERE, "build", "host_sim"))
    ap.add_argument("-v", action="store_true")
    ap.add_argument("template", nargs="?")
    a = ap.parse_args()
    scenarios = json.load(open(os.path.join(FW, "sim", "scenarios.json")))
    import importlib.util
    spec = importlib.util.spec_from_file_location("_fwcfg", os.path.join(FW, "foxlib", "cfg.py"))
    fwcfg = importlib.util.module_from_spec(spec); spec.loader.exec_module(fwcfg)
    templates = []
    for tid in sorted(os.listdir(os.path.join(FW, "templates"))):
        tj = os.path.join(FW, "templates", tid, "template.json")
        if not os.path.exists(tj):
            continue
        t = json.load(open(tj))
        if "foxlib-c" in t.get("families", []) and os.path.exists(os.path.join(FW, "templates", tid, "defaults", BOARD + ".json")):
            templates.append(tid)
    if a.template:
        templates = [t for t in templates if t == a.template]
    total = fails_n = skipped = 0
    for tid in templates:
        defaults = json.load(open(os.path.join(FW, "templates", tid, "defaults", BOARD + ".json")))
        for scen in scenarios.get("all", []) + scenarios.get(tid, []) + (FOXLIBC_ONLY if tid == "morse-songs" else []):
            if not applicable(scen):
                skipped += 1
                continue
            total += 1
            d = tempfile.mkdtemp(prefix="foxlibc-sim-")
            try:
                json.dump(defaults, open(os.path.join(d, "defaults.json"), "w"))
                if scen.get("raw_fox") is not None:
                    open(os.path.join(d, "fox.json"), "w").write(scen["raw_fox"])
                    user = {}
                elif not scen.get("no_fox_json"):
                    user = deep_merge(defaults, scen.get("fox", {}))
                    json.dump(user, open(os.path.join(d, "fox.json"), "w"))
                else:
                    user = {}
                eff, _ = fwcfg.validate(user, defaults, [], BOARD)
                cmd = [a.bin, d, "--cap-ms", str(scen.get("cap_ms", 180000)), "--stop-after-unkeys", str(scen.get("stop_after_unkeys", 2))] + (["--charging"] if scen.get("charging") else [])
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                if r.returncode != 0:
                    fails_n += 1
                    print("  FAIL %s/%s: host_sim rc=%d %s" % (tid, scen["name"], r.returncode, r.stderr[-300:]))
                    continue
                rec = json.loads(r.stdout)
                fl, banner, texts, kinds, keyed = check(scen, rec, eff)
                ok = not fl
                fails_n += 0 if ok else 1
                print("  %s %s/%s  keyed=%d kinds=%s" % ("ok  " if ok else "FAIL", tid, scen["name"], len(keyed), ",".join(kinds)))
                if a.v or not ok:
                    print("       banner: %s" % banner)
                    for t in texts[:3]:
                        print("       decoded: %s" % t)
                    for f in fl:
                        print("       - %s" % f)
            finally:
                shutil.rmtree(d, ignore_errors=True)
    print("\nfoxlib-c runner: %d scenario(s), %d failed, %d skipped (need hardware this board lacks)" % (total, fails_n, skipped))
    sys.exit(1 if fails_n or not total else 0)


if __name__ == "__main__":
    main()
