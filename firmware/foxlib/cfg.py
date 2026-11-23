# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/cfg.py -- defaults.json -> fox.json override -> validation -> report.
# Independent implementation of CONFIG.md (the page has its own in js/model/schema.js).
# validate() is pure so the simulator and desktop tests can run it.

import json
from .report import Report, SCHEMA, _copy, _is_int, _is_num, _intify      # shared with netcfg (foxlib/report.py)

# A plain file name: letters, digits, . _ - (first character alphanumeric), 1-32 characters. Written out rather than as a
# regex: CircuitPython's `re` has no counted repetition ({m,n}), so the pattern silently never matched on the board and every
# images_file fell back to the default (seen on a XIAO ESP32-C3, foxlib 1.2.0).
_FNAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"


def _plain_file_name(s):
    return isinstance(s, str) and 1 <= len(s) <= 32 and s[0] not in "._-" and all(c in _FNAME_CHARS for c in s)
_RESERVED_FILES = {"code.py", "boot.py", "fox.json", "defaults.json", "board.json", "settings.txt", "audio.wav", ".callsign.wav", ".settings_crc.bin", "readme.txt"}
REQUIRED_PINS = ("ptt", "pd", "hl", "uart_tx", "uart_rx", "audio")
OPTIONAL_PINS = ("led", "batt_sense")
TOP_KEYS = ("schema", "template", "board", "module", "pins", "radio", "plan", "id", "payload", "schedule", "battery", "limits", "fleet")


def _validate_pins(u, cfg, defaults, rep, has):
    """pins: each role a name the board has; a pin shared by two roles goes back to the default (fatal when a required one cannot)."""
    pins = u.get("pins") if isinstance(u.get("pins"), dict) else {}
    for role in REQUIRED_PINS + OPTIONAL_PINS:
        if role not in pins:
            continue
        v = pins[role]
        if v is None:
            if role in REQUIRED_PINS:
                rep.bad("pins." + role, "required")
            else:
                cfg["pins"][role] = None
        elif has(v):
            cfg["pins"][role] = v
        else:
            rep.bad("pins." + role, "no such pin")
    for k in pins:
        if k not in REQUIRED_PINS + OPTIONAL_PINS:
            rep.bad("pins." + k, "unknown role")
    seen = {}
    for role in REQUIRED_PINS + OPTIONAL_PINS:
        v = cfg["pins"].get(role)
        if v is None:
            continue
        if v in seen:
            rep.bad("pins." + role, "shares " + v)
            d = defaults["pins"].get(role)
            if d == v or d is None:
                if role in REQUIRED_PINS:
                    rep.fatal = rep.fatal or "pins." + role
                cfg["pins"][role] = None
            else:
                cfg["pins"][role] = d
        else:
            seen[v] = role
    for role in REQUIRED_PINS:
        if not has(cfg["pins"].get(role)):
            rep.fatal = rep.fatal or "pins." + role


def _validate_radio(u, cfg, defaults, rep, has):
    """radio: module family, ranges, bandwidth, power, squelch, volume, high_power."""
    r = u.get("radio") if isinstance(u.get("radio"), dict) else {}
    if "family" in r:
        if isinstance(r["family"], str) and r["family"]:
            cfg["radio"]["family"] = r["family"]
        else:
            rep.bad("radio.family", "string")
    if "ranges_mhz" in r:
        rr = r["ranges_mhz"]
        ok = isinstance(rr, list) and rr and all(isinstance(x, list) and len(x) == 2 and _is_num(x[0]) and _is_num(x[1]) and x[0] < x[1] for x in rr)
        if ok:
            cfg["radio"]["ranges_mhz"] = rr
        else:
            rep.bad("radio.ranges_mhz", "[[lo,hi],...]")
    if "bandwidth_khz" in r:
        if _is_num(r["bandwidth_khz"]) and 1 <= r["bandwidth_khz"] <= 100:
            cfg["radio"]["bandwidth_khz"] = r["bandwidth_khz"]
        else:
            rep.bad("radio.bandwidth_khz", "1-100")
    if "power_dbm" in r:
        v = r["power_dbm"]
        if v is None or (_is_num(v) and 0 <= v <= 40):
            cfg["radio"]["power_dbm"] = v
        else:
            rep.bad("radio.power_dbm", "null or 0-40")
    if "squelch" in r:
        if _is_int(r["squelch"]) and 0 <= r["squelch"] <= 8:
            cfg["radio"]["squelch"] = r["squelch"]
        else:
            rep.bad("radio.squelch", "0-8")
    if "volume" in r:
        if _is_int(r["volume"]) and 1 <= r["volume"] <= 8:
            cfg["radio"]["volume"] = r["volume"]
        else:
            rep.bad("radio.volume", "1-8")
    if "high_power" in r:
        if isinstance(r["high_power"], bool):
            cfg["radio"]["high_power"] = r["high_power"]
        else:
            rep.bad("radio.high_power", "bool")


