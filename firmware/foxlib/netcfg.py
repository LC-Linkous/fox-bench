# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netcfg.py -- the configuration contract for network foxes (wifi-beacon, wifi-probe, ble-beacon): the SoC's
# own radio, no pins, no audio. Same shape of result as cfg.validate(): (cfg, Report) with the same status words, so
# the banner, the page and the parity tests treat both contracts alike. The JS twin is js/model/netschema.js.
#
#   { "schema": 1, "template": "wifi-beacon", "board": "...",
#     "net": { "kind": "wifi-ap", "ssid": "...", "psk": "...", "mac": "F2:..", "channel": 1, "hidden": false,
#              "tx_power_dbm": 17, "max_clients": 1 }                       (wifi-ap)
#     "net": { "kind": "wifi-probe", "ssid": "...", "mac": "F2:..", "tx_power_dbm": 17 }   (wifi-probe)
#     "net": { "kind": "ble", "name": "...", "uuid": "...", "major": 1, "minor": 1, "signal_power_dbm": -59,
#              "adv_min": 100, "adv_max": 100, "tx_power_dbm": 0, "mac": "F2:.." }            (ble-beacon)
#     "id": { "callmessage": "N0CALL DECOY", "use_callsign_as_name": false },
#     "schedule": { "kind": "duty", "wake_s": 15, "sleep_s": 5, "sleep": "off" | "deep" },
#     "led": { "enabled": true }, "fleet": { ... } }
import json
from .cfg import Report, _copy, _is_int, _is_num, _intify, SCHEMA

WIFI24_CHANNELS = tuple(range(1, 14))
WIFI5_CHANNELS = (36, 40, 44, 48, 149, 153, 157, 161, 165)
WIFI_POWER_DBM = (2, 5, 7, 8.5, 11, 13, 15, 17, 18.5, 19, 19.5)
BLE_POWER_DBM = (-12, -9, -6, -3, 0, 3, 6, 9)
MAX_NAME = 32         # Wi-Fi SSID and BLE name: 32 bytes
MAX_PSK = 63
PLACEHOLDER = "N0CALL"


def parse_mac(s, n=6):
    """'F2:AB:..' -> list of ints, or None. First byte must be unicast (bit 0 clear)."""
    if not isinstance(s, str):
        return None
    parts = s.replace("-", ":").split(":")
    if len(parts) != n:
        return None
    try:
        out = [int(p, 16) for p in parts]
    except ValueError:
        return None
    if any(b < 0 or b > 255 for b in out) or out[0] & 1:
        return None
    return out


def _blen(s):
    return len(s.encode("utf-8"))


