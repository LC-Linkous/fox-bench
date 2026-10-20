/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/cfg.c -- see cfg.h. The rules track foxlib/cfg.py validate(); where this
 * family differs (no pins; si5351fm radio keys) the differences are marked FOXLIB-C. */
#include "cfg.h"
#include <stdio.h>
#include <string.h>

static void scopy(char *dst, int n, const char *s) { if (!s) { dst[0] = 0; return; } strncpy(dst, s, (size_t)n - 1); dst[n - 1] = 0; }

void cfg_report_init(cfg_report_t *rep) { rep->n_items = 0; rep->fatal[0] = 0; strcpy(rep->mode, "ok"); }
void cfg_report_bad(cfg_report_t *rep, const char *key, const char *reason) {
    if (!rep || rep->n_items >= CFG_MAX_ITEMS) return;
    scopy(rep->items[rep->n_items].key, sizeof rep->items[0].key, key);
    scopy(rep->items[rep->n_items].reason, sizeof rep->items[0].reason, reason);
    rep->n_items++;
}
static void set_fatal(cfg_report_t *rep, const char *why) { if (rep && !rep->fatal[0]) scopy(rep->fatal, sizeof rep->fatal, why); }

const char *cfg_report_status(const cfg_report_t *rep, char *buf, int n) {
    if (rep->fatal[0]) { snprintf(buf, (size_t)n, "fatal(%s)", rep->fatal); return buf; }
    if (!strncmp(rep->mode, "default", 7)) { snprintf(buf, (size_t)n, "%s", rep->mode); return buf; }
    if (rep->n_items) {
        int o = snprintf(buf, (size_t)n, "partial(");
        for (int i = 0; i < rep->n_items && o < n - 2; i++) o += snprintf(buf + o, (size_t)(n - o), "%s%s", i ? "," : "", rep->items[i].key);
        if (o < n - 1) snprintf(buf + o, (size_t)(n - o), ")");
        return buf;
    }
    snprintf(buf, (size_t)n, "ok"); return buf;
}

bool cfg_id_ok(const fox_cfg_t *cfg) { return cfg->id.placeholder[0] && !strstr(cfg->id.callmessage, cfg->id.placeholder); }
bool cfg_freq_in_ranges(const fox_cfg_t *cfg, double f) {
    for (int i = 0; i < cfg->radio.n_ranges; i++) if (cfg->radio.ranges_mhz[i][0] <= f && f <= cfg->radio.ranges_mhz[i][1]) return true;
    return false;
}

/* ---- songs */
static bool song_from_json(const json_doc *d, int s, song_t *out) {
    if (!json_is(d, s, J_OBJ)) return false;
    const char *name = json_str(d, json_get(d, s, "name"));
    int tempo_n = json_get(d, s, "tempo"), notes = json_get(d, s, "notes");
    if (!name || !json_is_int(d, tempo_n) || !json_is(d, notes, J_ARR) || json_len(d, notes) < 1 || json_len(d, notes) > SONG_MAX_NOTES) return false;
    int tempo = json_int(d, tempo_n, 0);
    if (tempo < 40 || tempo > 300) return false;
    scopy(out->name, sizeof out->name, name); out->tempo = tempo; out->n_notes = 0;
    for (int n = json_index(d, notes, 0); n >= 0; n = d->nodes[n].next) {
        if (!json_is(d, n, J_ARR) || json_len(d, n) != 2) return false;
        int a = json_index(d, n, 0), b = json_index(d, n, 1);
        if (!json_is_int(d, a) || !json_is_int(d, b)) return false;
        int midi = json_int(d, a, -1), dur = json_int(d, b, -1);
        if (midi < 0 || midi > 127 || dur < 1 || dur > 64) return false;
        out->notes[out->n_notes][0] = (short)midi; out->notes[out->n_notes][1] = (short)dur; out->n_notes++;
    }
    return true;
}

