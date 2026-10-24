#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# sim/schema_parity.py -- the schema corpus through foxlib/cfg.py (the firmware's fox.json validator).
# Compare with schema_parity.mjs output:
#   python3 firmware/sim/schema_parity.py > py.json && node firmware/sim/schema_parity.mjs > js.json
#   node firmware/sim/schema_parity.mjs --compare py.json js.json
import json, os, sys, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("foxcfg", os.path.join(ROOT, "firmware/foxlib/cfg.py"))
cfg = importlib.util.module_from_spec(spec); spec.loader.exec_module(cfg)

def load_board(bid):
    """A target (boards/) merged with its hardware (hardware/), as the page's loader does."""
    t = json.load(open(os.path.join(ROOT, "boards", bid + ".json")))
    hw = json.load(open(os.path.join(ROOT, "hardware", t["hardware"] + ".json"))) if "hardware" in t else {}
    return {**hw, **t}

def board_names(bid):
    b = load_board(bid)
    names = set()
    for p in b["pins"]:
        names.add(p["name"]); names.update(p.get("aliases", []))
    return names

def canon_pin(bid, name):
    """The firmware stores the name as given (board.A3 and board.D3 are the same pin); the page stores the canonical name. Normalise for comparison."""
    b = load_board(bid)
    for p in b["pins"]:
        if name == p["name"] or name in p.get("aliases", []): return p["name"]
    return name

import types as _types
_pkg = _types.ModuleType("_fwpkg"); _pkg.__path__ = [os.path.join(ROOT, "firmware/foxlib")]; sys.modules["_fwpkg"] = _pkg; sys.modules["_fwpkg.cfg"] = cfg
_nspec = importlib.util.spec_from_file_location("_fwpkg.netcfg", os.path.join(ROOT, "firmware/foxlib/netcfg.py"))
netcfg = importlib.util.module_from_spec(_nspec); _nspec.loader.exec_module(netcfg)
def is_net(t): return json.load(open(os.path.join(ROOT, "firmware/templates", t, "template.json"))).get("contract") == "net"
def radios_of(bid):
    t = json.load(open(os.path.join(ROOT, "boards", bid + ".json")))
    return json.load(open(os.path.join(ROOT, "hardware", t["hardware"] + ".json"))).get("radios", []) if t.get("hardware") else []

corpus = json.load(open(os.path.join(HERE, "schema_corpus.json")))
out = {}
for c in corpus["cases"]:
    defaults = json.load(open(os.path.join(ROOT, "firmware/templates", c["template"], "defaults", c["board"] + ".json")))
    if is_net(c["template"]):
        eff, rep = netcfg.validate(c["user"], defaults, c["board"], radios_of(c["board"]))
        out[c["name"]] = {"status": rep.status(), "cfg": eff}
        continue
    eff, rep = cfg.validate(c["user"], defaults, board_names(c["board"]), c["board"])
    for role, v in list(eff.get("pins", {}).items()):
        if v is not None: eff["pins"][role] = canon_pin(c["board"], v)
    out[c["name"]] = {"status": rep.status(), "cfg": eff}
json.dump(out, sys.stdout, sort_keys=True, separators=(",", ":"))