def _validate_plan(u, cfg, defaults, rep, has):
    """plan: the frequency list, kept inside the module's ranges (fatal when nothing is left)."""
    p = u.get("plan") if isinstance(u.get("plan"), dict) else {}
    if "frequencies_mhz" in p:
        fl = p["frequencies_mhz"]
        if isinstance(fl, list) and fl and all(_is_num(f) for f in fl):
            cfg["plan"]["frequencies_mhz"] = list(fl)
        else:
            rep.bad("plan.frequencies_mhz", "non-empty list")
    if "announce_qsy" in p:
        if isinstance(p["announce_qsy"], bool):
            cfg["plan"]["announce_qsy"] = p["announce_qsy"]
        else:
            rep.bad("plan.announce_qsy", "bool")
    ranges = cfg["radio"]["ranges_mhz"]
    in_mod = lambda f: any(lo <= f <= hi for lo, hi in ranges)
    kept = [f for f in cfg["plan"]["frequencies_mhz"] if in_mod(f)]
    if len(kept) != len(cfg["plan"]["frequencies_mhz"]):
        rep.bad("plan.frequencies_mhz", "out of module range")
        cfg["plan"]["frequencies_mhz"] = kept
    if not kept:
        rep.fatal = rep.fatal or "plan"


def _validate_id(u, cfg, defaults, rep, has):
    """id: callmessage, placeholder, wpm, tone, telemetry, tx_without_callsign."""
    d = u.get("id") if isinstance(u.get("id"), dict) else {}
    if "callmessage" in d:
        if isinstance(d["callmessage"], str) and 1 <= len(d["callmessage"].encode("utf-8")) <= 64:   # bytes, as the C firmware counts
            cfg["id"]["callmessage"] = d["callmessage"]
        else:
            rep.bad("id.callmessage", "1-64 chars")
    if "placeholder" in d:
        if isinstance(d["placeholder"], str) and d["placeholder"]:
            cfg["id"]["placeholder"] = d["placeholder"]
        else:
            rep.bad("id.placeholder", "string")
    if "wpm" in d:
        if _is_int(d["wpm"]) and 5 <= d["wpm"] <= 40:
            cfg["id"]["wpm"] = d["wpm"]
        else:
            rep.bad("id.wpm", "5-40")
    if "tone_hz" in d:
        if _is_int(d["tone_hz"]) and 300 <= d["tone_hz"] <= 3000:
            cfg["id"]["tone_hz"] = d["tone_hz"]
        else:
            rep.bad("id.tone_hz", "300-3000")
    if "telemetry" in d:
        if isinstance(d["telemetry"], list) and all(t in ("batt", "chg") for t in d["telemetry"]):
            cfg["id"]["telemetry"] = list(d["telemetry"])    # "chg" needs a charger sense; boards without one send nothing for it
        else:
            rep.bad("id.telemetry", "subset of [batt,chg]")
    if "tx_without_callsign" in d:
        if isinstance(d["tx_without_callsign"], bool):
            cfg["id"]["tx_without_callsign"] = d["tx_without_callsign"]
        else:
            rep.bad("id.tx_without_callsign", "bool")