/* ---- the shared applier. rep == NULL means "defaults": take what is there, no report. */
static void apply_radio(fox_cfg_t *cfg, const json_doc *d, int r, cfg_report_t *rep) {
    int k;
    if ((k = json_get(d, r, "family")) >= 0) { const char *s = json_str(d, k); if (s && *s) scopy(cfg->radio.family, sizeof cfg->radio.family, s); else cfg_report_bad(rep, "radio.family", "string"); }
    if ((k = json_get(d, r, "ranges_mhz")) >= 0) {
        bool ok = json_is(d, k, J_ARR) && json_len(d, k) >= 1 && json_len(d, k) <= CFG_MAX_RANGES;
        float tmp[CFG_MAX_RANGES][2]; int n = 0;
        for (int x = ok ? json_index(d, k, 0) : -1; x >= 0 && ok; x = d->nodes[x].next) {
            int lo = json_index(d, x, 0), hi = json_index(d, x, 1);
            ok = json_is(d, x, J_ARR) && json_len(d, x) == 2 && json_is_num(d, lo) && json_is_num(d, hi) && json_num(d, lo, 0) < json_num(d, hi, 0);
            if (ok) { tmp[n][0] = (float)json_num(d, lo, 0); tmp[n][1] = (float)json_num(d, hi, 0); n++; }
        }
        if (ok) { memcpy(cfg->radio.ranges_mhz, tmp, sizeof tmp); cfg->radio.n_ranges = n; } else cfg_report_bad(rep, "radio.ranges_mhz", "[[lo,hi],...]");
    }
    if ((k = json_get(d, r, "bandwidth_khz")) >= 0) { double v = json_num(d, k, -1); if (json_is_num(d, k) && v >= 1 && v <= 100) cfg->radio.bandwidth_khz = (float)v; else cfg_report_bad(rep, "radio.bandwidth_khz", "1-100"); }
    if ((k = json_get(d, r, "power_dbm")) >= 0) {
        if (json_is_null(d, k)) cfg->radio.power_set = false;
        else if (json_is_num(d, k) && json_num(d, k, -1) >= 0 && json_num(d, k, -1) <= 40) { cfg->radio.power_dbm = (float)json_num(d, k, 0); cfg->radio.power_set = true; }
        else cfg_report_bad(rep, "radio.power_dbm", "null or 0-40");
    }
    /* FOXLIB-C: si5351fm keys */
    if ((k = json_get(d, r, "itu_zone")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 1 && v <= 3) cfg->radio.itu_zone = v; else cfg_report_bad(rep, "radio.itu_zone", "1-3"); }
    if ((k = json_get(d, r, "attenuation")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 0 && v <= 127) cfg->radio.attenuation = v; else cfg_report_bad(rep, "radio.attenuation", "0-127"); }
    if ((k = json_get(d, r, "id_deviation_hz")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 500 && v <= 10000) cfg->radio.id_deviation_hz = v; else cfg_report_bad(rep, "radio.id_deviation_hz", "500-10000"); }
    if ((k = json_get(d, r, "audio_deviation_hz")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 500 && v <= 10000) cfg->radio.audio_deviation_hz = v; else cfg_report_bad(rep, "radio.audio_deviation_hz", "500-10000"); }
    if ((k = json_get(d, r, "tone_shape")) >= 0) { const char *s = json_str(d, k); if (s && !strcmp(s, "sine")) cfg->radio.tone_shape = SHAPE_SINE; else if (s && !strcmp(s, "bright")) cfg->radio.tone_shape = SHAPE_BRIGHT; else cfg_report_bad(rep, "radio.tone_shape", "sine|bright"); }
    if ((k = json_get(d, r, "preemphasis")) >= 0) { if (json_is(d, k, J_BOOL)) cfg->radio.preemphasis = json_bool(d, k, true); else cfg_report_bad(rep, "radio.preemphasis", "bool"); }
    if ((k = json_get(d, r, "correction_ppm")) >= 0) { double v = json_num(d, k, 999); if (json_is_num(d, k) && v >= -200 && v <= 200) cfg->radio.correction_ppm = (float)v; else cfg_report_bad(rep, "radio.correction_ppm", "-200..200"); }
    if ((k = json_get(d, r, "sample_rate")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 4000 && v <= 10000) cfg->radio.sample_rate = v; else cfg_report_bad(rep, "radio.sample_rate", "4000-10000"); }
    if ((k = json_get(d, r, "tx_while_mounted")) >= 0) { if (json_is(d, k, J_BOOL)) cfg->radio.tx_while_mounted = json_bool(d, k, true); else cfg_report_bad(rep, "radio.tx_while_mounted", "bool"); }
    /* revision, squelch, volume, high_power: other families' / page-side keys; accepted silently */
}

