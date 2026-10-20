/* SPDX-License-Identifier: GPL-3.0-or-later
 * fox.c -- see fox.h. Behaviour follows foxlib/cycle.py and the template bodies:
 *
 *   unconfigured (fatal config, or callsign unset without tx_without_callsign) -> hold 20 s, loop
 *   battery -> none on this board ('ok')
 *   dead phase (resurrection) -> 250 ms gap, dit or full ID (+ dead_song), wait, loop
 *   alive -> key, 750 ms gap, [ID | QRSS message], [750 ms gap, song], [750 ms gap, QSY x.xxx],
 *            unkey, retune if rotating, wait schedule.wait_ms(), loop
 *
 * The keyed section is rendered as one event stream and handed to core 1; the
 * keydown limit (limits.max_keydown_s) cuts it. SSTV payloads are not yet in this
 * firmware: a template that asks for them runs with the ID only and says so. */
#include "fox.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "builtin_defaults.h"
#include "console.h"
#include "fs.h"
#include "melody.h"
#include "morse.h"
#include "msc_disk.h"
#include "pico/time.h"
#include "pico/unique_id.h"
#include "player.h"
#include "schedule.h"
#include "si5351.h"

#define GAP_MS 750.0f
#define HOLD_UNCONFIGURED_MS 20000

static json_doc doc;                 /* one arena, reused for defaults then fox.json */
static char filebuf[12288];
static fox_cfg_t defaults, cfg;
static cfg_report_t report;
static bool have_cfg, id_ok, loaded_defaults_from_flash;
static char radio_status[24] = "skipped";
static sched_t sched;
static playlist_t playlist;
static events_t stream;
static play_req_t req;
static fox_state_t state = FOX_HOLD;
static uint32_t hold_until;
static bool hold_logged;
static int cycle_n, freq_index, next_index;
static bool rotating, bench_active;
static uint32_t cut_warned;
static char uid[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];

static uint32_t now_ms(void) { return to_ms_since_boot(get_absolute_time()); }

const fox_cfg_t *fox_cfg(void) { return &cfg; }
const cfg_report_t *fox_report(void) { return &report; }
bool fox_id_ok(void) { return id_ok; }
fox_state_t fox_state(void) { return state; }
const char *fox_radio_status(void) { return radio_status; }

/* ---- configuration */
static bool load(void) {
    cfg_report_init(&report);
    have_cfg = false;
    long n = fs_read("defaults.json", filebuf, sizeof filebuf);
    int root = -1;
    if (n >= 0) { root = json_parse(&doc, filebuf, (size_t)n); loaded_defaults_from_flash = true; }
    if (root < 0 || !cfg_load_defaults(&defaults, &doc, root)) {
        /* the drive's defaults.json is missing or broken: fall back to the compiled-in ones */
        loaded_defaults_from_flash = false;
        root = json_parse(&doc, (const char *)BUILTIN_DEFAULTS, BUILTIN_DEFAULTS_LEN);
        if (root < 0 || !cfg_load_defaults(&defaults, &doc, root)) { strcpy(report.fatal, "defaults"); return false; }
    }
    n = fs_read("fox.json", filebuf, sizeof filebuf);
    if (n < 0) { cfg = defaults; strcpy(report.mode, "default(missing)"); }
    else {
        root = json_parse(&doc, filebuf, (size_t)n);
        if (root < 0) { cfg = defaults; strcpy(report.mode, "default(parse)"); }
        else cfg_apply_user(&cfg, &defaults, &doc, root, BOARD_ID, &report);
    }
    have_cfg = true;
    id_ok = cfg_id_ok(&cfg);
    return true;
}

static void setup_radio(void) {
    player_status_t ps; player_status(&ps);
    if (!ps.si5351_ok) { strcpy(radio_status, "nosi5351"); return; }
    if (!have_cfg || report.fatal[0]) { strcpy(radio_status, "skipped"); return; }
    freq_index = 0; next_index = 0; rotating = cfg.plan.n > 1;
    /* the deviation must stay inside the band: 20 kHz margin from every range edge (the page checks the same) */
    for (int i = 0; i < cfg.plan.n; i++) {
        double f = cfg.plan.frequencies_mhz[i]; bool inside = false;
        for (int r = 0; r < cfg.radio.n_ranges; r++) if (f >= cfg.radio.ranges_mhz[r][0] + 0.02 && f <= cfg.radio.ranges_mhz[r][1] - 0.02) inside = true;
        if (!inside) { strcpy(radio_status, "band_edge"); return; }
    }
    if (!player_set_carrier(cfg.plan.frequencies_mhz[0] * 1e6)) { strcpy(radio_status, "retune_failed"); return; }
    if (ps.revision >= 3) player_set_attenuation(cfg.radio.attenuation);
    strcpy(radio_status, "ok");
}