def _validate_payload(u, cfg, defaults, rep, has):
    """payload: songs (a playlist), sstv (an images file) or none (a message); bad entries fall back one by one."""
    pl = u.get("payload")
    if isinstance(pl, dict):
        kind = pl.get("kind")
        if kind not in ("songs", "sstv", "none"):
            rep.bad("payload.kind", "songs|sstv|none")
        else:
            out = {"kind": kind}
            if kind == "songs":
                a = pl.get("articulation", 0.875)
                if _is_num(a) and 0.5 <= a <= 1.0:
                    out["articulation"] = a
                else:
                    rep.bad("payload.articulation", "0.5-1.0")
                    out["articulation"] = 0.875
                out["skip_on_low_battery"] = pl.get("skip_on_low_battery", True) is True
                songs = []
                for i, s in enumerate(pl.get("playlist") or []):
                    ok = (isinstance(s, dict) and isinstance(s.get("name"), str) and _is_int(s.get("tempo")) and 40 <= s["tempo"] <= 300
                          and isinstance(s.get("notes"), list) and s["notes"]
                          and all(isinstance(n, list) and len(n) == 2 and _is_int(n[0]) and 0 <= n[0] <= 127 and _is_int(n[1]) and 1 <= n[1] <= 64 for n in s["notes"]))
                    if ok:
                        songs.append(s)
                    else:
                        rep.bad("payload.playlist[%d]" % i, "bad song")
                if not songs:
                    rep.bad("payload.playlist", "empty")
                    songs = defaults["payload"]["playlist"] if defaults["payload"].get("kind") == "songs" else []
                out["playlist"] = songs
            elif kind == "sstv":
                out["mode"] = "robot36-gray"
                if "mode" in pl and pl["mode"] != "robot36-gray":
                    rep.bad("payload.mode", "robot36-gray only")
                imf = pl.get("images_file", "images.bin")
                if _plain_file_name(imf) and imf.lower() not in _RESERVED_FILES:
                    out["images_file"] = imf
                else:
                    rep.bad("payload.images_file", "a plain file name (letters, digits, . _ -), not code.py / fox.json / defaults.json / boot.py / board.json")
                    out["images_file"] = "images.bin"
                out["skip_on_low_battery"] = pl.get("skip_on_low_battery", True) is True
            else:
                ds = pl.get("dit_s")
                if ds is None:
                    out["dit_s"] = None
                elif _is_num(ds) and 0.05 <= ds <= 30:
                    out["dit_s"] = ds
                else:
                    rep.bad("payload.dit_s", "0.05-30")
                    out["dit_s"] = None
                m = pl.get("message")
                out["message"] = m if (m is None or isinstance(m, str)) else None
                if not (m is None or isinstance(m, str)):
                    rep.bad("payload.message", "string or null")
            cfg["payload"] = out
    elif pl is not None:
        rep.bad("payload", "object")


def _validate_schedule(u, cfg, defaults, rep, has):
    """schedule: fixed, popcorn or resurrection, each with its own millisecond fields; min>max is clamped."""
    s = u.get("schedule")
    if isinstance(s, dict):
        def ms(k, default, lo=0, hi=86400000):
            if k not in s:
                return default
            v = s[k]
            if _is_int(v) and lo <= v <= hi:
                return v
            rep.bad("schedule." + k, "int ms")
            return default
        def seed():
            v = s.get("seed")
            if _is_int(v) and 0 <= v < (1 << 31):
                return v
            rep.bad("schedule.seed", "int")
            return 1
        kind = s.get("kind")
        if kind == "fixed":
            cfg["schedule"] = {"kind": "fixed", "delay_ms": ms("delay_ms", 30000)}
        elif kind == "popcorn":
            sd = seed()
            cl = s.get("cluster")
            if not (_is_int(cl) and 1 <= cl <= 50):
                rep.bad("schedule.cluster", "1-50")
                cl = 2
            out = {"kind": "popcorn", "seed": sd, "cluster": cl, "cluster_gap_ms": ms("cluster_gap_ms", 8000),
                   "dark_min_ms": ms("dark_min_ms", 10000), "dark_max_ms": ms("dark_max_ms", 300000)}
            if out["dark_min_ms"] > out["dark_max_ms"]:
                rep.bad("schedule.dark_min_ms", "min>max")
                out["dark_min_ms"] = out["dark_max_ms"]
            cfg["schedule"] = out
        elif kind == "resurrection":
            sd = seed()
            ie = s.get("id_every")
            if not (_is_int(ie) and 1 <= ie <= 100):
                rep.bad("schedule.id_every", "1-100")
                ie = 3
            out = {"kind": "resurrection", "seed": sd, "delay_ms": ms("delay_ms", 30000),
                   "alive_min_ms": ms("alive_min_ms", 1800000), "alive_max_ms": ms("alive_max_ms", 3600000),
                   "dead_ms": ms("dead_ms", 3600000), "dit_min_ms": ms("dit_min_ms", 180000), "dit_max_ms": ms("dit_max_ms", 300000),
                   "id_every": ie, "dead_song": s.get("dead_song") is True}
            for a, b in (("alive_min_ms", "alive_max_ms"), ("dit_min_ms", "dit_max_ms")):
                if out[a] > out[b]:
                    rep.bad("schedule." + a, "min>max")
                    out[a] = out[b]
            cfg["schedule"] = out
        else:
            rep.bad("schedule.kind", "fixed|popcorn|resurrection")
    elif s is not None:
        rep.bad("schedule", "object")