static void apply_plan(fox_cfg_t *cfg, const json_doc *d, int p, cfg_report_t *rep) {
    int k;
    if ((k = json_get(d, p, "frequencies_mhz")) >= 0) {
        bool ok = json_is(d, k, J_ARR) && json_len(d, k) >= 1 && json_len(d, k) <= CFG_MAX_FREQS;
        double tmp[CFG_MAX_FREQS]; int n = 0;
        for (int x = ok ? json_index(d, k, 0) : -1; x >= 0 && ok; x = d->nodes[x].next) { ok = json_is_num(d, x); if (ok) tmp[n++] = json_num(d, x, 0); }
        if (ok) { memcpy(cfg->plan.frequencies_mhz, tmp, sizeof tmp); cfg->plan.n = n; } else cfg_report_bad(rep, "plan.frequencies_mhz", "non-empty list");
    }
    if ((k = json_get(d, p, "announce_qsy")) >= 0) { if (json_is(d, k, J_BOOL)) cfg->plan.announce_qsy = json_bool(d, k, false); else cfg_report_bad(rep, "plan.announce_qsy", "bool"); }
}

static void apply_id(fox_cfg_t *cfg, const json_doc *d, int i, cfg_report_t *rep) {
    int k; const char *s;
    if ((k = json_get(d, i, "callmessage")) >= 0) { s = json_str(d, k); if (s && strlen(s) >= 1 && strlen(s) <= 64) scopy(cfg->id.callmessage, sizeof cfg->id.callmessage, s); else cfg_report_bad(rep, "id.callmessage", "1-64 chars"); }
    if ((k = json_get(d, i, "placeholder")) >= 0) { s = json_str(d, k); if (s && *s) scopy(cfg->id.placeholder, sizeof cfg->id.placeholder, s); else cfg_report_bad(rep, "id.placeholder", "string"); }
    if ((k = json_get(d, i, "wpm")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 5 && v <= 40) cfg->id.wpm = v; else cfg_report_bad(rep, "id.wpm", "5-40"); }
    if ((k = json_get(d, i, "tone_hz")) >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 300 && v <= 3000) cfg->id.tone_hz = v; else cfg_report_bad(rep, "id.tone_hz", "300-3000"); }
    if ((k = json_get(d, i, "telemetry")) >= 0) {
        bool ok = json_is(d, k, J_ARR), batt = false;
        for (int x = ok ? json_index(d, k, 0) : -1; x >= 0 && ok; x = d->nodes[x].next) { s = json_str(d, x); ok = s && !strcmp(s, "batt"); if (ok) batt = true; }
        if (ok) cfg->id.telemetry_batt = batt; else cfg_report_bad(rep, "id.telemetry", "subset of [batt]");
    }
    if ((k = json_get(d, i, "tx_without_callsign")) >= 0) { if (json_is(d, k, J_BOOL)) cfg->id.tx_without_callsign = json_bool(d, k, false); else cfg_report_bad(rep, "id.tx_without_callsign", "bool"); }
}

