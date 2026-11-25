/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/netcfg.c -- see netcfg.h. Every rule here has its line in foxlib/netcfg.py; keep the two in step
 * (tests/netcfg_parity.py runs both on firmware/sim/schema_corpus.json). */
#include "netcfg.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void scopy(char *dst, int n, const char *s) { if (!s) { dst[0] = 0; return; } strncpy(dst, s, (size_t)n - 1); dst[n - 1] = 0; }
static int blen(const char *s) { return (int)strlen(s); }            /* bytes, as netcfg.py's _blen (the strings are UTF-8 already) */
static bool is_str(const json_doc *d, int k) { return k >= 0 && json_is(d, k, J_STR); }
static bool is_bool(const json_doc *d, int k) { return k >= 0 && json_is(d, k, J_BOOL); }
static bool str_between(const json_doc *d, int k, int lo, int hi) { const char *s = json_str(d, k); return s && blen(s) >= lo && blen(s) <= hi; }

static const int WIFI5_CHANNELS[] = { 36, 40, 44, 48, 149, 153, 157, 161, 165 };
static const double WIFI_POWER_DBM[] = { 2, 5, 7, 8.5, 11, 13, 15, 17, 18.5, 19, 19.5 };
static const int BLE_POWER_DBM[] = { -12, -9, -6, -3, 0, 3, 6, 9 };

static bool channel_ok(int c, bool band5) {
    if (c >= 1 && c <= 13) return true;
    if (band5) for (unsigned i = 0; i < sizeof WIFI5_CHANNELS / sizeof *WIFI5_CHANNELS; i++) if (WIFI5_CHANNELS[i] == c) return true;
    return false;
}

const char *net_kind_name(net_kind_t k) { return k == NET_WIFI_AP ? "wifi-ap" : k == NET_WIFI_PROBE ? "wifi-probe" : "ble"; }

bool net_parse_mac(const char *s, uint8_t out[6]) {
    if (!s) return false;
    int n = 0; const char *p = s;
    while (*p && n < 6) {
        char *end; long v = strtol(p, &end, 16);
        if (end == p || end - p > 2 || v < 0 || v > 255) return false;
        out[n++] = (uint8_t)v; p = end;
        if (*p == ':' || *p == '-') { p++; if (!*p) return false; } else if (*p) return false;
    }
    return n == 6 && !*p && !(out[0] & 1);
}

static void add_key(net_cfg_t *cfg, const char *k) {
    for (int i = 0; i < cfg->net.n_keys; i++) if (!strcmp(cfg->net.keys[i], k)) return;
    if (cfg->net.n_keys < NET_MAX_KEYS) scopy(cfg->net.keys[cfg->net.n_keys++], sizeof cfg->net.keys[0], k);
}
static bool has_key(const net_cfg_t *cfg, const char *k) { for (int i = 0; i < cfg->net.n_keys; i++) if (!strcmp(cfg->net.keys[i], k)) return true; return false; }
bool net_cfg_has_key(const net_cfg_t *cfg, const char *k) { return has_key(cfg, k); }