def validate(user, defaults, board_id=None, radios=None):
    """Returns (cfg, report). radios: what the hardware has ("wifi24", "wifi5", "ble", ...) or None = don't check."""
    cfg = _copy(defaults)
    rep = Report()
    u = _intify(user) if isinstance(user, dict) else {}
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

    # ---- net
    n = u.get("net") if isinstance(u.get("net"), dict) else {}
    kind = cfg["net"]["kind"]
    if "kind" in n and n["kind"] != kind:
        rep.bad("net.kind", "fixed by the template")
    if kind in ("wifi-ap", "wifi-probe"):
        if "ssid" in n:
            if isinstance(n["ssid"], str) and 1 <= _blen(n["ssid"]) <= MAX_NAME:
                cfg["net"]["ssid"] = n["ssid"]
            else:
                rep.bad("net.ssid", "1-32 bytes")
        if "tx_power_dbm" in n:
            if _is_num(n["tx_power_dbm"]) and n["tx_power_dbm"] in WIFI_POWER_DBM:
                cfg["net"]["tx_power_dbm"] = n["tx_power_dbm"]
            else:
                rep.bad("net.tx_power_dbm", "one of the Wi-Fi power steps")
    if kind == "wifi-ap":
        if "psk" in n:
            if isinstance(n["psk"], str) and (n["psk"] == "" or 8 <= _blen(n["psk"]) <= MAX_PSK):
                cfg["net"]["psk"] = n["psk"]
            else:
                rep.bad("net.psk", "empty (open) or 8-63 bytes")
        if "channel" in n:
            band5 = radios is not None and "wifi5" in radios
            if _is_int(n["channel"]) and (n["channel"] in WIFI24_CHANNELS or (band5 and n["channel"] in WIFI5_CHANNELS)):
                cfg["net"]["channel"] = n["channel"]
            else:
                rep.bad("net.channel", "1-13" + (" or a 5 GHz channel" if band5 else ""))
        if "hidden" in n:
            if isinstance(n["hidden"], bool):
                cfg["net"]["hidden"] = n["hidden"]
            else:
                rep.bad("net.hidden", "bool")
        if "max_clients" in n:
            if _is_int(n["max_clients"]) and 1 <= n["max_clients"] <= 8:
                cfg["net"]["max_clients"] = n["max_clients"]
            else:
                rep.bad("net.max_clients", "1-8")
    if kind == "ble":
        if "name" in n:
            if isinstance(n["name"], str) and 1 <= _blen(n["name"]) <= MAX_NAME:
                cfg["net"]["name"] = n["name"]
            else:
                rep.bad("net.name", "1-32 bytes")
        if "uuid" in n:
            s = n["uuid"] if isinstance(n["uuid"], str) else ""
            h = s.replace("-", "")
            if len(h) == 32 and all(c in "0123456789abcdefABCDEF" for c in h) and [len(p) for p in s.split("-")] == [8, 4, 4, 4, 12]:
                cfg["net"]["uuid"] = s.upper()
            else:
                rep.bad("net.uuid", "8-4-4-4-12 hex")
        for k in ("major", "minor"):
            if k in n:
                if _is_int(n[k]) and 0 <= n[k] <= 65535:
                    cfg["net"][k] = n[k]
                else:
                    rep.bad("net." + k, "0-65535")
        if "signal_power_dbm" in n:
            if _is_int(n["signal_power_dbm"]) and -128 <= n["signal_power_dbm"] <= 0:
                cfg["net"]["signal_power_dbm"] = n["signal_power_dbm"]
            else:
                rep.bad("net.signal_power_dbm", "-128-0")
        for k in ("adv_min", "adv_max"):
            if k in n:
                if _is_int(n[k]) and 20 <= n[k] <= 10240:
                    cfg["net"][k] = n[k]
                else:
                    rep.bad("net." + k, "20-10240 ms")
        if cfg["net"]["adv_min"] > cfg["net"]["adv_max"]:
            rep.bad("net.adv_min", "<= adv_max")
            cfg["net"]["adv_min"] = cfg["net"]["adv_max"]
        if "tx_power_dbm" in n:
            if _is_int(n["tx_power_dbm"]) and n["tx_power_dbm"] in BLE_POWER_DBM:
                cfg["net"]["tx_power_dbm"] = n["tx_power_dbm"]
            else:
                rep.bad("net.tx_power_dbm", "one of the BLE power steps")
    if "mac" in n:
        if parse_mac(n["mac"]) is not None:
            cfg["net"]["mac"] = n["mac"].upper().replace("-", ":")
        else:
            rep.bad("net.mac", "6 hex bytes, unicast")
    for k in n:
        if k not in cfg["net"]:
            rep.bad("net." + k, "unknown")

    # ---- id
    i = u.get("id") if isinstance(u.get("id"), dict) else {}
    if "callmessage" in i:
        if isinstance(i["callmessage"], str) and 1 <= _blen(i["callmessage"]) <= 64:
            cfg["id"]["callmessage"] = i["callmessage"]
        else:
            rep.bad("id.callmessage", "1-64 chars")
    if "use_callsign_as_name" in i:
        if isinstance(i["use_callsign_as_name"], bool):
            cfg["id"]["use_callsign_as_name"] = i["use_callsign_as_name"]
        else:
            rep.bad("id.use_callsign_as_name", "bool")
    if cfg["id"]["use_callsign_as_name"] and _blen(cfg["id"]["callmessage"]) > MAX_NAME:
        rep.bad("id.callmessage", "over 32 bytes for a network name")
        cfg["id"]["use_callsign_as_name"] = False

    # ---- schedule
    s = u.get("schedule") if isinstance(u.get("schedule"), dict) else {}
    if "kind" in s and s["kind"] != "duty":
        rep.bad("schedule.kind", "duty")
    for k, lo, hi in (("wake_s", 1, 3600), ("sleep_s", 0, 86400)):
        if k in s:
            if _is_int(s[k]) and lo <= s[k] <= hi:
                cfg["schedule"][k] = s[k]
            else:
                rep.bad("schedule." + k, "%d-%d" % (lo, hi))
    if "sleep" in s:
        if s["sleep"] in ("off", "deep"):
            cfg["schedule"]["sleep"] = s["sleep"]
        else:
            rep.bad("schedule.sleep", "off|deep")

    # ---- led, fleet
    l = u.get("led") if isinstance(u.get("led"), dict) else {}
    if "enabled" in l:
        if isinstance(l["enabled"], bool):
            cfg["led"]["enabled"] = l["enabled"]
        else:
            rep.bad("led.enabled", "bool")
    if isinstance(u.get("fleet"), dict):
        for k, v in u["fleet"].items():
            if k in cfg["fleet"] and (v is None or isinstance(v, (str, int))):
                cfg["fleet"][k] = v
    if rep.items and rep.mode == "ok":
        rep.mode = "partial"
    return cfg, rep


def id_ok(cfg):
    return PLACEHOLDER not in cfg["id"]["callmessage"]


def display_name(cfg):
    """The SSID / BLE name on the air: the callsign when asked for, else the net section's."""
    if cfg["id"]["use_callsign_as_name"]:
        return cfg["id"]["callmessage"][:MAX_NAME]
    return cfg["net"].get("ssid") or cfg["net"].get("name") or ""


def load(path, defaults_path, board_id=None, radios=None):
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
    except ValueError:
        rep.mode = "default(parse)"
        return _copy(defaults), rep
    return validate(user, defaults, board_id, radios)