static void apply_payload(fox_cfg_t *cfg, const fox_cfg_t *defaults, const json_doc *d, int pl, cfg_report_t *rep) {
    const char *kind = json_str(d, json_get(d, pl, "kind"));
    if (!kind || (strcmp(kind, "songs") && strcmp(kind, "sstv") && strcmp(kind, "none"))) { cfg_report_bad(rep, "payload.kind", "songs|sstv|none"); return; }
    int k;
    memset(&cfg->payload, 0, sizeof cfg->payload);
    if (!strcmp(kind, "songs")) {
        cfg->payload.kind = PAYLOAD_SONGS;
        cfg->payload.articulation = 0.875f;
        if ((k = json_get(d, pl, "articulation")) >= 0) { double a = json_num(d, k, -1); if (json_is_num(d, k) && a >= 0.5 && a <= 1.0) cfg->payload.articulation = (float)a; else cfg_report_bad(rep, "payload.articulation", "0.5-1.0"); }
        k = json_get(d, pl, "skip_on_low_battery");
        cfg->payload.skip_on_low_battery = k < 0 ? true : (json_is(d, k, J_BOOL) && json_bool(d, k, false));
        int list = json_get(d, pl, "playlist"), i = 0;
        for (int s = json_is(d, list, J_ARR) ? json_index(d, list, 0) : -1; s >= 0; s = d->nodes[s].next, i++) {
            if (cfg->payload.n_songs >= PLAYLIST_MAX) { cfg_report_bad(rep, "payload.playlist", "too many"); break; }
            if (song_from_json(d, s, &cfg->payload.songs[cfg->payload.n_songs])) cfg->payload.n_songs++;
            else { char key[32]; snprintf(key, sizeof key, "payload.playlist[%d]", i); cfg_report_bad(rep, key, "bad song"); }
        }
        if (!cfg->payload.n_songs) {
            cfg_report_bad(rep, "payload.playlist", "empty");
            if (defaults && defaults->payload.kind == PAYLOAD_SONGS) { memcpy(cfg->payload.songs, defaults->payload.songs, sizeof cfg->payload.songs); cfg->payload.n_songs = defaults->payload.n_songs; }
        }
    } else if (!strcmp(kind, "sstv")) {
        cfg->payload.kind = PAYLOAD_SSTV;
        const char *mode = json_str(d, json_get(d, pl, "mode"));
        if (json_get(d, pl, "mode") >= 0 && (!mode || strcmp(mode, "robot36-gray"))) cfg_report_bad(rep, "payload.mode", "robot36-gray only");
        const char *f = json_str(d, json_get(d, pl, "images_file"));
        scopy(cfg->payload.images_file, sizeof cfg->payload.images_file, f ? f : "images.bin");
        k = json_get(d, pl, "skip_on_low_battery");
        cfg->payload.skip_on_low_battery = k < 0 ? true : (json_is(d, k, J_BOOL) && json_bool(d, k, false));
    } else {
        cfg->payload.kind = PAYLOAD_NONE;
        k = json_get(d, pl, "dit_s");
        if (k < 0 || json_is_null(d, k)) cfg->payload.dit_set = false;
        else if (json_is_num(d, k) && json_num(d, k, 0) >= 0.05 && json_num(d, k, 0) <= 30) { cfg->payload.dit_s = (float)json_num(d, k, 0); cfg->payload.dit_set = true; }
        else { cfg_report_bad(rep, "payload.dit_s", "0.05-30"); cfg->payload.dit_set = false; }
        k = json_get(d, pl, "message");
        if (k >= 0 && json_is(d, k, J_STR)) { scopy(cfg->payload.message, sizeof cfg->payload.message, json_str(d, k)); cfg->payload.message_set = true; }
        else if (k >= 0 && !json_is_null(d, k)) cfg_report_bad(rep, "payload.message", "string or null");
    }
}