bool net_cfg_load_defaults(net_cfg_t *cfg, const json_doc *d, int root) {
    memset(cfg, 0, sizeof *cfg);
    if (!json_is(d, root, J_OBJ)) return false;
    scopy(cfg->template_id, sizeof cfg->template_id, json_str(d, json_get(d, root, "template")));
    scopy(cfg->board, sizeof cfg->board, json_str(d, json_get(d, root, "board")));
    scopy(cfg->variant, sizeof cfg->variant, json_str(d, json_get(d, root, "variant")));
    if (!cfg->template_id[0]) return false;
    int p = json_get(d, root, "pins");
    if (p >= 0) {
        int k = json_get(d, p, "led"); cfg->pins.led_null = k < 0 || json_is_null(d, k); scopy(cfg->pins.led, sizeof cfg->pins.led, json_str(d, k));
        k = json_get(d, p, "batt_sense"); cfg->pins.batt_null = k < 0 || json_is_null(d, k); scopy(cfg->pins.batt_sense, sizeof cfg->pins.batt_sense, json_str(d, k));
    } else cfg->pins.led_null = cfg->pins.batt_null = true;
    int n = json_get(d, root, "net");
    if (n < 0) return false;
    const char *kind = json_str(d, json_get(d, n, "kind"));
    if (!kind) return false;
    if (!strcmp(kind, "wifi-ap")) cfg->net.kind = NET_WIFI_AP; else if (!strcmp(kind, "wifi-probe")) cfg->net.kind = NET_WIFI_PROBE; else if (!strcmp(kind, "ble")) cfg->net.kind = NET_BLE; else return false;
    for (int m = json_at(d, n)->first; m >= 0; m = json_at(d, m)->next) add_key(cfg, json_key(d, m));
    scopy(cfg->net.ssid, sizeof cfg->net.ssid, json_str(d, json_get(d, n, "ssid")));
    scopy(cfg->net.psk, sizeof cfg->net.psk, json_str(d, json_get(d, n, "psk")));
    scopy(cfg->net.name, sizeof cfg->net.name, json_str(d, json_get(d, n, "name")));
    scopy(cfg->net.mac, sizeof cfg->net.mac, json_str(d, json_get(d, n, "mac")));
    cfg->net.channel = json_int(d, json_get(d, n, "channel"), 1);
    cfg->net.hidden = json_bool(d, json_get(d, n, "hidden"), false);
    cfg->net.tx_power_dbm = json_num(d, json_get(d, n, "tx_power_dbm"), 0);
    cfg->net.max_clients = json_int(d, json_get(d, n, "max_clients"), 1);
    int ch = json_get(d, n, "channels"); cfg->net.n_channels = 0;
    if (ch >= 0 && json_is(d, ch, J_ARR)) for (int i = 0; i < json_len(d, ch) && cfg->net.n_channels < NET_MAX_CHANNELS; i++) cfg->net.channels[cfg->net.n_channels++] = json_int(d, json_index(d, ch, i), 1);
    int ps = json_get(d, n, "probe_ssids"); cfg->net.n_probe_ssids = 0;
    if (ps >= 0 && json_is(d, ps, J_ARR)) for (int i = 0; i < json_len(d, ps) && cfg->net.n_probe_ssids < NET_MAX_PROBE_SSIDS; i++) scopy(cfg->net.probe_ssids[cfg->net.n_probe_ssids++], NET_MAX_NAME + 1, json_str(d, json_index(d, ps, i)));
    cfg->net.probe_ssid_s = json_int(d, json_get(d, n, "probe_ssid_s"), 0);
    scopy(cfg->net.uuid, sizeof cfg->net.uuid, json_str(d, json_get(d, n, "uuid")));
    cfg->net.major = json_int(d, json_get(d, n, "major"), 0); cfg->net.minor = json_int(d, json_get(d, n, "minor"), 0);
    cfg->net.signal_power_dbm = json_int(d, json_get(d, n, "signal_power_dbm"), -59);
    cfg->net.adv_min = json_int(d, json_get(d, n, "adv_min"), 100); cfg->net.adv_max = json_int(d, json_get(d, n, "adv_max"), 100);
    int id = json_get(d, root, "id");
    scopy(cfg->id.callmessage, sizeof cfg->id.callmessage, json_str(d, json_get(d, id, "callmessage")));
    cfg->id.use_callsign_as_name = json_bool(d, json_get(d, id, "use_callsign_as_name"), false);
    int s = json_get(d, root, "schedule");
    cfg->schedule.wake_s = json_int(d, json_get(d, s, "wake_s"), 15); cfg->schedule.sleep_s = json_int(d, json_get(d, s, "sleep_s"), 5);
    const char *sl = json_str(d, json_get(d, s, "sleep")); cfg->schedule.deep = sl && !strcmp(sl, "deep");
    cfg->led.enabled = json_bool(d, json_get(d, json_get(d, root, "led"), "enabled"), true);
    int f = json_get(d, root, "fleet");
    scopy(cfg->fleet.profile, sizeof cfg->fleet.profile, json_str(d, json_get(d, f, "profile")));
    scopy(cfg->fleet.event, sizeof cfg->fleet.event, json_str(d, json_get(d, f, "event")));
    scopy(cfg->fleet.notes, sizeof cfg->fleet.notes, json_str(d, json_get(d, f, "notes")));
    int num = json_get(d, f, "number"); cfg->fleet.number_set = num >= 0 && json_is_int(d, num); cfg->fleet.number = json_int(d, num, 0);
    int cp = json_get(d, root, "checkpoint");
    cfg->checkpoint.enabled = json_bool(d, json_get(d, cp, "enabled"), false);
    cfg->checkpoint.portal = json_bool(d, json_get(d, json_get(d, cp, "portal"), "enabled"), false);
    return true;
}