const char *fox_banner_line(char *buf, int n) {
    char st[256], freqs[160] = "";
    if (have_cfg) { int o = 0; for (int i = 0; i < cfg.plan.n && o < (int)sizeof freqs - 12; i++) o += snprintf(freqs + o, sizeof freqs - (size_t)o, "%s%g", i ? "," : "", cfg.plan.frequencies_mhz[i]); }
    snprintf(buf, (size_t)n, "FOX template=%s/%s foxlib=c-%s board=%s uid=%s cfg=%s radio=%s id=%s freq=%s",
             have_cfg ? cfg.template_id : "?", FOXLIBC_VERSION, FOXLIBC_VERSION, BOARD_ID, uid,
             cfg_report_status(&report, st, sizeof st), radio_status, id_ok ? "set" : "unset", freqs[0] ? freqs : "none");
    return buf;
}

void fox_print_banner(void) {
    char line[400];
    con_puts("initializing system ... \r\n");
    con_printf("%s\r\n", fox_banner_line(line, sizeof line));
    for (int i = 0; i < report.n_items; i++) con_printf("  cfg: %s -> default (%s)\r\n", report.items[i].key, report.items[i].reason);
    if (report.fatal[0]) con_printf("** fatal: %s -- staying silent **\r\n", report.fatal);
    else if (!id_ok) con_printf("** callsign not set: %s **\r\n", cfg.id.tx_without_callsign ? "transmitting anyway (tx_without_callsign)" : "staying silent (id.tx_without_callsign=false)");
    if (have_cfg && cfg.payload.kind == PAYLOAD_SSTV) con_puts("** payload.sstv is not in this firmware yet: ID only **\r\n");
    if (!loaded_defaults_from_flash) con_puts("  defaults.json not usable: using the compiled-in morse-songs defaults\r\n");
}

/* ---- streams */
static void add_morse(const char *text, float dit_s) {
    con_printf("morse: %s\r\n", text);
    morse_events(&stream, text, cfg.id.wpm, (float)cfg.id.tone_hz, dit_s > 0 ? dit_s * 1000 : 0);
}

static void start_play(float dev_hz_id, uint32_t max_ms) {
    synth_params_default(&req.params);
    req.params.sample_rate = cfg.radio.sample_rate; req.params.shape = cfg.radio.tone_shape; req.params.preemphasis = cfg.radio.preemphasis;
    req.params.level = 1.0f;                               /* deviation is set through dev_counts */
    req.dev_counts = (int32_t)si5351_counts_for_deviation(dev_hz_id);   /* pure arithmetic on the current divider */
    req.ev = &stream;
    req.max_samples = max_ms ? (uint32_t)((uint64_t)max_ms * (uint64_t)cfg.radio.sample_rate / 1000) : 0;
    player_play(&req);
}

static uint32_t keydown_budget_ms(void) { return cfg.limits.set ? (uint32_t)(cfg.limits.max_keydown_s * 1000) : 0; }

static void hold(uint32_t ms) { state = FOX_HOLD; hold_until = now_ms() + ms; hold_logged = false; }

static bool configured(void) { return have_cfg && !report.fatal[0] && !strcmp(radio_status, "ok") && (id_ok || cfg.id.tx_without_callsign); }

static void begin_cycle(void) {
    uint32_t t = now_ms();
    events_clear(&stream);
    if (sched_phase(&sched, t) == PHASE_DEAD) {
        sched_wake_t kind = sched_dead_wake(&sched);
        events_push(&stream, 0, 250);
        if (kind == WAKE_ID) {
            add_morse(cfg.id.callmessage, 0);
            if (cfg.schedule.dead_song && cfg.payload.kind == PAYLOAD_SONGS && playlist.n) { events_push(&stream, 0, GAP_MS); const song_t *s = playlist_next(&playlist, &stream); con_printf("song: %s\r\n", s->name); }
        } else add_morse("e", 0);
        con_printf("dead-phase wake: %s\r\n", kind == WAKE_ID ? "id" : "dit");
        player_key(true);
        start_play((float)cfg.radio.id_deviation_hz, keydown_budget_ms());
        state = FOX_KEYED;
        return;
    }
    con_printf("cycle %d @ %.4f MHz\r\n", cycle_n, (double)cfg.plan.frequencies_mhz[freq_index]);
    next_index = rotating ? (freq_index + 1) % cfg.plan.n : freq_index;
    events_push(&stream, 0, GAP_MS);
    if (cfg.payload.kind == PAYLOAD_NONE) {
        add_morse(cfg.payload.message_set && cfg.payload.message[0] ? cfg.payload.message : cfg.id.callmessage, cfg.payload.dit_set ? cfg.payload.dit_s : 0);
    } else {
        add_morse(cfg.id.callmessage, 0);
        if (cfg.payload.kind == PAYLOAD_SONGS && playlist.n) { events_push(&stream, 0, GAP_MS); const song_t *s = playlist_next(&playlist, &stream); con_printf("song: %s\r\n", s->name); }
    }
    if (rotating && cfg.plan.announce_qsy) { char q[32]; snprintf(q, sizeof q, "QSY %.3f", (double)cfg.plan.frequencies_mhz[next_index]); events_push(&stream, 0, GAP_MS); add_morse(q, 0); }
    if (stream.overflow) con_puts("  (stream truncated: too many events)\r\n");
    player_key(true);
    start_play((float)cfg.radio.id_deviation_hz, keydown_budget_ms());
    state = FOX_KEYED;
}