static int32_t ms_of(const json_doc *d, int s, const char *key, int32_t dflt, cfg_report_t *rep) {
    int k = json_get(d, s, key);
    if (k < 0) return dflt;
    double v = json_num(d, k, -1);
    if (json_is_int(d, k) && v >= 0 && v <= 86400000) return (int32_t)v;
    char kk[40]; snprintf(kk, sizeof kk, "schedule.%s", key); cfg_report_bad(rep, kk, "int ms");
    return dflt;
}

static void apply_schedule(fox_cfg_t *cfg, const json_doc *d, int s, cfg_report_t *rep) {
    const char *kind = json_str(d, json_get(d, s, "kind"));
    sched_cfg_t o; memset(&o, 0, sizeof o);
    if (kind && !strcmp(kind, "fixed")) { o.kind = SCHED_FIXED; o.delay_ms = ms_of(d, s, "delay_ms", 30000, rep); cfg->schedule = o; return; }
    if (!kind || (strcmp(kind, "popcorn") && strcmp(kind, "resurrection"))) { cfg_report_bad(rep, "schedule.kind", "fixed|popcorn|resurrection"); return; }
    int sk = json_get(d, s, "seed");
    if (json_is_int(d, sk) && json_num(d, sk, -1) >= 0 && json_num(d, sk, -1) < 2147483648.0) o.seed = (uint32_t)json_num(d, sk, 1); else { cfg_report_bad(rep, "schedule.seed", "int"); o.seed = 1; }
    if (!strcmp(kind, "popcorn")) {
        o.kind = SCHED_POPCORN;
        int cl = json_get(d, s, "cluster"); int v = json_int(d, cl, -1);
        if (json_is_int(d, cl) && v >= 1 && v <= 50) o.cluster = v; else { cfg_report_bad(rep, "schedule.cluster", "1-50"); o.cluster = 2; }
        o.cluster_gap_ms = ms_of(d, s, "cluster_gap_ms", 8000, rep);
        o.dark_min_ms = ms_of(d, s, "dark_min_ms", 10000, rep);
        o.dark_max_ms = ms_of(d, s, "dark_max_ms", 300000, rep);
        if (o.dark_min_ms > o.dark_max_ms) { cfg_report_bad(rep, "schedule.dark_min_ms", "min>max"); o.dark_min_ms = o.dark_max_ms; }
    } else {
        o.kind = SCHED_RESURRECTION;
        int ie = json_get(d, s, "id_every"); int v = json_int(d, ie, -1);
        if (json_is_int(d, ie) && v >= 1 && v <= 100) o.id_every = v; else { cfg_report_bad(rep, "schedule.id_every", "1-100"); o.id_every = 3; }
        o.delay_ms = ms_of(d, s, "delay_ms", 30000, rep);
        o.alive_min_ms = ms_of(d, s, "alive_min_ms", 1800000, rep);
        o.alive_max_ms = ms_of(d, s, "alive_max_ms", 3600000, rep);
        o.dead_ms = ms_of(d, s, "dead_ms", 3600000, rep);
        o.dit_min_ms = ms_of(d, s, "dit_min_ms", 180000, rep);
        o.dit_max_ms = ms_of(d, s, "dit_max_ms", 300000, rep);
        o.dead_song = json_bool(d, json_get(d, s, "dead_song"), false);
        if (o.alive_min_ms > o.alive_max_ms) { cfg_report_bad(rep, "schedule.alive_min_ms", "min>max"); o.alive_min_ms = o.alive_max_ms; }
        if (o.dit_min_ms > o.dit_max_ms) { cfg_report_bad(rep, "schedule.dit_min_ms", "min>max"); o.dit_min_ms = o.dit_max_ms; }
    }
    cfg->schedule = o;
}