static bool names_ok(const json_doc *d, int arr, int n, int each) {
    if (!json_is(d, arr, J_ARR) || json_len(d, arr) > n) return false;
    for (int i = 0; i < json_len(d, arr); i++) { int e = json_index(d, arr, i); if (!is_str(d, e) || !str_between(d, e, 1, each)) return false; }
    return true;
}
static bool distinct_strs(const json_doc *d, int arr) {
    for (int i = 0; i < json_len(d, arr); i++) for (int j = i + 1; j < json_len(d, arr); j++)
        if (!strcmp(json_str(d, json_index(d, arr, i)), json_str(d, json_index(d, arr, j)))) return false;
    return true;
}

static void validate_pins(net_cfg_t *cfg, const json_doc *d, int u, const char *const *board_names, cfg_report_t *rep) {
    int k = json_get(d, u, "variant");
    if (k >= 0) { if (is_str(d, k) && str_between(d, k, 1, 40)) scopy(cfg->variant, sizeof cfg->variant, json_str(d, k)); else cfg_report_bad(rep, "variant", "string"); }
    int p = json_get(d, u, "pins"); if (p < 0 || !json_is(d, p, J_OBJ)) return;
    for (int m = json_at(d, p)->first; m >= 0; m = json_at(d, m)->next) {
        const char *role = json_key(d, m);
        bool led = !strcmp(role, "led"), batt = !strcmp(role, "batt_sense");
        if (!led && !batt) { char key[40]; snprintf(key, sizeof key, "pins.%s", role); cfg_report_bad(rep, key, "unknown role"); continue; }
        if (json_is_null(d, m)) { if (led) { cfg->pins.led_null = true; cfg->pins.led[0] = 0; } else { cfg->pins.batt_null = true; cfg->pins.batt_sense[0] = 0; } continue; }
        const char *v = json_str(d, m);
        bool known = v && (!board_names || ({ bool f = false; for (const char *const *b = board_names; *b; b++) if (!strcmp(*b, v)) { f = true; break; } f; }));
        if (known) { if (led) { cfg->pins.led_null = false; scopy(cfg->pins.led, sizeof cfg->pins.led, v); } else { cfg->pins.batt_null = false; scopy(cfg->pins.batt_sense, sizeof cfg->pins.batt_sense, v); } }
        else { char key[40], why[32]; snprintf(key, sizeof key, "pins.%s", role); if (v) snprintf(why, sizeof why, "no pin %s on this board", v); else snprintf(why, sizeof why, "name or null"); cfg_report_bad(rep, key, why); }
    }
}

