#!/usr/bin/env python3
"""check_catalog.py — lint everything the page and the firmware read as data.

    python3 tools/check_catalog.py              # whole catalog
    python3 tools/check_catalog.py --since REF  # also: version bumps for what changed since REF
    python3 tools/check_catalog.py --manifest firmware/kitsune/manifest.json   # also: a kitsune image manifest

Checks that every index.json entry exists and nothing is unlisted; that
board, module, band, template and song descriptors have the fields the
page and firmware read, with sane values; that every template has a
defaults file for every board and that file validates clean through the
firmware's own cfg.validate(); that a template's foxlib requirement is met
by foxlib/VERSION; that README's "v0.x" matches js/main.js VERSION; that
vendor firmware files are pinned (commit URL, sha256, size); and (with
--since) that foxlib/VERSION, template versions, firmware/foxlib-c/VERSION
(its sources and the defaults file compiled into the UF2) and js/main.js
VERSION (anything the page serves) were bumped when their files changed.

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

# --pack DIR: lint a catalog pack (another repository's hardware/, boards/, firmware/templates/, modules/ with a
# pack.json naming them) as the page would see it: merged over this repository's catalog, the pack's files first.
PACK = os.path.abspath(sys.argv[sys.argv.index("--pack") + 1]) if "--pack" in sys.argv else None
PACK_JSON = {}
if PACK:
    with open(os.path.join(PACK, "pack.json"), encoding="utf-8") as f: PACK_JSON = json.load(f)
    for k in ("hardware", "boards", "templates", "modules"):
        if k in PACK_JSON and not isinstance(PACK_JSON[k], list): bad("pack.json", f"{k} must be a list of ids")
    if "name" not in PACK_JSON: bad("pack.json", "name missing")
def _path(rel):
    if PACK and os.path.exists(os.path.join(PACK, rel)): return os.path.join(PACK, rel)
    return os.path.join(ROOT, rel)
def load(rel):
    with open(_path(rel), encoding="utf-8") as f:
        return json.load(f)
def exists(rel): return os.path.exists(_path(rel))
def listdir(rel):
    names = set()
    for root in ([PACK] if PACK else []) + [ROOT]:
        d = os.path.join(root, rel)
        if os.path.isdir(d): names.update(n for n in os.listdir(d) if not n.startswith(".") and n != "__pycache__")
    return sorted(names)
def with_pack(ids, key):
    """The repository's index plus the pack's entries (a pack id that is also built in replaces it, as on the page)."""
    extra = [i for i in PACK_JSON.get(key, []) if i not in ids]
    return list(ids) + extra
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
def ver(s): return tuple(int(x) for x in s.split("."))

def check_range(req, have, where):
    """foxlib requirement like '>=1.0.0 <2.0.0' (only >=, >, <, <=, = are used)."""
    for op, v in re.findall(r"(>=|<=|>|<|=)\s*(\d+\.\d+\.\d+)", req):
        a, b = ver(have), ver(v)
        ok = {">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b, "=": a == b}[op]
        if not ok:
            bad(where, f"needs foxlib {req}, repo has {have}")

def foxlibc_validate(drel, bid):
    """Run firmware/foxlib-c's validator (host build) on a defaults file as if it were fox.json. None when it cannot be built."""
    import shutil, subprocess
    binp = os.path.join(ROOT, "firmware", "foxlib-c", "tests", "build", "core_dump")
    if not os.path.exists(binp):
        if not shutil.which("gcc") and not shutil.which("cc"): return None
        r = subprocess.run(["make", "-s", "-C", os.path.join(ROOT, "firmware", "foxlib-c", "tests")], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(binp): return None
    path = os.path.join(ROOT, drel)
    r = subprocess.run([binp, "cfg", path, path, bid], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else "status=error(%d)" % r.returncode


# ---------------------------------------------------------------- hardware (physical facts) and boards (targets = hardware + firmware + family)
FAMILIES = ("foxlib", "drive", "foxlib-c", "compiled")
RADIOS = ("wifi24", "wifi5", "ble", "btclassic", "ieee802154")
module_ids = with_pack(load("modules/index.json"), "modules")
templates_listed = set(with_pack(load("firmware/index.json")["templates"], "templates"))
hardware = {}
hw_ids = with_pack(load("hardware/index.json"), "hardware")
if sorted(hw_ids) != sorted(set(hw_ids)): bad("hardware/index.json", "duplicate entry")
for hid in hw_ids:
    rel = f"hardware/{hid}.json"
    if not exists(rel): bad(rel, "listed in hardware/index.json but missing"); continue
    hw = hardware[hid] = load(rel)
    if hw.get("id") != hid: bad(rel, f"id {hw.get('id')!r} != filename")
    for k in ("name", "mcu", "flash", "has_usb_drive", "usb", "pins", "roles", "battery"):
        if k not in hw: bad(rel, f"missing {k}")
    for k in ("method", "chip", "offset", "bootloader_instructions"):
        if k not in hw.get("flash", {}): bad(rel, f"missing flash.{k}")
    if hw.get("flash", {}).get("method") == "uf2" and "drive_name" not in hw["flash"]: bad(rel, "uf2 hardware needs flash.drive_name")
    for u in hw.get("usb", []):
        for k in ("vid", "pid"):
            if not re.match(r"^0x[0-9a-fA-F]{4}$", str(u.get(k, ""))): bad(rel, f"usb entry {u}: {k} must be 0xNNNN")
    names = {}
    for p in hw.get("pins", []):
        if "name" not in p: bad(rel, "pin without name"); continue
        if p["name"] in names: bad(rel, f"pin {p['name']} listed twice")
        names[p["name"]] = p
        for a in p.get("aliases", []):
            if a in names and names[a] is not p: bad(rel, f"alias {a} clashes")
            names[a] = p
    for role, pin in hw.get("roles", {}).items():
        if role not in fcfg.REQUIRED_PINS + fcfg.OPTIONAL_PINS: bad(rel, f"roles.{role}: unknown role")
        if pin is None: continue
        if pin not in names: bad(rel, f"roles.{role} = {pin}: no such pin"); continue
        if role == "audio" and not names[pin].get("pwm"): bad(rel, f"roles.audio = {pin} has no PWM")
        if role == "batt_sense" and not names[pin].get("adc"): bad(rel, f"roles.batt_sense = {pin} has no ADC")
    used = [v for v in hw.get("roles", {}).values() if v]
    if len(used) != len(set(used)): bad(rel, "two roles share a pin")
    hw["_names"] = set(names)
for n in listdir("hardware"):
    if n.endswith(".json") and n != "index.json" and n[:-5] not in hw_ids: bad(f"hardware/{n}", "not listed in hardware/index.json")

boards = {}
board_ids = with_pack(load("boards/index.json"), "boards")
if sorted(board_ids) != sorted(set(board_ids)): bad("boards/index.json", "duplicate entry")
for bid in board_ids:
    rel = f"boards/{bid}.json"
    if not exists(rel): bad(rel, "listed in boards/index.json but missing"); continue
    t = load(rel)
    if t.get("id") != bid: bad(rel, f"id {t.get('id')!r} != filename")
    for k in ("name", "hardware", "family", "firmware"):
        if k not in t: bad(rel, f"missing {k}")
    hw = hardware.get(t.get("hardware"))
    if not hw: bad(rel, f"unknown hardware {t.get('hardware')!r}"); continue
    fam = t.get("family")
    if fam not in FAMILIES: bad(rel, f"unknown family {fam!r} (one of {FAMILIES})")
    if "kind" not in t.get("firmware", {}): bad(rel, "firmware.kind missing")
    if t.get("status") not in (None, "planned", "experimental", "stable"): bad(rel, f"status {t.get('status')!r}")
    if fam == "foxlib":
        if "circuitpython" not in hw: bad(rel, "foxlib target on hardware without circuitpython")
        for k in ("board_id", "download"):
            if k not in (hw.get("circuitpython") or {}): bad(rel, f"hardware missing circuitpython.{k}")
        for role in fcfg.REQUIRED_PINS + fcfg.OPTIONAL_PINS:
            if role not in hw.get("roles", {}): bad(rel, f"hardware roles.{role} missing (use null if not wired)")
        for role in fcfg.REQUIRED_PINS:
            if not hw.get("roles", {}).get(role): bad(rel, f"hardware roles.{role} is required but null")
    if fam == "drive":
        for k in ("vendor", "module_fixed", "drive"):
            if k not in t: bad(rel, f"drive-family target missing {k}")
        if t.get("vendor") and not exists(f"js/model/vendor/{t['vendor']}.js"): bad(rel, f"vendor model js/model/vendor/{t['vendor']}.js missing")
        if "notes" not in hw: bad(rel, "drive-family hardware should carry the firmware's quirk notes")
        # vendor images the page fetches live must be pinned: a commit in the URL, and the sha256/size the page checks
        fw = t.get("firmware", {})
        pin = fw.get("stock_firmware_pinned_commit", "")
        for f in fw.get("stock_firmware_files", []):
            n = f.get("name", "?")
            if not re.fullmatch(r"[0-9a-f]{40}", pin): bad(rel, f"stock_firmware_files ({n}): firmware.stock_firmware_pinned_commit must be a 40-hex commit")
            elif pin not in f.get("url", ""): bad(rel, f"stock_firmware_files ({n}): url does not contain the pinned commit (a branch name would move under the page)")
            if not re.fullmatch(r"[0-9a-f]{64}", str(f.get("sha256", ""))): bad(rel, f"stock_firmware_files ({n}): sha256 missing or not 64 hex")
            if not isinstance(f.get("size"), int) or f["size"] <= 0 or f["size"] % 512: bad(rel, f"stock_firmware_files ({n}): size must be a positive multiple of 512 (UF2 blocks)")
    if fam == "compiled":
        # a fox whose configuration is compiled into its firmware (kitsune): a vendor model does the fox.json work
        for k in ("vendor",):
            if k not in t: bad(rel, f"compiled-family target missing {k}")
        if t.get("vendor") and not exists(f"js/model/vendor/{t['vendor']}.js"): bad(rel, f"vendor model js/model/vendor/{t['vendor']}.js missing")
        if not isinstance(hw.get("radios"), list) or not hw["radios"]: bad(rel, "compiled-family hardware must list its radios")
        for r in hw.get("radios", []):
            if r not in RADIOS: bad(rel, f"hardware radios: unknown {r!r} (one of {RADIOS})")
        if hw.get("flash", {}).get("method") != "esptool": bad(rel, "compiled-family hardware is flashed with esptool")
        if t.get("firmware", {}).get("source", "").startswith("http") is False: bad(rel, "firmware.source must link to the project the firmware comes from")
        for e in t.get("firmware", {}).get("envs", []):
            for k in ("env", "project", "template", "tier"):
                if k not in e: bad(rel, f"firmware.envs entry missing {k}: {e}")
            if e.get("template") and e["template"] not in templates_listed: bad(rel, f"firmware.envs names unknown template {e.get('template')!r}")
            if e.get("tier") not in ("easy", "medium", "hard"): bad(rel, f"firmware.envs tier {e.get('tier')!r}")
    if fam == "foxlib-c":
        for k in ("module_fixed", "drive"):
            if k not in t: bad(rel, f"foxlib-c target missing {k}")
        img = t.get("firmware", {}).get("image", "")
        # the image itself is built by CI into the site; the source tree it comes from must be in the repo
        src = os.path.dirname(img) + "/CMakeLists.txt" if img else ""
        if t.get("status") != "planned" and not (img and exists(src)): bad(rel, f"foxlib-c target without firmware source ({src or 'firmware.image unset'}) must be status: planned")
        vf = t.get("firmware", {}).get("version_file")
        if vf and not exists(vf): bad(rel, f"firmware.version_file {vf} missing")
    if t.get("module_fixed") and t["module_fixed"] not in module_ids: bad(rel, f"module_fixed {t['module_fixed']!r} not in modules/index.json")
    for k in ("label", "files", "note"):
        if "drive" in t and k not in t["drive"]: bad(rel, f"missing drive.{k}")
    merged = {**hw, **t}
    merged["_names"] = hw["_names"]; merged["_family"] = fam; merged["_planned"] = t.get("status") == "planned"
    boards[bid] = merged
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
        if m["fixed_to_board"] not in hardware: bad(rel, f"fixed_to_board {m['fixed_to_board']!r} is not a hardware id")
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
fw["templates"] = with_pack(fw["templates"], "templates")
have = sorted(n for n in os.listdir(os.path.join(ROOT, "firmware/foxlib")) if not n.startswith(".") and n != "__pycache__")   # foxlib is never in a pack
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
        if f not in FAMILIES: bad(rel, f"unknown family {f!r}")
    if ("drive" in fams or "compiled" in fams) and not t.get("vendor"): bad(rel, "drive/compiled-family template needs a vendor")
    for r in t.get("radios", []):
        if r not in RADIOS: bad(rel, f"radios: unknown {r!r}")
    if "compiled" in fams and not t.get("radios"): bad(rel, "compiled-family template must say which radio it uses (radios)")
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
        if b["_family"] not in fams or b.get("_planned"):
            if exists(drel) and b["_family"] not in fams: bad(drel, f"defaults for a board of family {b['_family']}, which this template does not list")
            continue
        if t.get("radios"):
            hw_radios = hardware.get(b.get("hardware"), {}).get("radios", [])
            if not all(r in hw_radios for r in t["radios"]):
                if exists(drel): bad(drel, f"defaults for a board without the {t['radios']} radio this template needs")
                continue
        if b["_family"] == "compiled":
            if not exists(drel): bad(drel, "missing — every compiled-family template needs defaults for every board with its radio"); continue
            d = load(drel)
            if d.get("template") != tid or d.get("board") != bid: bad(drel, "template/board do not match")
            if d.get("schedule", {}).get("kind") != "duty": bad(drel, "compiled-family defaults need schedule.kind = duty")
            if "challenge" not in d or "fleet" not in d: bad(drel, "challenge and fleet sections required")
            continue
        if not exists(drel): bad(drel, f"missing — every template needs defaults for every board of the families it lists"); continue
        d = load(drel)
        if b["_family"] == "drive":
            if d.get("template") != tid or d.get("board") != bid or d.get("module") != b.get("module_fixed"): bad(drel, "template/board/module do not match")
            if d.get("schedule", {}).get("kind") != "duty": bad(drel, "drive-family defaults need schedule.kind = duty")
            for k in ("itu_zone", "attenuation", "revision", "id_deviation_hz", "audio_deviation_hz"):
                if k not in d.get("radio", {}): bad(drel, f"radio.{k} missing")
            continue
        if b["_family"] == "foxlib-c":
            # the C firmware's own validator (host build), fed the defaults as fox.json: must come back clean
            if d.get("template") != tid or d.get("board") != bid or d.get("module") != b.get("module_fixed"): bad(drel, "template/board/module do not match")
            mod = modules.get(d.get("module"))
            if mod and d.get("radio", {}).get("ranges_mhz") != mod["ranges_mhz"]: bad(drel, "radio.ranges_mhz differs from the module descriptor")
            for k in ("itu_zone", "attenuation", "id_deviation_hz", "audio_deviation_hz", "tone_shape", "preemphasis", "sample_rate", "tx_while_mounted"):
                if k not in d.get("radio", {}): bad(drel, f"radio.{k} missing")
            if d.get("pins"): bad(drel, "foxlib-c boards have no pins section to fill")
            out = foxlibc_validate(drel, bid)
            if out is None: pass   # no host compiler: the firmware CI job covers it
            elif not out.startswith("status=ok") or "  cfg:" in out: bad(drel, f"foxlib-c validator: {out.splitlines()[0]}")
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
        """True when content under `path` differs between ref and HEAD. Pure renames (a defaults file renamed for a new
        target id, say) do not count: only added, deleted or modified files do."""
        out = subprocess.run(["git", "diff", "--name-status", "-M100%", ref, "HEAD", "--", path], cwd=ROOT, capture_output=True, text=True).stdout
        return any(line and not line.startswith("R100") for line in out.splitlines())
    if changed("firmware/foxlib") and not changed("firmware/foxlib/VERSION"):
        bad("firmware/foxlib/VERSION", f"foxlib changed since {ref} without a version bump")
    for tid in fw["templates"]:
        base = f"firmware/templates/{tid}"
        if (changed(base + "/code.py") or changed(base + "/defaults")) and not changed(base + "/template.json"):
            bad(f"{base}/template.json", f"template files changed since {ref} without a version bump")
    # foxlib-c: the firmware a user flashes. Its sources, and the defaults file compiled into the UF2 (the last-resort
    # config), need firmware/foxlib-c/VERSION bumped; the host tests do not.
    EMBEDDED_DEFAULTS = "firmware/templates/morse-songs/defaults/picofox-foxlibc.json"
    if (changed("firmware/foxlib-c/core") or changed("firmware/foxlib-c/picofox") or changed(EMBEDDED_DEFAULTS)) and not changed("firmware/foxlib-c/VERSION"):
        bad("firmware/foxlib-c/VERSION", f"foxlib-c firmware changed since {ref} without a version bump")
    # the page: anything it serves to the browser needs js/main.js VERSION bumped (the About tab, the saved form's stamp)
    if (changed("js") or changed("css") or changed("index.html") or changed("flasher")) and not changed("js/main.js"):
        bad("js/main.js", f"page files changed since {ref} without a VERSION bump in js/main.js")
    elif changed("js/main.js"):
        a = subprocess.run(["git", "show", f"{ref}:js/main.js"], cwd=ROOT, capture_output=True, text=True).stdout
        va = re.search(r"const VERSION = '([^']+)'", a); vb = re.search(r"const VERSION = '([^']+)'", open(os.path.join(ROOT, "js/main.js")).read())
        if va and vb and va.group(1) == vb.group(1) and (changed("js") or changed("css") or changed("index.html") or changed("flasher")):
            bad("js/main.js", f"page files changed since {ref} but VERSION is still {vb.group(1)}")

# ---------------------------------------------------------------- a "stable" target has been seen by a template
for tid, t in boards.items():
    if t.get("status") == "stable" and not any(tid in tp.get("boards_tested", []) for tp in templates.values()):
        bad(f"boards/{tid}.json", "status: stable, but no template lists it in boards_tested (the Behavior tab would say it was tested on something else)")

# ---------------------------------------------------------------- a kitsune manifest against the catalog (--manifest PATH)
# tools/build_kitsune.py writes one in CI; the page flashes what it names. Every image must belong to a compiled target,
# name that target's chip, and be a whole-flash image at offset 0x0 (merge_bin --target-offset 0x0) — the page writes
# merged images at 0x0, so a manifest saying the bootloader offset would put every piece one offset too high.
if "--manifest" in sys.argv:
    mp = sys.argv[sys.argv.index("--manifest") + 1]; rel = os.path.relpath(mp, ROOT)
    try: man = json.load(open(mp))
    except Exception as e: man = None; bad(rel, f"not JSON: {e}")
    if man:
        for k in ("project", "source", "commit", "images"):
            if k not in man: bad(rel, f"missing {k}")
        if man.get("source") and man.get("source") != "https://github.com/rfhs/kitsune": bad(rel, f"source {man.get('source')!r} is not the kitsune repository")
        if "tools" not in man: bad(rel, "no 'tools' (platformio/esptool versions) — the build is not reproducible without them")
        for i, im in enumerate(man.get("images", [])):
            w = f"{rel} images[{i}]"
            t = boards.get(im.get("board"))
            if not t or t.get("family") != "compiled": bad(w, f"board {im.get('board')!r} is not a compiled target"); continue
            hw = hardware.get(t.get("hardware"), {})
            if im.get("chip") != hw.get("flash", {}).get("chip"): bad(w, f"chip {im.get('chip')!r} but the hardware's is {hw.get('flash', {}).get('chip')!r}")
            if str(im.get("offset", "")).lower() != "0x0": bad(w, f"offset {im.get('offset')!r}: a merged image is written at 0x0 (the bootloader offset {hw.get('flash', {}).get('offset')} is inside it)")
            if im.get("template") and im["template"] not in templates: bad(w, f"template {im['template']!r} unknown")
            if im.get("env") and im["env"] not in [e.get("env") for e in t.get("firmware", {}).get("envs", [])]: bad(w, f"env {im['env']!r} is not one of {t['id']}'s firmware.envs")
            for k in ("file", "sha256", "size"):
                if k not in im: bad(w, f"missing {k}")
            if im.get("sha256") and not re.fullmatch(r"[0-9a-f]{64}", im["sha256"]): bad(w, "sha256 is not 64 hex digits")

# ---------------------------------------------------------------- versions named in prose
page_version = re.search(r"const VERSION = '([^']+)'", open(os.path.join(ROOT, "js/main.js")).read())
readme = open(os.path.join(ROOT, "README.md")).read()
m = re.search(r"Status: \*\*v(\d+\.\d+)", readme)
if page_version and m and not page_version.group(1).startswith(m.group(1) + "."):
    bad("README.md", f"says v{m.group(1)} but js/main.js VERSION is {page_version.group(1)}")

# ---------------------------------------------------------------- result
n = f"{len(hardware)} hardware, {len(boards)} target(s), {len(modules)} module(s), {len([r for r in bands if not r.startswith('_')])} region(s), {len(templates)} template(s), foxlib {foxlib_version}"
if problems:
    print(f"catalog: {len(problems)} problem(s) in {n}")
    for p in problems: print("  " + p)
    sys.exit(1)
print(f"catalog ok: {n}")
