#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# sim/run.py -- run a template's code.py against mocked hardware on a virtual clock.
#
#   python3 firmware/sim/run.py                 all templates, all scenarios
#   python3 firmware/sim/run.py morse-songs     one template
#   python3 firmware/sim/run.py morse-songs --scenario low -v
#
# For each scenario: stage a deploy set (foxlib/, code.py, defaults.json,
# fox.json, images.bin) exactly as the page would, exec code.py, record what
# the hardware saw, check the expectations in scenarios.json.
import argparse, json, os, shutil, sys, tempfile, re, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
FW = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import mocks, decode  # noqa: E402
import importlib.util
_spec = importlib.util.spec_from_file_location("_fwcfg", os.path.join(FW, "foxlib", "cfg.py"))
fwcfg = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_spec and fwcfg)
BOARD_NAMES = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "A0", "A1", "A2", "A3", "TX", "RX"]


def deep_merge(base, over):
    out = json.loads(json.dumps(base))
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def stage(template, board_id, fox_cfg, raw_fox=None):
    d = tempfile.mkdtemp(prefix="foxsim-")
    shutil.copytree(os.path.join(FW, "foxlib"), os.path.join(d, "foxlib"), ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(os.path.join(FW, "templates", template, "code.py"), os.path.join(d, "code.py"))
    shutil.copy(os.path.join(FW, "templates", template, "defaults", board_id + ".json"), os.path.join(d, "defaults.json"))
    if raw_fox is not None:
        open(os.path.join(d, "fox.json"), "w").write(raw_fox)
    elif fox_cfg is not None:
        json.dump(fox_cfg, open(os.path.join(d, "fox.json"), "w"))
    return d


def run_one(template, scen, verbose=False):
    board_id = scen.get("board_id", "seeed_xiao_esp32c3")
    defaults = json.load(open(os.path.join(FW, "templates", template, "defaults", board_id + ".json")))
    fox_cfg = None if scen.get("no_fox_json") else deep_merge(defaults, scen.get("fox", {}))
    d = stage(template, board_id, fox_cfg, scen.get("raw_fox"))
    eff, _ = fwcfg.validate(fox_cfg or {}, defaults, BOARD_NAMES, board_id)   # what the firmware will actually use
    rec = mocks.install({**scen, "pin_roles": eff["pins"], "board_id": board_id, "divider_ratio": eff["battery"]["divider_ratio"], "board_names": BOARD_NAMES})
    rec.effective_cfg = eff
    for m in [m for m in sys.modules if m == "foxlib" or m.startswith("foxlib.")]:
        del sys.modules[m]
    cwd = os.getcwd()
    os.chdir(d)
    sys.path.insert(0, d)
    out_lines = []
    import builtins
    real_print = builtins.print
    builtins.print = lambda *a, **k: out_lines.append(" ".join(str(x) for x in a))
    err = None
    try:
        code = open("code.py").read()
        exec(compile(code, "code.py", "exec"), {"__name__": "__main__"})
    except mocks.SimDone:
        pass
    except Exception as e:
        err = traceback.format_exc()
    finally:
        builtins.print = real_print
        os.chdir(cwd)
        sys.path.remove(d)
        shutil.rmtree(d, ignore_errors=True)
    rec.prints = out_lines
    rec.tone(rec.clock.ns / 1e6, 0)
    return rec, err


def check(template, scen, rec, err):
    exp = scen.get("expect", {})
    fails = []
    banner = next((l for l in rec.prints if l.startswith("FOX ")), None)
    kv = dict(re.findall(r"(\w+)=(\S+)", banner or ""))
    if err:
        fails.append("exception:\n" + err)
    for k, want in exp.get("banner", {}).items():
        got = kv.get(k)
        if got is None or not (got == want or got.startswith(want)):
            fails.append("banner %s=%s, want %s" % (k, got, want))
    keyed = rec.keyed_intervals()
    if exp.get("never_keyed") and keyed:
        fails.append("keyed %d times, expected never" % len(keyed))
    if exp.get("keyed_min") and len(keyed) < exp["keyed_min"]:
        fails.append("keyed %d times, want >= %d" % (len(keyed), exp["keyed_min"]))
    if exp.get("ptt_released", True) and rec.ptt and rec.ptt[-1][1]:
        fails.append("PTT left keyed at end")
    eff = rec.effective_cfg
    tone_hz = eff["id"]["tone_hz"]
    unit = (eff["payload"].get("dit_s") or (1200 / eff["id"]["wpm"] / 1000)) * 1000 if eff["payload"]["kind"] == "none" else 1200 / eff["id"]["wpm"]
    texts, kinds = [], set()
    for s, e in keyed:
        t = decode.tones_in(rec.tones, s, e)
        texts.append(decode.morse_text(t, tone_hz, unit))
        kinds |= decode.classify(t, tone_hz)
    for i, want in enumerate(exp.get("id_contains", [])):
        if want is None:
            continue
        if i >= len(texts) or want not in texts[i]:
            fails.append("tx %d decoded %r, want it to contain %r" % (i, texts[i] if i < len(texts) else None, want))
    for k in exp.get("kinds", []):
        if k not in kinds:
            fails.append("no %s heard (kinds=%s)" % (k, sorted(kinds)))
    for k in exp.get("not_kinds", []):
        if k in kinds:
            fails.append("%s heard but should not be" % k)
    if "max_keyed_ms" in exp:
        worst = max((e - s) for s, e in keyed if e) if keyed else 0
        if worst > exp["max_keyed_ms"]:
            fails.append("longest keydown %.0f ms > %d" % (worst, exp["max_keyed_ms"]))
    if "retunes_min" in exp and len(rec.retunes) < exp["retunes_min"]:
        fails.append("retunes %d < %d" % (len(rec.retunes), exp["retunes_min"]))
    if "waits" in exp and len(keyed) >= 2:
        gaps = [keyed[i + 1][0] - keyed[i][1] for i in range(len(keyed) - 1)]
        lo, hi = exp["waits"]
        bad = [g for g in gaps if not (lo <= g <= hi)]
        if bad:
            fails.append("gaps between transmissions outside [%d,%d]: %s" % (lo, hi, [round(g) for g in bad][:6]))
    for want in exp.get("prints_contain", []):
        if not any(want in l for l in rec.prints):
            fails.append("no print containing %r" % want)
    return fails, banner, texts, sorted(kinds), keyed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("template", nargs="?", default="all")
    ap.add_argument("--scenario")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    scen_all = json.load(open(os.path.join(HERE, "scenarios.json")))
    templates = sorted(k for k in scen_all if k != "all" and not k.startswith("_")) if a.template == "all" else [a.template]
    total = failed = 0
    for t in templates:
        scens = [s for s in scen_all.get("all", []) + scen_all.get(t, []) if not a.scenario or s["name"] == a.scenario]
        for s in scens:
            total += 1
            rec, err = run_one(t, s, a.verbose)
            fails, banner, texts, kinds, keyed = check(t, s, rec, err)
            status = "ok  " if not fails else "FAIL"
            print("%s %-14s %-16s keyed=%-3d kinds=%-24s t=%.0fs" % (status, t, s["name"], len(keyed), ",".join(kinds), rec.clock.ns / 1e9))
            if a.verbose or fails:
                print("     banner:", banner)
                for i, x in enumerate(texts[:4]):
                    print("     tx%d: %s" % (i, x))
                for l in rec.prints[-6:] if a.verbose else []:
                    print("     |", l)
            for f in fails:
                failed += 1
                print("     ✗", f)
    print("\n%d scenario runs, %d failures" % (total, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