static void validate_net(net_cfg_t *cfg, const json_doc *d, int u, unsigned radios, cfg_report_t *rep) {
    int n = json_get(d, u, "net"); if (n < 0 || !json_is(d, n, J_OBJ)) n = -1;
    net_kind_t kind = cfg->net.kind;
    bool band5 = (radios & RADIO_UNKNOWN) ? false : (radios & RADIO_WIFI5);
    int k;
    if (n >= 0 && (k = json_get(d, n, "kind")) >= 0) { const char *s = json_str(d, k); if (!s || strcmp(s, net_kind_name(kind))) cfg_report_bad(rep, "net.kind", "fixed by the template"); }
    if (kind == NET_WIFI_AP || kind == NET_WIFI_PROBE) {
        if (n >= 0 && (k = json_get(d, n, "ssid")) >= 0) { if (is_str(d, k) && str_between(d, k, 1, NET_MAX_NAME)) scopy(cfg->net.ssid, sizeof cfg->net.ssid, json_str(d, k)); else cfg_report_bad(rep, "net.ssid", "1-32 bytes"); }
        if (n >= 0 && (k = json_get(d, n, "tx_power_dbm")) >= 0) {
            bool ok = false; double v = json_num(d, k, -1000);
            if (json_is_num(d, k)) for (unsigned i = 0; i < sizeof WIFI_POWER_DBM / sizeof *WIFI_POWER_DBM; i++) if (WIFI_POWER_DBM[i] == v) ok = true;
            if (ok) cfg->net.tx_power_dbm = v; else cfg_report_bad(rep, "net.tx_power_dbm", "one of the Wi-Fi power steps");
        }
    }
    if (kind == NET_WIFI_AP) {
        if (n >= 0 && (k = json_get(d, n, "psk")) >= 0) { const char *s = json_str(d, k); if (s && (!*s || (blen(s) >= 8 && blen(s) <= NET_MAX_PSK))) scopy(cfg->net.psk, sizeof cfg->net.psk, s); else cfg_report_bad(rep, "net.psk", "empty (open) or 8-63 bytes"); }
        if (n >= 0 && (k = json_get(d, n, "channel")) >= 0) { if (json_is_int(d, k) && channel_ok(json_int(d, k, 0), band5)) cfg->net.channel = json_int(d, k, 1); else cfg_report_bad(rep, "net.channel", band5 ? "1-13 or a 5 GHz channel" : "1-13"); }
        add_key(cfg, "channels");
        if (n >= 0 && (k = json_get(d, n, "channels")) >= 0) {
            const char *s = json_str(d, k);
            if (s && !strcmp(s, "any")) { cfg->net.n_channels = 11; for (int i = 0; i < 11; i++) cfg->net.channels[i] = i + 1; }
            else {
                bool ok = json_is(d, k, J_ARR) && json_len(d, k) <= 13;
                int tmp[NET_MAX_CHANNELS], cnt = 0;
                for (int i = 0; ok && i < json_len(d, k); i++) {
                    int e = json_index(d, k, i); int v = json_int(d, e, -1);
                    if (!json_is_int(d, e) || !channel_ok(v, band5)) { ok = false; break; }
                    for (int j = 0; j < cnt; j++) if (tmp[j] == v) ok = false;
                    tmp[cnt++] = v;
                }
                if (ok) { memcpy(cfg->net.channels, tmp, sizeof tmp); cfg->net.n_channels = cnt; } else cfg_report_bad(rep, "net.channels", "\"any\" or up to 13 distinct channels");
            }
        }
        if (n >= 0 && (k = json_get(d, n, "hidden")) >= 0) { if (is_bool(d, k)) cfg->net.hidden = json_bool(d, k, false); else cfg_report_bad(rep, "net.hidden", "bool"); }
        if (n >= 0 && (k = json_get(d, n, "max_clients")) >= 0) { int v = json_int(d, k, 0); if (json_is_int(d, k) && v >= 1 && v <= 8) cfg->net.max_clients = v; else cfg_report_bad(rep, "net.max_clients", "1-8"); }
    }
    if (kind == NET_WIFI_PROBE) {
        add_key(cfg, "probe_ssids"); add_key(cfg, "probe_ssid_s");
        if (n >= 0 && (k = json_get(d, n, "probe_ssids")) >= 0) {
            if (names_ok(d, k, NET_MAX_PROBE_SSIDS, NET_MAX_NAME) && distinct_strs(d, k)) { cfg->net.n_probe_ssids = json_len(d, k); for (int i = 0; i < json_len(d, k); i++) scopy(cfg->net.probe_ssids[i], NET_MAX_NAME + 1, json_str(d, json_index(d, k, i))); }
            else cfg_report_bad(rep, "net.probe_ssids", "up to 8 distinct names of 1-32 bytes");
        }
        if (n >= 0 && (k = json_get(d, n, "probe_ssid_s")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 0 && v <= 600) cfg->net.probe_ssid_s = v; else cfg_report_bad(rep, "net.probe_ssid_s", "0-600 s"); }
    }
    if (kind == NET_BLE) {
        if (n >= 0 && (k = json_get(d, n, "name")) >= 0) { if (is_str(d, k) && str_between(d, k, 1, NET_MAX_NAME)) scopy(cfg->net.name, sizeof cfg->net.name, json_str(d, k)); else cfg_report_bad(rep, "net.name", "1-32 bytes"); }
        if (n >= 0 && (k = json_get(d, n, "uuid")) >= 0) {
            const char *s = json_str(d, k); bool ok = s && strlen(s) == 36;
            static const int seg[] = { 8, 4, 4, 4, 12 }; int pos = 0;
            for (int i = 0; ok && i < 5; i++) { for (int j = 0; j < seg[i]; j++) if (!isxdigit((unsigned char)s[pos + j])) ok = false; pos += seg[i]; if (i < 4 && s[pos++] != '-') ok = false; }
            if (ok) { for (int i = 0; i < 36; i++) cfg->net.uuid[i] = (char)toupper((unsigned char)s[i]); cfg->net.uuid[36] = 0; } else cfg_report_bad(rep, "net.uuid", "8-4-4-4-12 hex");
        }
        if (n >= 0 && (k = json_get(d, n, "major")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 0 && v <= 65535) cfg->net.major = v; else cfg_report_bad(rep, "net.major", "0-65535"); }
        if (n >= 0 && (k = json_get(d, n, "minor")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 0 && v <= 65535) cfg->net.minor = v; else cfg_report_bad(rep, "net.minor", "0-65535"); }
        if (n >= 0 && (k = json_get(d, n, "signal_power_dbm")) >= 0) { int v = json_int(d, k, 1); if (json_is_int(d, k) && v >= -128 && v <= 0) cfg->net.signal_power_dbm = v; else cfg_report_bad(rep, "net.signal_power_dbm", "-128-0"); }
        if (n >= 0 && (k = json_get(d, n, "adv_min")) >= 0) { int v = json_int(d, k, 0); if (json_is_int(d, k) && v >= 20 && v <= 10240) cfg->net.adv_min = v; else cfg_report_bad(rep, "net.adv_min", "20-10240 ms"); }
        if (n >= 0 && (k = json_get(d, n, "adv_max")) >= 0) { int v = json_int(d, k, 0); if (json_is_int(d, k) && v >= 20 && v <= 10240) cfg->net.adv_max = v; else cfg_report_bad(rep, "net.adv_max", "20-10240 ms"); }
        if (cfg->net.adv_min > cfg->net.adv_max) { cfg_report_bad(rep, "net.adv_min", "<= adv_max"); cfg->net.adv_min = cfg->net.adv_max; }
        if (n >= 0 && (k = json_get(d, n, "tx_power_dbm")) >= 0) {
            bool ok = false; int v = json_int(d, k, -1000);
            if (json_is_int(d, k)) for (unsigned i = 0; i < sizeof BLE_POWER_DBM / sizeof *BLE_POWER_DBM; i++) if (BLE_POWER_DBM[i] == v) ok = true;
            if (ok) cfg->net.tx_power_dbm = v; else cfg_report_bad(rep, "net.tx_power_dbm", "one of the BLE power steps");
        }
    }
    if (n >= 0 && (k = json_get(d, n, "mac")) >= 0) {
        uint8_t mac[6]; const char *s = json_str(d, k);
        if (net_parse_mac(s, mac)) snprintf(cfg->net.mac, sizeof cfg->net.mac, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        else cfg_report_bad(rep, "net.mac", "6 hex bytes, unicast");
    }
    if (n >= 0) for (int m = json_at(d, n)->first; m >= 0; m = json_at(d, m)->next)
        if (!has_key(cfg, json_key(d, m))) { char key[40]; snprintf(key, sizeof key, "net.%s", json_key(d, m)); cfg_report_bad(rep, key, "unknown"); }
}

static void validate_id(net_cfg_t *cfg, const json_doc *d, int u, cfg_report_t *rep) {
    int i = json_get(d, u, "id"); if (i < 0 || !json_is(d, i, J_OBJ)) i = -1;
    int k;
    if (i >= 0 && (k = json_get(d, i, "callmessage")) >= 0) { if (is_str(d, k) && str_between(d, k, 1, 64)) scopy(cfg->id.callmessage, sizeof cfg->id.callmessage, json_str(d, k)); else cfg_report_bad(rep, "id.callmessage", "1-64 chars"); }
    if (i >= 0 && (k = json_get(d, i, "use_callsign_as_name")) >= 0) { if (is_bool(d, k)) cfg->id.use_callsign_as_name = json_bool(d, k, false); else cfg_report_bad(rep, "id.use_callsign_as_name", "bool"); }
    if (cfg->id.use_callsign_as_name && blen(cfg->id.callmessage) > NET_MAX_NAME) { cfg_report_bad(rep, "id.callmessage", "over 32 bytes for a network name"); cfg->id.use_callsign_as_name = false; }
}

static void validate_schedule(net_cfg_t *cfg, const json_doc *d, int u, cfg_report_t *rep) {
    int s = json_get(d, u, "schedule"); if (s < 0 || !json_is(d, s, J_OBJ)) return;
    int k;
    if ((k = json_get(d, s, "kind")) >= 0) { const char *v = json_str(d, k); if (!v || strcmp(v, "duty")) cfg_report_bad(rep, "schedule.kind", "duty"); }
    if ((k = json_get(d, s, "wake_s")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 1 && v <= 3600) cfg->schedule.wake_s = v; else cfg_report_bad(rep, "schedule.wake_s", "1-3600"); }
    if ((k = json_get(d, s, "sleep_s")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 0 && v <= 86400) cfg->schedule.sleep_s = v; else cfg_report_bad(rep, "schedule.sleep_s", "0-86400"); }
    if ((k = json_get(d, s, "sleep")) >= 0) { const char *v = json_str(d, k); if (v && (!strcmp(v, "off") || !strcmp(v, "deep"))) cfg->schedule.deep = !strcmp(v, "deep"); else cfg_report_bad(rep, "schedule.sleep", "off|deep"); }
}

static void validate_features(net_cfg_t *cfg, const json_doc *d, int u, cfg_report_t *rep) {
    /* netcfg.py validates each section in full; this firmware does not run them yet, so a section that is present is
     * reported as such (partial) and the fox runs without it. The parity test skips cases that carry one. */
    static const char *const secs[] = { "payload", "checkpoint", "sense", "stealth" };
    bool *flags[] = { &cfg->features_present.payload, &cfg->features_present.checkpoint, &cfg->features_present.sense, &cfg->features_present.stealth };
    for (int i = 0; i < 4; i++) {
        int k = json_get(d, u, secs[i]); if (k < 0) continue;
        if (!json_is(d, k, J_OBJ)) { cfg_report_bad(rep, secs[i], "object"); continue; }
        if (json_bool(d, json_get(d, k, "enabled"), false)) { *flags[i] = true; cfg_report_bad(rep, secs[i], "not in this firmware"); }
    }
}

static void validate_led_fleet(net_cfg_t *cfg, const json_doc *d, int u, cfg_report_t *rep) {
    int l = json_get(d, u, "led"), k;
    if (l >= 0 && json_is(d, l, J_OBJ) && (k = json_get(d, l, "enabled")) >= 0) { if (is_bool(d, k)) cfg->led.enabled = json_bool(d, k, true); else cfg_report_bad(rep, "led.enabled", "bool"); }
    int f = json_get(d, u, "fleet"); if (f < 0 || !json_is(d, f, J_OBJ)) return;
    for (int m = json_at(d, f)->first; m >= 0; m = json_at(d, m)->next) {
        const char *key = json_key(d, m); bool ok = json_is_null(d, m) || json_is(d, m, J_STR) || json_is_int(d, m);
        if (!ok) continue;
        const char *s = json_str(d, m);
        if (!strcmp(key, "profile")) scopy(cfg->fleet.profile, sizeof cfg->fleet.profile, s);
        else if (!strcmp(key, "event")) scopy(cfg->fleet.event, sizeof cfg->fleet.event, s);
        else if (!strcmp(key, "notes")) scopy(cfg->fleet.notes, sizeof cfg->fleet.notes, s);
        else if (!strcmp(key, "owner")) scopy(cfg->fleet.owner, sizeof cfg->fleet.owner, s);
        else if (!strcmp(key, "points_to")) scopy(cfg->fleet.points_to, sizeof cfg->fleet.points_to, s);
        else if (!strcmp(key, "number")) { cfg->fleet.number_set = json_is_int(d, m); cfg->fleet.number = json_int(d, m, 0); }
    }
}

void net_cfg_apply_user(net_cfg_t *cfg, const net_cfg_t *defaults, const json_doc *d, int root, const char *board_id,
                        unsigned radios, const char *const *board_names, cfg_report_t *rep) {
    *cfg = *defaults;
    cfg_report_init(rep);
    if (root < 0 || !json_is(d, root, J_OBJ)) return;        /* not an object: the defaults, as netcfg.py's `u = {}` */
    int k;
    if ((k = json_get(d, root, "schema")) >= 0 && !(json_is_int(d, k) && json_int(d, k, 0) == 1)) { cfg_report_mode(rep, "default(schema)"); return; }
    if ((k = json_get(d, root, "template")) >= 0) { const char *s = json_str(d, k); if (!s || strcmp(s, defaults->template_id)) { cfg_report_mode(rep, "default(template)"); return; } }
    if ((k = json_get(d, root, "board")) >= 0 && board_id) { const char *s = json_str(d, k); if (!s || (strcmp(s, board_id) && strcmp(s, defaults->board))) { cfg_report_mode(rep, "default(board)"); return; } }
    validate_pins(cfg, d, root, board_names, rep);
    validate_net(cfg, d, root, radios, rep);
    validate_id(cfg, d, root, rep);
    validate_schedule(cfg, d, root, rep);
    validate_features(cfg, d, root, rep);
    if (cfg->checkpoint.enabled && cfg->checkpoint.portal && cfg->schedule.deep) {   /* netcfg.py: the page refuses the same way */
        cfg_report_bad(rep, "schedule.sleep", "deep sleep would drop a hunter mid-page; off"); cfg->schedule.deep = false;
    }
    validate_led_fleet(cfg, d, root, rep);
    if (rep->n_items) cfg_report_mode(rep, "partial");
}

bool net_cfg_id_ok(const net_cfg_t *cfg) { return strstr(cfg->id.callmessage, NET_PLACEHOLDER) == NULL; }
const char *net_cfg_name_on_air(const net_cfg_t *cfg) {
    if (cfg->id.use_callsign_as_name) return cfg->id.callmessage;
    return cfg->net.kind == NET_BLE ? cfg->net.name : cfg->net.ssid;
}