def _validate_battery(u, cfg, defaults, rep, has):
    """battery: divider, calibration, the three thresholds in order (critical < recovery <= low)."""
    b = u.get("battery") if isinstance(u.get("battery"), dict) else {}
    for k, lo, hi in (("divider_ratio", 1, 10), ("calibration", 0.5, 2), ("low_v", 2.5, 4.5), ("critical_v", 2.5, 4.5), ("recovery_v", 2.5, 4.5)):
        if k in b:
            if _is_num(b[k]) and lo <= b[k] <= hi:
                cfg["battery"][k] = b[k]
            else:
                rep.bad("battery." + k, "%s-%s" % (lo, hi))
    if "samples" in b:
        if _is_int(b["samples"]) and 1 <= b["samples"] <= 64:
            cfg["battery"]["samples"] = b["samples"]
        else:
            rep.bad("battery.samples", "1-64")
    bb = cfg["battery"]
    if not (bb["critical_v"] < bb["recovery_v"] <= bb["low_v"]):
        rep.bad("battery", "critical<recovery<=low")
        for k in ("low_v", "critical_v", "recovery_v"):
            bb[k] = defaults["battery"][k]


def _validate_limits(u, cfg, defaults, rep, has):
    """limits: max_keydown_s, watchdog_s, recover."""
    l = u.get("limits") if isinstance(u.get("limits"), dict) else {}
    if "max_keydown_s" in l:
        v = l["max_keydown_s"]
        if v is None or (_is_num(v) and 1 <= v <= 7200):
            cfg["limits"]["max_keydown_s"] = v
        else:
            rep.bad("limits.max_keydown_s", "null or 1-7200")
    if "watchdog_s" in l:
        v = l["watchdog_s"]
        if v is None or (_is_int(v) and 10 <= v <= 3600):
            cfg["limits"]["watchdog_s"] = v
        else:
            rep.bad("limits.watchdog_s", "null or 10-3600")
    if "recover" in l:
        if isinstance(l["recover"], bool):
            cfg["limits"]["recover"] = l["recover"]
        else:
            rep.bad("limits.recover", "true | false")


def _validate_fleet_and_unknown(u, cfg, defaults, rep, has):
    """fleet (opaque, merged over the defaults) and the keys this schema does not know."""
    if isinstance(u.get("fleet"), dict):
        fl = dict(cfg.get("fleet") or {})
        fl.update(_copy(u["fleet"]))
        cfg["fleet"] = fl
    for k in u:
        if k not in TOP_KEYS:
            rep.bad(k, "unknown key")


def validate(user, defaults, board_names, board_id=None):
    """Returns (cfg, report). board_names: names the board module exposes (dir(board))."""
    cfg = _copy(defaults)
    rep = Report()
    u = _intify(user) if isinstance(user, dict) else {}
    has = lambda name: isinstance(name, str) and name in board_names

    # ---- gates: whole-file fallbacks
    if "schema" in u and u["schema"] != SCHEMA:
        rep.mode = "default(schema)"
        return cfg, rep
    if "template" in u and u["template"] != defaults.get("template"):
        rep.mode = "default(template)"
        return cfg, rep
    # fox.json names a target; the running board may report another CircuitPython board_id when a target runs a
    # sibling board's build (the Waveshare S3-Nano runs as arduino_nano_esp32s3): the defaults.json written with it
    # names the same target, so a fox.json for that target is for this board
    if "board" in u and board_id and u["board"] != board_id and u["board"] != defaults.get("board"):
        rep.mode = "default(board)"
        return cfg, rep
    if "module" in u:
        if isinstance(u["module"], str):
            cfg["module"] = u["module"]
        else:
            rep.bad("module", "string")

    # ---- the sections, in CONFIG.md's order; each takes what it needs from the user's dict and writes cfg
    _validate_pins(u, cfg, defaults, rep, has)
    _validate_radio(u, cfg, defaults, rep, has)
    _validate_plan(u, cfg, defaults, rep, has)
    _validate_id(u, cfg, defaults, rep, has)
    _validate_payload(u, cfg, defaults, rep, has)
    _validate_schedule(u, cfg, defaults, rep, has)
    _validate_battery(u, cfg, defaults, rep, has)
    _validate_limits(u, cfg, defaults, rep, has)
    _validate_fleet_and_unknown(u, cfg, defaults, rep, has)
    if rep.items and rep.mode == "ok":
        rep.mode = "partial"
    return cfg, rep


def load(path, defaults_path, board_names, board_id=None):
    """Returns (cfg, report). defaults_path missing -> (None, report with fatal)."""
    rep = Report()
    try:
        with open(defaults_path) as f:
            defaults = json.load(f)
    except Exception:
        rep.fatal = "defaults"
        return None, rep
    try:
        with open(path) as f:
            raw = f.read()
    except OSError:
        rep.mode = "default(missing)"
        return _copy(defaults), rep
    try:
        user = json.loads(raw)
    except Exception:
        rep.mode = "default(parse)"
        return _copy(defaults), rep
    return validate(user, defaults, board_names, board_id)