static void end_cycle(void) {
    player_key(false);
    if (req.cut) con_puts("keydown limit reached; transmission cut\r\n");
    if (req.late) con_printf("  (player late on %lu samples)\r\n", (unsigned long)req.late);
    bool dead = sched.dead;
    if (!dead) {
        if (rotating) { freq_index = next_index; if (!player_set_carrier(cfg.plan.frequencies_mhz[freq_index] * 1e6)) con_printf("retune to %.4f failed\r\n", (double)cfg.plan.frequencies_mhz[freq_index]); }
        cycle_n++;
    }
    hold((uint32_t)sched_wait_ms(&sched, now_ms()));
}

void fox_poll(void) {
    uint32_t t = now_ms();
    switch (state) {
        case FOX_HOLD:
            if ((int32_t)(t - hold_until) < 0) return;
            if (!configured()) {
                if (!hold_logged) { con_printf("unconfigured (%s): silent\r\n", report.fatal[0] ? report.fatal : strcmp(radio_status, "ok") ? radio_status : "callsign unset"); hold_logged = true; }
                hold_until = t + HOLD_UNCONFIGURED_MS; return;
            }
            if (!cfg.radio.tx_while_mounted && msc_host_has_drive()) {
                if (!hold_logged) { con_puts("drive mounted by the host: not transmitting (radio.tx_while_mounted=false)\r\n"); hold_logged = true; }
                hold_until = t + 1000; return;
            }
            begin_cycle();
            return;
        case FOX_KEYED:
            if (req.done) end_cycle();
            return;
        case FOX_BENCH:
            if (req.done || !bench_active) { bench_active = false; player_key(false); con_puts("ok\r\n"); hold(1000); }
            return;
    }
}

/* ---- lifecycle */
void fox_init(void) {
    pico_get_unique_board_id_string(uid, sizeof uid);
    for (char *p = uid; *p; p++) if (*p >= 'A' && *p <= 'F') *p = (char)(*p - 'A' + 'a');
    if (!fs_mount(true)) con_printf("filesystem: %s\r\n", fs_error());
    else { int made = fs_seed(); if (made) con_printf("drive: created %d file(s)\r\n", made); }
    fox_reload(NULL);
}

void fox_reload(const char *why) {
    if (state == FOX_KEYED || state == FOX_BENCH) { player_stop(); player_key(false); }
    bench_active = false;
    if (why) { con_printf("reload: %s\r\n", why); fs_mount(false); }
    if (!load()) { have_cfg = false; }
    setup_radio();
    if (have_cfg) {
        sched_init(&sched, &cfg.schedule);
        if (cfg.payload.kind == PAYLOAD_SONGS) playlist_init(&playlist, cfg.payload.songs, cfg.payload.n_songs, cfg.payload.articulation);
        else playlist_init(&playlist, NULL, 0, 0.875f);
    }
    cycle_n = 0; cut_warned = 0;
    fox_print_banner();
    hold(0);
}

/* ---- bench */
static bool bench_begin(void) {
    if (!have_cfg || strcmp(radio_status, "ok")) { con_printf("err: radio %s\r\n", radio_status); return false; }
    if (state == FOX_KEYED || state == FOX_BENCH) { player_stop(); player_key(false); }
    bench_active = true; state = FOX_BENCH;
    return true;
}

bool fox_bench_key(uint32_t ms) {
    if (!bench_begin()) return false;
    events_clear(&stream); events_push(&stream, 0, (float)ms);
    player_key(true); start_play((float)cfg.radio.id_deviation_hz, 0);
    return true;
}

bool fox_bench_tone(float hz, uint32_t ms) {
    if (!bench_begin()) return false;
    events_clear(&stream); events_push(&stream, hz, (float)ms);
    player_key(true); start_play((float)cfg.radio.id_deviation_hz, 0);
    return true;
}

bool fox_bench_id(void) {
    if (!bench_begin()) return false;
    events_clear(&stream); events_push(&stream, 0, GAP_MS); add_morse(cfg.id.callmessage, 0);
    player_key(true); start_play((float)cfg.radio.id_deviation_hz, 0);
    return true;
}

bool fox_bench_freq(double mhz) {
    if (!have_cfg) return false;
    if (!cfg_freq_in_ranges(&cfg, mhz)) { con_puts("err: outside the module ranges\r\n"); return false; }
    if (state == FOX_KEYED || state == FOX_BENCH) { player_stop(); player_key(false); bench_active = false; }
    cfg.plan.frequencies_mhz[0] = mhz; cfg.plan.n = 1; rotating = false; freq_index = next_index = 0;
    bool ok = player_set_carrier(mhz * 1e6);
    strcpy(radio_status, ok ? "ok" : "retune_failed");
    hold(0);
    return ok;
}

void fox_bench_stop(void) {
    if (state == FOX_BENCH) con_puts("ok (stopped)\r\n");     /* the interrupted action's reply, so a waiting host is released */
    if (state == FOX_BENCH || state == FOX_KEYED) { player_stop(); player_key(false); }
    bench_active = false; hold(500);
}
