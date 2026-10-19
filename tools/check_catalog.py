#!/usr/bin/env python3
"""check_catalog.py — lint everything the page and the firmware read as data.

    python3 tools/check_catalog.py              # whole catalog
    python3 tools/check_catalog.py --since REF  # also: version bumps for what changed since REF

Checks that every index.json entry exists and nothing is unlisted; that
board, module, band, template and song descriptors have the fields the
page and firmware read, with sane values; that every template has a
defaults file for every board and that file validates clean through the
firmware's own cfg.validate(); that a template's foxlib requirement is met
by foxlib/VERSION; and (with --since) that foxlib/VERSION and template
versions were bumped when their files changed.

This is the check that would have caught a stale foxlib file in the tree,
a template defaults file naming a module that is not in modules/, or a
pin role that the board descriptor does not have — the class of mistake
that only shows up on the bench otherwise. Runs in CI (firmware.yml).

SPDX-License-Identifier: GPL-2.0-only
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import importlib.util
_spec = importlib.util.spec_from_file_location("foxcfg", os.path.join(ROOT, "firmware/foxlib/cfg.py"))
fcfg = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(fcfg)   # the firmware's validator, used as-is (pure Python, no board import)

problems = []
def bad(where, what): problems.append(f"{where}: {what}")
def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)
def exists(rel): return os.path.exists(os.path.join(ROOT, rel))
def listdir(rel): return sorted(n for n in os.listdir(os.path.join(ROOT, rel)) if not n.startswith(".") and n != "__pycache__")
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
def ver(s): return tuple(int(x) for x in s.split("."))

def check_range(req, have, where):
    """foxlib requirement like '>=1.0.0 <2.0.0' (only >=, >, <, <=, = are used)."""
    for op, v in re.findall(r"(>=|<=|>|<|=)\s*(\d+\.\d+\.\d+)", req):
        a, b = ver(have), ver(v)
        ok = {">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b, "=": a == b}[op]
        if not ok:
            bad(where, f"needs foxlib {req}, repo has {have}")

# ---------------------------------------------------------------- boards
boards = {}
board_ids = load("boards/index.json")
module_ids = load("modules/index.json")
if sorted(board_ids) != sorted(set(board_ids)): bad("boards/index.json", "duplicate entry")
for bid in board_ids:
    rel = f"boards/{bid}.json"
    if not exists(rel): bad(rel, "listed in boards/index.json but missing"); continue
    b = boards[bid] = load(rel)
    if b.get("id") != bid: bad(rel, f"id {b.get('id')!r} != filename")
    fam = b.get("family", "foxlib")
    if fam not in ("foxlib", "drive"): bad(rel, f"unknown family {fam!r}")
    for k in ("name", "flash", "has_usb_drive", "pins", "roles"):
        if k not in b: bad(rel, f"missing {k}")
    if fam == "foxlib":
        if "circuitpython" not in b: bad(rel, "missing circuitpython")
        for k in ("board_id", "download"):
            if k not in (b.get("circuitpython") or {}): bad(rel, f"missing circuitpython.{k}")
    else:
        for k in ("vendor", "module_fixed", "drive", "notes"):
            if k not in b: bad(rel, f"drive-family board missing {k}")
        if b.get("vendor") and not exists(f"js/model/vendor/{b['vendor']}.js"): bad(rel, f"vendor model js/model/vendor/{b['vendor']}.js missing")
        if b.get("module_fixed") and b["module_fixed"] not in module_ids: bad(rel, f"module_fixed {b['module_fixed']!r} not in modules/index.json")
        for k in ("label", "files", "note"):
            if k not in (b.get("drive") or {}): bad(rel, f"missing drive.{k}")
        if b.get("flash", {}).get("method") == "uf2":
            for k in ("drive_name", "stock_firmware_url", "note"):
                if k not in b["flash"]: bad(rel, f"uf2 board missing flash.{k}")
    for k in ("method", "chip", "offset", "bootloader_instructions"):
        if k not in b.get("flash", {}): bad(rel, f"missing flash.{k}")
    names = {}
    for p in b.get("pins", []):
        if "name" not in p: bad(rel, "pin without name"); continue
        if p["name"] in names: bad(rel, f"pin {p['name']} listed twice")
        names[p["name"]] = p
        for a in p.get("aliases", []):
            if a in names and names[a] is not p: bad(rel, f"alias {a} clashes")
            names[a] = p
    roles = b.get("roles", {})
    for role in (fcfg.REQUIRED_PINS + fcfg.OPTIONAL_PINS if fam == "foxlib" else ()):
        if role not in roles: bad(rel, f"roles.{role} missing (use null if not wired)")
    for role, pin in roles.items():
        if role not in fcfg.REQUIRED_PINS + fcfg.OPTIONAL_PINS: bad(rel, f"roles.{role}: unknown role")
        if pin is None:
            if role in fcfg.REQUIRED_PINS: bad(rel, f"roles.{role} is required but null")
            continue
        if pin not in names: bad(rel, f"roles.{role} = {pin}: no such pin"); continue
        p = names[pin]
        if role == "audio" and not p.get("pwm"): bad(rel, f"roles.audio = {pin} has no PWM")
        if role == "batt_sense" and not p.get("adc"): bad(rel, f"roles.batt_sense = {pin} has no ADC")
    used = [v for v in roles.values() if v]
    if len(used) != len(set(used)): bad(rel, "two roles share a pin")
    b["_names"] = set(names)
    b["_family"] = fam
for n in listdir("boards"):
    if n.endswith(".json") and n != "index.json" and n[:-5] not in board_ids: bad(f"boards/{n}", "not listed in boards/index.json")

# ---------------------------------------------------------------- modules
modules = {}
for mid in module_ids:
    rel = f"modules/{mid}.json"
    if not exists(rel): bad(rel, "listed in modules/index.json but missing"); continue
    m = modules[mid] = load(rel)
    if m.get("id") != mid: bad(rel, f"id {m.get('id')!r} != filename")
    for k in ("name", "family", "ranges_mhz", "power_dbm", "bandwidths_khz", "uart", "model"):
        if k not in m: bad(rel, f"missing {k}")
    if m.get("fixed_to_board"):
        if m["fixed_to_board"] not in board_ids: bad(rel, f"fixed_to_board {m['fixed_to_board']!r} unknown")
        for k in ("audio", "zones"):
            if k not in m: bad(rel, f"built-in exciter descriptor missing {k}")
    rr = m.get("ranges_mhz", [])
    if not rr or not all(isinstance(x, list) and len(x) == 2 and x[0] < x[1] for x in rr): bad(rel, "ranges_mhz must be [[lo,hi],...] with lo<hi")
    pw = m.get("power_dbm", {})
    if not (isinstance(pw, dict) and "low" in pw and "high" in pw and pw["low"] <= pw["high"]): bad(rel, "power_dbm needs low <= high")
    bw = m.get("bandwidths_khz", [])
    if not bw or not all(1 <= x <= 100 for x in bw): bad(rel, "bandwidths_khz must be within 1–100")
    if m.get("uart") is not None and not isinstance(m.get("uart", {}).get("baud"), int): bad(rel, "uart.baud must be an int")
for n in listdir("modules"):
    if n.endswith(".json") and n != "index.json" and n[:-5] not in module_ids: bad(f"modules/{n}", "not listed in modules/index.json")

# ---------------------------------------------------------------- bands
bands = load("bands.json")
for region, table in bands.items():
    if region.startswith("_"): continue
    if not isinstance(table, dict) or not table: bad("bands.json", f"{region}: empty"); continue
    for name, lim in table.items():
        if not (isinstance(lim, list) and len(lim) == 2 and lim[0] < lim[1]): bad("bands.json", f"{region}.{name}: [lo,hi] with lo<hi")

# ---------------------------------------------------------------- firmware
fw = load("firmware/index.json")
have = listdir("firmware/foxlib")
if sorted(fw["foxlib"]) != have: bad("firmware/index.json", f"foxlib list {sorted(fw['foxlib'])} != files on disk {have}")
foxlib_version = open(os.path.join(ROOT, "firmware/foxlib/VERSION")).read().strip()
if not SEMVER.match(foxlib_version): bad("firmware/foxlib/VERSION", f"not semver: {foxlib_version!r}")
tdirs = listdir("firmware/templates")
if sorted(fw["templates"]) != sorted(tdirs): bad("firmware/index.json", f"templates {sorted(fw['templates'])} != dirs {tdirs}")

templates = {}
for tid in fw["templates"]:
    base = f"firmware/templates/{tid}"
    rel = base + "/template.json"
    if not exists(rel): bad(rel, "missing"); continue
    t = templates[tid] = load(rel)
    if t.get("id") != tid: bad(rel, f"id {t.get('id')!r} != directory")
    for k in ("name", "version", "status", "description", "foxlib", "sections", "pins", "files", "payloads", "capabilities", "boards_tested", "families"):
        if k not in t: bad(rel, f"missing {k}")
    fams = t.get("families", ["foxlib"])
    for f in fams:
        if f not in ("foxlib", "drive"): bad(rel, f"unknown family {f!r}")
    if "drive" in fams and not t.get("vendor"): bad(rel, "drive-family template needs a vendor")
    is_fw = "foxlib" in fams
    if not SEMVER.match(str(t.get("version", ""))): bad(rel, f"version not semver: {t.get('version')!r}")
    if t.get("status") not in ("stable", "experimental"): bad(rel, f"status must be stable|experimental, got {t.get('status')!r}")
    check_range(t.get("foxlib", ""), foxlib_version, rel)
    for role in t.get("pins", {}).get("required", []):
        if role not in fcfg.REQUIRED_PINS: bad(rel, f"pins.required has {role}, which the firmware treats as optional")
    for role in t.get("pins", {}).get("optional", []):
        if role not in fcfg.OPTIONAL_PINS: bad(rel, f"pins.optional has {role}, unknown or required")
    for c in t.get("capabilities", []):
        if c not in ("keytest", "rssi", "batt"): bad(rel, f"unknown capability {c}")
    for b in t.get("boards_tested", []):
        if b not in boards: bad(rel, f"boards_tested names unknown board {b}")
    if is_fw and "code.py" not in t.get("files", []): bad(rel, "files must include code.py")
    for f in t.get("files", []):
        if not exists(f"{base}/{f}"): bad(rel, f"file {f} missing")
    code_rel = base + "/code.py"
    if exists(code_rel):
        code = open(os.path.join(ROOT, code_rel), encoding="utf-8").read()
        if f'version="{t.get("version")}"' not in code: bad(code_rel, f'does not carry version="{t.get("version")}"')
        if "import foxlib" not in code and "from foxlib" not in code: bad(code_rel, "does not import foxlib")
    # defaults: one per board of a family the template supports; foxlib ones validate clean through the firmware
    for bid, b in boards.items():
        drel = f"{base}/defaults/{bid}.json"
        if b["_family"] not in fams:
            if exists(drel): bad(drel, f"defaults for a board of family {b['_family']}, which this template does not list")
            continue
        if not exists(drel): bad(drel, f"missing — every template needs defaults for every board of the families it lists"); continue
        d = load(drel)
        if b["_family"] == "drive":
            if d.get("template") != tid or d.get("board") != bid or d.get("module") != b.get("module_fixed"): bad(drel, "template/board/module do not match")
            if d.get("schedule", {}).get("kind") != "duty": bad(drel, "drive-family defaults need schedule.kind = duty")
            for k in ("itu_zone", "attenuation", "revision", "id_deviation_hz", "audio_deviation_hz"):
                if k not in d.get("radio", {}): bad(drel, f"radio.{k} missing")
            continue
        if d.get("schema") != fcfg.SCHEMA: bad(drel, f"schema {d.get('schema')} != firmware SCHEMA {fcfg.SCHEMA}")
        if d.get("template") != tid: bad(drel, f"template {d.get('template')!r} != {tid}")
        if d.get("board") != bid: bad(drel, f"board {d.get('board')!r} != {bid}")
        mod = modules.get(d.get("module"))
        if not mod: bad(drel, f"module {d.get('module')!r} not in modules/");
        else:
            if d.get("radio", {}).get("family") != mod["family"]: bad(drel, f"radio.family {d.get('radio', {}).get('family')!r} != module family {mod['family']!r}")
            if d.get("radio", {}).get("ranges_mhz") != mod["ranges_mhz"]: bad(drel, "radio.ranges_mhz differs from the module descriptor")
            if d.get("radio", {}).get("bandwidth_khz") not in mod["bandwidths_khz"]: bad(drel, f"radio.bandwidth_khz {d.get('radio', {}).get('bandwidth_khz')} not offered by {mod['id']}")
            for f in d.get("plan", {}).get("frequencies_mhz", []):
                if not any(lo <= f <= hi for lo, hi in mod["ranges_mhz"]): bad(drel, f"default frequency {f} outside {mod['id']} range")
        for role, pin in d.get("pins", {}).items():
            if pin is not None and pin not in b["_names"]: bad(drel, f"pins.{role} = {pin}: not a pin on {bid}")
        for role in t.get("pins", {}).get("required", []):
            if not d.get("pins", {}).get(role): bad(drel, f"pins.{role} is required by the template but null in its own defaults")
        # the firmware's validator, fed the defaults as if they were fox.json: must come back clean
        _, rep = fcfg.validate(json.loads(json.dumps(d)), d, b["_names"], bid)
        if rep.status() != "ok": bad(drel, f"firmware validate() on its own defaults: {rep.status()} {rep.items}")
        for k in d:
            if k not in fcfg.TOP_KEYS: bad(drel, f"unknown top-level key {k}")
    for n in listdir(base + "/defaults") if exists(base + "/defaults") else []:
        if n.endswith(".json") and n[:-5] not in boards: bad(f"{base}/defaults/{n}", "defaults for a board not in boards/index.json")

# ---------------------------------------------------------------- songs
songs = load("songs/index.json")
for lib in songs.get("libraries", []):
    rel = lib.get("file", "")
    if not exists(rel): bad("songs/index.json", f"library file {rel} missing"); continue
    L = load(rel)
    for k in ("name", "license", "songs"):
        if k not in L: bad(rel, f"missing {k}")
    names = set()
    for s in L.get("songs", []):
        w = f"{rel} · {s.get('name', '?')}"
        if s.get("name") in names: bad(w, "duplicate song name")
        names.add(s.get("name"))
        if not (isinstance(s.get("tempo"), (int, float)) and 20 <= s["tempo"] <= 400): bad(w, "tempo must be 20–400")
        notes = s.get("notes")
        if not notes or not all(isinstance(n, list) and len(n) == 2 and isinstance(n[0], int) and 0 <= n[0] <= 127 and isinstance(n[1], (int, float)) and n[1] > 0 for n in notes):
            bad(w, "notes must be [[midi 0–127 (0 = rest), duration in 32nds > 0], ...]")
        if notes and sum(n[1] for n in notes) / 8 * 60 / s.get("tempo", 120) > 120: bad(w, "longer than two minutes — too long for a fox cycle")

# ---------------------------------------------------------------- version bumps since a ref
if "--since" in sys.argv:
    ref = sys.argv[sys.argv.index("--since") + 1]
    def changed(path):
        return subprocess.run(["git", "diff", "--quiet", ref, "HEAD", "--", path], cwd=ROOT).returncode != 0
    if changed("firmware/foxlib") and not changed("firmware/foxlib/VERSION"):
        bad("firmware/foxlib/VERSION", f"foxlib changed since {ref} without a version bump")
    for tid in fw["templates"]:
        base = f"firmware/templates/{tid}"
        if (changed(base + "/code.py") or changed(base + "/defaults")) and not changed(base + "/template.json"):
            bad(f"{base}/template.json", f"template files changed since {ref} without a version bump")

# ---------------------------------------------------------------- result
n = f"{len(boards)} board(s), {len(modules)} module(s), {len([r for r in bands if not r.startswith('_')])} region(s), {len(templates)} template(s), foxlib {foxlib_version}"
if problems:
    print(f"catalog: {len(problems)} problem(s) in {n}")
    for p in problems: print("  " + p)
    sys.exit(1)
print(f"catalog ok: {n}")