static void apply_battery(fox_cfg_t *cfg, const fox_cfg_t *defaults, const json_doc *d, int b, cfg_report_t *rep) {
    struct { const char *k; float *p; float lo, hi; } F[] = {
        {"divider_ratio", &cfg->battery.divider_ratio, 1, 10}, {"calibration", &cfg->battery.calibration, 0.5f, 2},
        {"low_v", &cfg->battery.low_v, 2.5f, 4.5f}, {"critical_v", &cfg->battery.critical_v, 2.5f, 4.5f}, {"recovery_v", &cfg->battery.recovery_v, 2.5f, 4.5f} };
    for (unsigned i = 0; i < sizeof F / sizeof F[0]; i++) {
        int k = json_get(d, b, F[i].k); if (k < 0) continue;
        double v = json_num(d, k, -1);
        if (json_is_num(d, k) && v >= F[i].lo && v <= F[i].hi) *F[i].p = (float)v;
        else { char kk[32], rr[32]; snprintf(kk, sizeof kk, "battery.%s", F[i].k); snprintf(rr, sizeof rr, "%.3g-%.3g", (double)F[i].lo, (double)F[i].hi); cfg_report_bad(rep, kk, rr); }
    }
    int k = json_get(d, b, "samples");
    if (k >= 0) { int v = json_int(d, k, -1); if (json_is_int(d, k) && v >= 1 && v <= 64) cfg->battery.samples = v; else cfg_report_bad(rep, "battery.samples", "1-64"); }
    if (!(cfg->battery.critical_v < cfg->battery.recovery_v && cfg->battery.recovery_v <= cfg->battery.low_v)) {
        cfg_report_bad(rep, "battery", "critical<recovery<=low");
        if (defaults) { cfg->battery.low_v = defaults->battery.low_v; cfg->battery.critical_v = defaults->battery.critical_v; cfg->battery.recovery_v = defaults->battery.recovery_v; }
    }
}

static const char *TOP_KEYS[] = { "schema", "template", "board", "module", "pins", "radio", "plan", "id", "payload", "schedule", "battery", "limits", "fleet", NULL };

static void apply(fox_cfg_t *cfg, const fox_cfg_t *defaults, const json_doc *d, int root, cfg_report_t *rep) {
    int k;
    if ((k = json_get(d, root, "module")) >= 0) { const char *s = json_str(d, k); if (s) scopy(cfg->module, sizeof cfg->module, s); else cfg_report_bad(rep, "module", "string"); }
    if ((k = json_get(d, root, "radio")) >= 0 && json_is(d, k, J_OBJ)) apply_radio(cfg, d, k, rep);
    if ((k = json_get(d, root, "plan")) >= 0 && json_is(d, k, J_OBJ)) apply_plan(cfg, d, k, rep);
    /* frequencies outside the module ranges are dropped; none left is fatal */
    { int n = 0; for (int i = 0; i < cfg->plan.n; i++) if (cfg_freq_in_ranges(cfg, cfg->plan.frequencies_mhz[i])) cfg->plan.frequencies_mhz[n++] = cfg->plan.frequencies_mhz[i];
      if (n != cfg->plan.n) { cfg_report_bad(rep, "plan.frequencies_mhz", "out of module range"); cfg->plan.n = n; }
      if (!n) set_fatal(rep, "plan"); }
    if ((k = json_get(d, root, "id")) >= 0 && json_is(d, k, J_OBJ)) apply_id(cfg, d, k, rep);
    if ((k = json_get(d, root, "payload")) >= 0) { if (json_is(d, k, J_OBJ)) apply_payload(cfg, defaults, d, k, rep); else if (!json_is_null(d, k)) cfg_report_bad(rep, "payload", "object"); }
    if ((k = json_get(d, root, "schedule")) >= 0) { if (json_is(d, k, J_OBJ)) apply_schedule(cfg, d, k, rep); else if (!json_is_null(d, k)) cfg_report_bad(rep, "schedule", "object"); }
    if ((k = json_get(d, root, "battery")) >= 0 && json_is(d, k, J_OBJ)) apply_battery(cfg, defaults, d, k, rep);
    if ((k = json_get(d, root, "limits")) >= 0 && json_is(d, k, J_OBJ)) {
        int m = json_get(d, k, "max_keydown_s");
        if (m >= 0) {
            if (json_is_null(d, m)) cfg->limits.set = false;
            else if (json_is_num(d, m) && json_num(d, m, 0) >= 1 && json_num(d, m, 0) <= 7200) { cfg->limits.max_keydown_s = (float)json_num(d, m, 0); cfg->limits.set = true; }
            else cfg_report_bad(rep, "limits.max_keydown_s", "null or 1-7200");
        }
    }
    if (rep) {
        for (int m = json_index(d, root, 0); m >= 0; m = d->nodes[m].next) {
            const char *key = json_key(d, m); bool known = false;
            for (int i = 0; TOP_KEYS[i]; i++) if (!strcmp(TOP_KEYS[i], key)) known = true;
            if (!known) cfg_report_bad(rep, key, "unknown key");
        }
        if (rep->n_items && !strcmp(rep->mode, "ok")) strcpy(rep->mode, "partial");
    }
}

