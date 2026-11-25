#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# netcfg_parity.py -- core/netcfg (C) against foxlib/netcfg.py on the schema corpus's network cases: the same status
# word, the same report items in the same order, the same effective values for the fields the C side carries.
# Cases whose fox.json carries a contest feature section (payload, checkpoint, sense, stealth) are skipped with a count:
# netcfg.py validates those in full, the C firmware only reports an enabled one as "not in this firmware" until it runs
# them (netcfg.h).
import argparse, json, os, subprocess, sys, tempfile, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "firmware", "sim"))
spec = importlib.util.spec_from_file_location("schema_parity_mod", os.path.join(ROOT, "firmware/sim/schema_parity.py"))
# schema_parity.py runs the whole corpus at import; we only need its loaders, so re-implement the three small ones here
def load_json(p): return json.load(open(os.path.join(ROOT, p)))
def is_net(t): return load_json(f"firmware/templates/{t}/template.json").get("contract") == "net"
def radios_of(bid):
    t = load_json(f"boards/{bid}.json"); return load_json(f"hardware/{t['hardware']}.json").get("radios", []) if t.get("hardware") else []
def names_of(bid):
    t = load_json(f"boards/{bid}.json"); hw = load_json(f"hardware/{t['hardware']}.json")
    return [n for p in hw.get("pins", []) for n in [p["name"]] + p.get("aliases", [])]
import types
_pkg = types.ModuleType("_fwpkg"); _pkg.__path__ = [os.path.join(ROOT, "firmware/foxlib")]; sys.modules["_fwpkg"] = _pkg
for _n in ("report",):
    _s = importlib.util.spec_from_file_location("_fwpkg." + _n, os.path.join(ROOT, "firmware/foxlib", _n + ".py")); _m = importlib.util.module_from_spec(_s); sys.modules["_fwpkg." + _n] = _m; _s.loader.exec_module(_m)
_ns = importlib.util.spec_from_file_location("_fwpkg.netcfg", os.path.join(ROOT, "firmware/foxlib/netcfg.py")); netcfg = importlib.util.module_from_spec(_ns); _ns.loader.exec_module(netcfg)

FEATURES = ("payload", "checkpoint", "sense", "stealth")
ap = argparse.ArgumentParser(); ap.add_argument("--bin", required=True); a = ap.parse_args()
corpus = load_json("firmware/sim/schema_corpus.json")["cases"]
fails, ran, skipped = [], 0, 0
with tempfile.TemporaryDirectory() as td:
    for c in corpus:
        if not is_net(c["template"]): continue
        if any(f in c["user"] for f in FEATURES): skipped += 1; continue
        dpath = os.path.join(ROOT, "firmware/templates", c["template"], "defaults", c["board"] + ".json")
        defaults = json.load(open(dpath))
        upath = os.path.join(td, "fox.json"); json.dump(c["user"], open(upath, "w"))
        radios = radios_of(c["board"]); names = names_of(c["board"])
        eff, rep = netcfg.validate(c["user"], defaults, c["board"], radios, names)
        out = subprocess.run([a.bin, dpath, upath, c["board"], ",".join(radios) or "?"] + names, capture_output=True, text=True)
        try: cres = json.loads(out.stdout)
        except Exception: fails.append(f"{c['name']}: C output not JSON: {out.stdout[:200]!r} {out.stderr[:200]!r}"); continue
        ran += 1
        if cres["status"] != rep.status(): fails.append(f"{c['name']}: status py={rep.status()} c={cres['status']}"); continue
        py_items = [list(x) for x in rep.items]
        if cres["items"] != py_items: fails.append(f"{c['name']}: items py={py_items} c={cres['items']}"); continue
        cc = cres["cfg"]
        for sec in ("pins", "id", "schedule", "led"):
            for k, v in cc.get(sec, {}).items():
                if eff[sec].get(k) != v: fails.append(f"{c['name']}: {sec}.{k} py={eff[sec].get(k)!r} c={v!r}")
        for k, v in cc["net"].items():
            pv = eff["net"].get(k)
            if isinstance(v, float) and isinstance(pv, (int, float)): pv = float(pv)
            if pv != v: fails.append(f"{c['name']}: net.{k} py={pv!r} c={v!r}")
        if cc["variant"] != (eff.get("variant") or ""): fails.append(f"{c['name']}: variant py={eff.get('variant')!r} c={cc['variant']!r}")
for f in fails: print("FAIL", f)
print(f"netcfg parity: {ran} case(s) identical, {skipped} skipped (contest features: not in the C firmware yet), {len(fails)} failed")
sys.exit(1 if fails else 0)
