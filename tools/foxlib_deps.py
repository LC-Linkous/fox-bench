#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""foxlib_deps.py -- which foxlib files each template needs, from the import graph.

    python3 tools/foxlib_deps.py            # print the sets
    python3 tools/foxlib_deps.py --write    # write them into firmware/index.json ("foxlib_sets", "template_sets")
    python3 tools/foxlib_deps.py --check    # exit 1 when firmware/index.json is stale (CI; check_catalog runs this)

Deploy writes a template's set and removes the rest of foxlib from the board as stale (page 0.18.12), so the
sets must come from the code, never from a hand-kept list. Edges:

  * an unindented `from . import a, b as c` / `from .a import x` in a foxlib module: unconditional
  * an indented one: conditional on the enclosing `def`; followed only when the walk names that function
    (`foxlib.Fox(...)` in a template's code.py means __init__._fm(), the lazy FM imports)
  * netfeatures.MODULES: the feature modules a network fox may load by name (every one, at this level; a later
    per-feature layer would walk from fox.json's enabled sections instead)
  * a template's code.py: `import foxlib` + `foxlib.Fox(` -> set "fm"; `from foxlib.netfox import` -> set "net"

A set's name is what its entry point is, so two templates with the same entry share one set.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "firmware", "foxlib")
INDEX = os.path.join(ROOT, "firmware", "index.json")
ALWAYS = ("VERSION", "__init__.py")

_FROM_DOT = re.compile(r"^(?P<indent>[ \t]*)from \.(?P<mod>\w*) import (?P<names>[^\n#]+)")
_DEF = re.compile(r"^def (\w+)\(")


def edges(name):
    """[(target module, condition)] for foxlib/<name>.py; condition None = always, else the enclosing def's name."""
    out = []
    func = None                         # the unindented def the line is inside, if any
    for line in open(os.path.join(LIB, name + ".py")):
        if line.strip() and not line[0].isspace() and not line.startswith("#"):
            m = _DEF.match(line)
            func = m.group(1) if m else None
        m = _FROM_DOT.match(line)
        if not m:
            continue
        cond = (func or "<indented>") if m.group("indent") else None
        if m.group("mod"):
            out.append((m.group("mod"), cond))
        else:
            for part in m.group("names").split(","):
                out.append((part.strip().split(" as ")[0].strip(), cond))
    if name == "netfeatures":
        src = open(os.path.join(LIB, "netfeatures.py")).read()
        m = re.search(r"^MODULES = \{(.*)\}", src, re.M)
        for mod in re.findall(r':\s*"(\w+)"', m.group(1)):
            out.append((mod, None))
    return out


def closure(roots, follow):
    """Modules reachable from `roots`; conditional edges followed when (module, def) is in `follow`."""
    seen, todo = set(), list(roots)
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        seen.add(n)
        for tgt, cond in edges(n):
            if cond is None or (n, cond) in follow:
                todo.append(tgt)
    return seen


def entry_of(code):
    """What a template's code.py enters foxlib through."""
    if re.search(r"\bfoxlib\.Fox\(", code):
        return "fm"
    if re.search(r"^from foxlib\.netfox import", code, re.M):
        return "net"
    return None


SETS = {
    "fm": lambda: closure(["__init__"], {("__init__", "_fm")}),
    "net": lambda: closure(["__init__", "netfox"], set()),
}


def compute():
    sets = {k: sorted(set(ALWAYS) | {m + ".py" for m in f()}) for k, f in SETS.items()}
    tsets = {}
    tdir = os.path.join(ROOT, "firmware", "templates")
    for tid in sorted(os.listdir(tdir)):
        cp = os.path.join(tdir, tid, "code.py")
        if os.path.exists(cp):
            e = entry_of(open(cp).read())
            if e is None:
                raise SystemExit("%s: code.py enters foxlib in a way this tool does not know" % tid)
            tsets[tid] = e
    return sets, tsets


def main():
    sets, tsets = compute()
    idx = json.load(open(INDEX))
    if "--check" in sys.argv:
        bad = idx.get("foxlib_sets") != sets or idx.get("template_sets") != tsets
        if bad:
            print("firmware/index.json: foxlib_sets/template_sets are stale; run tools/foxlib_deps.py --write")
        return 1 if bad else 0
    if "--write" in sys.argv:
        idx["foxlib_sets"] = sets
        idx["_foxlib_sets"] = "the foxlib files each entry point needs, from the import graph (tools/foxlib_deps.py --write; never by hand). Deploy writes a template's set and removes the rest of foxlib from the board"
        idx["template_sets"] = tsets
        json.dump(idx, open(INDEX, "w"), indent=2)
        open(INDEX, "a").write("\n")
        print("wrote %s" % os.path.relpath(INDEX, ROOT))
        return 0
    for k, v in sets.items():
        print("%s (%d): %s" % (k, len(v), " ".join(v)))
    for t, e in tsets.items():
        print("  %-20s %s" % (t, e))
    return 0


if __name__ == "__main__":
    sys.exit(main())