bool cfg_load_defaults(fox_cfg_t *cfg, const json_doc *d, int root) {
    memset(cfg, 0, sizeof *cfg);
    if (!json_is(d, root, J_OBJ)) return false;
    scopy(cfg->template_id, sizeof cfg->template_id, json_str(d, json_get(d, root, "template")));
    scopy(cfg->board, sizeof cfg->board, json_str(d, json_get(d, root, "board")));
    /* sane fallbacks before the document overrides them */
    strcpy(cfg->radio.family, "si5351fm");
    cfg->radio.ranges_mhz[0][0] = 144; cfg->radio.ranges_mhz[0][1] = 148; cfg->radio.n_ranges = 1;
    cfg->radio.bandwidth_khz = 12.5f; cfg->radio.itu_zone = 2; cfg->radio.id_deviation_hz = 5000; cfg->radio.audio_deviation_hz = 5000;
    cfg->radio.tone_shape = SHAPE_BRIGHT; cfg->radio.preemphasis = true; cfg->radio.sample_rate = 8000; cfg->radio.tx_while_mounted = true;
    cfg->plan.frequencies_mhz[0] = 146.565; cfg->plan.n = 1;
    strcpy(cfg->id.callmessage, "N0CALL DECOY DECOY N0CALL"); strcpy(cfg->id.placeholder, "N0CALL"); cfg->id.wpm = 12; cfg->id.tone_hz = 800;
    cfg->payload.kind = PAYLOAD_NONE;
    cfg->schedule.kind = SCHED_FIXED; cfg->schedule.delay_ms = 30000;
    cfg->battery.divider_ratio = 2; cfg->battery.calibration = 1; cfg->battery.low_v = 3.5f; cfg->battery.critical_v = 3.3f; cfg->battery.recovery_v = 3.4f; cfg->battery.samples = 16;
    apply(cfg, NULL, d, root, NULL);
    return cfg->template_id[0] && cfg->plan.n > 0;
}

void cfg_apply_user(fox_cfg_t *cfg, const fox_cfg_t *defaults, const json_doc *d, int root, const char *board_id, cfg_report_t *rep) {
    *cfg = *defaults;
    if (!json_is(d, root, J_OBJ)) return;    /* not an object: defaults, no complaint (matches foxlib) */
    int k;
    if ((k = json_get(d, root, "schema")) >= 0 && !(json_is_num(d, k) && json_num(d, k, 0) == CFG_SCHEMA)) { strcpy(rep->mode, "default(schema)"); return; }
    if ((k = json_get(d, root, "template")) >= 0) { const char *s = json_str(d, k); if (!s || strcmp(s, defaults->template_id)) { strcpy(rep->mode, "default(template)"); return; } }
    if ((k = json_get(d, root, "board")) >= 0 && board_id) { const char *s = json_str(d, k); if (!s || strcmp(s, board_id)) { strcpy(rep->mode, "default(board)"); return; } }
    apply(cfg, defaults, d, root, rep);
}
