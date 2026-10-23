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
#include "sstv.h"

#define GAP_MS 750.0f
#define HOLD_UNCONFIGURED_MS 20000

static json_doc doc;                 /* one arena, reused for defaults then fox.json */
static char filebuf[24576];   /* fox.json / defaults.json as read from the drive; js/model/foxlibc-limits.js FILE_MAX_BYTES = this - 1 */
static fox_cfg_t defaults, cfg;
static cfg_report_t report;
static bool have_cfg, id_ok, loaded_defaults_from_flash;
static char radio_status[24] = "skipped";
static sched_t sched;
static playlist_t playlist;
static events_t stream, stream2;     /* the keyed section before and after a streamed (SSTV) segment */
static play_req_t req;
/* A keyed section is up to three segments played back to back on one carrier: [events][sstv image][events]. */
typedef struct { enum { SEG_NONE, SEG_EVENTS, SEG_SSTV } kind; events_t *ev; } segment_t;
static segment_t segs[3]; static int seg_n, seg_i; static uint32_t keyed_budget_ms, keyed_start_ms;
/* SSTV: the images.bin index and the pixels of the image being sent */
#define IMG_MAX_BYTES (SSTV_PIXELS_PER_LINE * SSTV_LINES * 2)
static sstv_entry_t images[SSTV_MAX_IMAGES]; static int img_n, img_i;
static uint8_t img_px[IMG_MAX_BYTES]; static int img_w, img_h;
static sstv_gen_t sstv_gen;
static fox_state_t state = FOX_HOLD;
static uint32_t hold_until;
static bool hold_logged;
static int cycle_n, freq_index, next_index;
static bool rotating, bench_active, cycle_restart;
static uint32_t cut_warned;
static char uid[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];

static uint32_t now_ms(void) { return to_ms_since_boot(get_absolute_time()); }   /* 32-bit: only ever used in wrap-safe differences */
static int64_t now_ms64(void) { return (int64_t)(time_us_64() / 1000); }          /* for the scheduler's absolute `until`: wraps in 292 million years, not 49.7 days */

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
    else if (n >= (long)sizeof filebuf - 1) { cfg = defaults; strcpy(report.mode, "default(too_large)"); con_printf("fox.json: longer than %u bytes, not read\r\n", (unsigned)(sizeof filebuf - 1)); }
    else {
        root = json_parse(&doc, filebuf, (size_t)n);
        if (root < 0) {
            cfg = defaults;
            /* too many values for the parser's pool is a size problem, not a syntax one: say so, the page checks the same limit */
            bool pool = doc.err && strstr(doc.err, "too many");
            strcpy(report.mode, pool ? "default(too_large)" : "default(parse)");
            con_printf("fox.json: %s at byte %d\r\n", doc.err ? doc.err : "parse error", doc.err_pos);
        }
        else cfg_apply_user(&cfg, &defaults, &doc, root, BOARD_ID, &report);
    }
    have_cfg = true;
    id_ok = cfg_id_ok(&cfg);
    return true;
}

/* the deviation must stay inside the band: 20 kHz margin from every range edge (the page checks the same) */
static bool freq_allowed(double f) {
    for (int r = 0; r < cfg.radio.n_ranges; r++) if (f >= cfg.radio.ranges_mhz[r][0] + 0.02 && f <= cfg.radio.ranges_mhz[r][1] - 0.02) return true;
    return false;
}

static void setup_radio(void) {
    player_status_t ps; player_status(&ps);
    if (!ps.core1_alive) { strcpy(radio_status, "core1_dead"); return; }
    if (!ps.si5351_ok && player_reprobe()) { player_status(&ps); con_puts("si5351: answers now (was absent at boot)\r\n"); }   /* F14 */
    if (!ps.si5351_ok) { strcpy(radio_status, "nosi5351"); return; }
    if (!have_cfg || report.fatal[0]) { strcpy(radio_status, "skipped"); return; }
    freq_index = 0; next_index = 0; rotating = cfg.plan.n > 1;
    for (int i = 0; i < cfg.plan.n; i++) if (!freq_allowed(cfg.plan.frequencies_mhz[i])) { strcpy(radio_status, "band_edge"); return; }
    player_set_correction_ppm(cfg.radio.correction_ppm);
    if (!player_set_carrier(cfg.plan.frequencies_mhz[0] * 1e6)) { strcpy(radio_status, "retune_failed"); return; }
    if (ps.revision >= 3 && !player_set_attenuation(cfg.radio.attenuation)) con_puts("attenuator: not set (core 1 refused)\r\n");
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
    con_puts(fox_banner_line(line, sizeof line)); con_puts("\r\n");   /* not con_printf: its buffer is shorter than a long banner */
    for (int i = 0; i < report.n_items; i++) con_printf("  cfg: %s -> default (%s)\r\n", report.items[i].key, report.items[i].reason);
    if (report.fatal[0]) con_printf("** fatal: %s -- staying silent **\r\n", report.fatal);
    else if (!id_ok) con_printf("** callsign not set: %s **\r\n", cfg.id.tx_without_callsign ? "transmitting anyway (tx_without_callsign)" : "staying silent (id.tx_without_callsign=false)");
    if (!loaded_defaults_from_flash) con_puts("  defaults.json not usable: using the compiled-in morse-songs defaults\r\n");
}

/* ---- streams */
/* The ID as sent: callmessage, plus the telemetry words this board can supply. The PicoFox has no
 * battery voltage (id.telemetry "batt" is ignored); "chg" adds the word CHG while the charger is
 * active — on USB power with a battery still filling. Off USB it never appears. */
static const char *id_message(void) {
    static char buf[80];
    snprintf(buf, sizeof buf, "%s%s", cfg.id.callmessage, (cfg.id.telemetry_chg && player_charging()) ? " CHG" : "");
    return buf;
}

static void add_morse(const char *text, float dit_s) {
    con_printf("morse: %s\r\n", text);
    morse_events(&stream, text, cfg.id.wpm, (float)cfg.id.tone_hz, dit_s > 0 ? dit_s * 1000 : 0);
}

static void start_play(float dev_hz_id, uint32_t max_ms) {
    synth_params_default(&req.params);
    req.params.sample_rate = cfg.radio.sample_rate; req.params.shape = cfg.radio.tone_shape; req.params.preemphasis = cfg.radio.preemphasis;
    req.params.level = 1.0f;                               /* deviation is set through dev_counts */
    req.dev_counts = (int32_t)si5351_counts_for_deviation(dev_hz_id);   /* pure arithmetic on the current divider */
    req.ev = &stream; req.src = NULL; req.src_ctx = NULL;
    req.max_samples = max_ms ? (uint32_t)((uint64_t)max_ms * (uint64_t)cfg.radio.sample_rate / 1000) : 0;
    player_play(&req);
}

static uint32_t keydown_budget_ms(void);

/* ---- SSTV images (payload.sstv): index read at reload, one image's pixels loaded per cycle */
static long img_read(void *ctx, uint32_t off, void *buf, uint32_t n) { (void)ctx; return fs_read_at(cfg.payload.images_file, off, buf, n); }
static void load_images(void) {
    img_n = sstv_index(img_read, NULL, images, SSTV_MAX_IMAGES); img_i = 0;
    int kept = 0;
    for (int i = 0; i < img_n; i++) { if (images[i].w * images[i].h <= IMG_MAX_BYTES) images[kept++] = images[i]; else con_printf("  %s: image %s is %dx%d, larger than this firmware holds (%d px); skipped\r\n", cfg.payload.images_file, images[i].name, images[i].w, images[i].h, IMG_MAX_BYTES); }
    img_n = kept;
    if (!img_n) con_printf("  %s: no images — the test card will be sent\r\n", cfg.payload.images_file);
}
/* Load the next image into img_px (or the test card); returns its name. */
static const char *next_image(void) {
    if (!img_n) { img_w = SSTV_PIXELS_PER_LINE; img_h = SSTV_LINES; sstv_test_card(img_px, img_w, img_h); return "test_card"; }
    sstv_entry_t *e = &images[img_i]; img_i = (img_i + 1) % img_n;
    long got = fs_read_at(cfg.payload.images_file, e->offset, img_px, (size_t)(e->w * e->h));
    if (got != e->w * e->h) { con_printf("  %s: could not read image %s; test card instead\r\n", cfg.payload.images_file, e->name); img_w = SSTV_PIXELS_PER_LINE; img_h = SSTV_LINES; sstv_test_card(img_px, img_w, img_h); return "test_card"; }
    img_w = e->w; img_h = e->h;
    return e->name;
}
static bool sstv_src(void *ctx, event_t *out) { return sstv_next((sstv_gen_t *)ctx, out); }

/* ---- segments: start the next one on the keyed carrier; false when the section is finished */
static bool start_segment(void) {
    while (seg_i < seg_n) {
        segment_t *sg = &segs[seg_i++];
        uint32_t budget = 0;
        if (keyed_budget_ms) { uint32_t used = now_ms() - keyed_start_ms; if (used >= keyed_budget_ms) { req.cut = true; return false; } budget = keyed_budget_ms - used; }
        if (sg->kind == SEG_EVENTS) {
            if (!sg->ev->n) continue;
            req.ev = sg->ev; req.src = NULL;
            synth_params_default(&req.params);
            req.params.sample_rate = cfg.radio.sample_rate; req.params.shape = cfg.radio.tone_shape; req.params.preemphasis = cfg.radio.preemphasis; req.params.level = 1.0f;
            req.dev_counts = (int32_t)si5351_counts_for_deviation((float)cfg.radio.id_deviation_hz);
        } else {
            /* SSTV: pure tones, flat deviation (decoders measure frequency), the audio deviation */
            sstv_init(&sstv_gen, img_px, img_w, img_h);
            req.ev = NULL; req.src = sstv_src; req.src_ctx = &sstv_gen; req.f_top = 0; req.total_ms = sstv_duration_ms();
            synth_params_default(&req.params);
            req.params.sample_rate = cfg.radio.sample_rate; req.params.shape = SHAPE_SINE; req.params.preemphasis = false; req.params.level = 1.0f;
            req.dev_counts = (int32_t)si5351_counts_for_deviation((float)cfg.radio.audio_deviation_hz);
        }
        req.max_samples = budget ? (uint32_t)((uint64_t)budget * (uint64_t)cfg.radio.sample_rate / 1000) : 0;
        player_play(&req);
        return true;
    }
    return false;
}
static void begin_section(void) {
    seg_i = 0; keyed_budget_ms = keydown_budget_ms(); req.cut = false; req.late = 0;
    player_key(true); keyed_start_ms = now_ms();
    state = FOX_KEYED;
    if (!start_segment()) req.done = true;
}
static void add_morse2(events_t *ev, const char *text, float dit_s) {
    con_printf("morse: %s\r\n", text);
    morse_events(ev, text, cfg.id.wpm, (float)cfg.id.tone_hz, dit_s > 0 ? dit_s * 1000 : 0);
}

static uint32_t keydown_budget_ms(void) { return cfg.limits.set ? (uint32_t)(cfg.limits.max_keydown_s * 1000) : 0; }

static void hold(uint32_t ms) { state = FOX_HOLD; hold_until = now_ms() + ms; hold_logged = false; }

static bool configured(void) { return have_cfg && !report.fatal[0] && !strcmp(radio_status, "ok") && (id_ok || cfg.id.tx_without_callsign); }

static void begin_cycle(void) {
    events_clear(&stream);
    if (sched_phase(&sched, now_ms64()) == PHASE_DEAD) {
        sched_wake_t kind = sched_dead_wake(&sched);
        events_push(&stream, 0, 250);
        if (kind == WAKE_ID) {
            add_morse(id_message(), 0);
            if (cfg.schedule.dead_song && cfg.payload.kind == PAYLOAD_SONGS && playlist.n) { events_push(&stream, 0, GAP_MS); const song_t *s = playlist_next(&playlist, &stream); con_printf("song: %s\r\n", s->name); }
        } else add_morse("e", 0);
        con_printf("dead-phase wake: %s\r\n", kind == WAKE_ID ? "id" : "dit");
        segs[0] = (segment_t){ SEG_EVENTS, &stream }; seg_n = 1;
        begin_section();
        return;
    }
    con_printf("cycle %d%s @ %.4f MHz\r\n", cycle_n, cycle_restart ? " (restarted after a bench action)" : "", (double)cfg.plan.frequencies_mhz[freq_index]);
    cycle_restart = false;
    next_index = rotating ? (freq_index + 1) % cfg.plan.n : freq_index;
    events_clear(&stream2); seg_n = 0;
    events_t *tail = &stream;            /* where events after the payload go */
    events_push(&stream, 0, GAP_MS);
    if (cfg.payload.kind == PAYLOAD_NONE) {
        add_morse(cfg.payload.message_set && cfg.payload.message[0] ? cfg.payload.message : id_message(), cfg.payload.dit_set ? cfg.payload.dit_s : 0);
        segs[seg_n++] = (segment_t){ SEG_EVENTS, &stream };
    } else {
        add_morse(id_message(), 0);
        if (cfg.payload.kind == PAYLOAD_SONGS && playlist.n) { events_push(&stream, 0, GAP_MS); const song_t *s = playlist_next(&playlist, &stream); con_printf("song: %s\r\n", s->name); }
        segs[seg_n++] = (segment_t){ SEG_EVENTS, &stream };
        if (cfg.payload.kind == PAYLOAD_SSTV) {
            events_push(&stream, 0, GAP_MS);
            const char *name = next_image(); con_printf("sstv: %s (%dx%d)\r\n", name, img_w, img_h);
            segs[seg_n++] = (segment_t){ SEG_SSTV, NULL };
            tail = &stream2;
        }
    }
    if (rotating && cfg.plan.announce_qsy) { char q[32]; snprintf(q, sizeof q, "QSY %.3f", (double)cfg.plan.frequencies_mhz[next_index]); events_push(tail, 0, GAP_MS); add_morse2(tail, q, 0); if (tail == &stream2) segs[seg_n++] = (segment_t){ SEG_EVENTS, &stream2 }; }
    if (stream.overflow || stream2.overflow) con_puts("  (stream truncated: too many events)\r\n");
    begin_section();
}

static void end_cycle(void) {
    player_key(false);
    if (req.cut) con_puts("keydown limit reached; transmission cut\r\n");
    /* one or two late samples per transmission are the console's own doing (a long reply on core 0 delays core 1's
     * next 125 us sample once) and not worth a line; more than that means a flash write or a stall and is */
    if (req.late > 2) con_printf("  (player late on %lu samples)\r\n", (unsigned long)req.late);
    bool dead = sched.dead;
    if (!dead) {
        if (rotating) { freq_index = next_index; if (!player_set_carrier(cfg.plan.frequencies_mhz[freq_index] * 1e6)) con_printf("retune to %.4f failed\r\n", (double)cfg.plan.frequencies_mhz[freq_index]); }
        cycle_n++;
    }
    hold((uint32_t)sched_wait_ms(&sched, now_ms64()));
}

/* Wall-clock keydown guard, independent of core 1. The cycle's budget is enforced by the player in
 * samples; flash writes park the player and a bus that starts timing out stretches every sample, so
 * the clock can run well past the budget while the sample count says otherwise. Here core 0 unkeys on
 * the clock -- and if core 1 is gone, without it. */
#define KEYDOWN_GRACE_MS 2000
#define KEYDOWN_HARD_CAP_MS (10u * 60u * 1000u)     /* no limits block in the cfg: still never longer than this */
static uint32_t bench_limit_ms;
static void keydown_guard(void) {
    uint32_t keyed = player_keyed_ms();
    bool lost = !player_alive();
    if (!keyed && !lost) return;
    uint32_t limit = state == FOX_BENCH ? bench_limit_ms : keyed_budget_ms ? keyed_budget_ms : KEYDOWN_HARD_CAP_MS;
    if (!lost && keyed <= limit + KEYDOWN_GRACE_MS) return;
    if (lost) { if (strcmp(radio_status, "core1_dead")) { strcpy(radio_status, "core1_dead"); con_puts("core 1 stopped answering: amplifier forced off; reboot (watchdog) to recover\r\n"); } }
    else con_printf("keydown guard: keyed %lu ms against a limit of %lu ms: unkeying\r\n", (unsigned long)keyed, (unsigned long)limit);
    player_stop(); player_key(false); player_emergency_unkey();
    req.cut = true; req.done = true;
    if (state == FOX_BENCH) { bench_active = false; con_puts("ok (stopped)\r\n"); hold(1000); }
    else if (state == FOX_KEYED) end_cycle();
    else hold(1000);
}

void fox_poll(void) {
    uint32_t t = now_ms();
    keydown_guard();
    switch (state) {
        case FOX_HOLD:
            if ((int32_t)(t - hold_until) < 0) return;
            if (!configured()) {
                if (!hold_logged) { con_printf("unconfigured (%s): silent\r\n", report.fatal[0] ? report.fatal : strcmp(radio_status, "ok") ? radio_status : "callsign unset"); hold_logged = true; }
                /* F14: a synthesiser that was not answering is asked again at every hold — a fox in the field with a slow
                 * reference comes up on its own instead of staying silent until a power cycle */
                if (!strcmp(radio_status, "nosi5351")) { setup_radio(); if (configured()) { fox_print_banner(); hold(0); return; } }
                hold_until = t + HOLD_UNCONFIGURED_MS; return;
            }
            if (!cfg.radio.tx_while_mounted && msc_host_has_drive()) {
                if (!hold_logged) { con_puts("drive mounted by the host: not transmitting (radio.tx_while_mounted=false)\r\n"); hold_logged = true; }
                hold_until = t + 1000; return;
            }
            begin_cycle();
            return;
        case FOX_KEYED:
            if (req.done && (req.cut || !start_segment())) end_cycle();   /* cut, or no segment left: unkey; else the next segment on the same carrier */
            return;
        case FOX_BENCH:
            if (req.done || !bench_active) { bench_active = false; player_key(false); con_puts("ok\r\n"); cycle_restart = true; hold(1000); }
            return;
    }
}

/* ---- lifecycle */
void fox_init(void) {
    pico_get_unique_board_id_string(uid, sizeof uid);
    for (char *p = uid; *p; p++) if (*p >= 'A' && *p <= 'F') *p = (char)(*p - 'A' + 'a');
    if (!fs_mount(true)) con_printf("filesystem: %s\r\n", fs_error());
    else {
        char bj[160]; snprintf(bj, sizeof bj, "{\"board\": \"%s\", \"uid\": \"%s\", \"foxlib\": \"c-%s\"}\n", BOARD_ID, uid, FOXLIBC_VERSION);
        int made = fs_seed(bj); if (made) con_printf("drive: wrote %d file(s)\r\n", made);
    }
    fox_reload(NULL);
}

/* A cheap signature of what configures the fox on the drive: the operating system writes its own files
 * (.DS_Store, System Volume Information, .fseventsd) and those must not restart a cycle or re-seed the schedule. */
static uint32_t files_signature(void) {
    uint32_t h = 2166136261u;
    const char *names[] = { "fox.json", "defaults.json" };
    for (int i = 0; i < 2; i++) {
        long n = fs_read(names[i], filebuf, sizeof filebuf);
        for (long k = 0; k < n; k++) { h ^= (uint8_t)filebuf[k]; h *= 16777619u; }
        h ^= (uint32_t)n; h *= 16777619u;
    }
    long img = fs_size(have_cfg && cfg.payload.kind == PAYLOAD_SSTV ? cfg.payload.images_file : "images.bin");
    h ^= (uint32_t)img; h *= 16777619u;
    return h;
}
static uint32_t last_signature;

/* The host wrote the drive and the writes have settled: reload only if what we read actually changed. */
void fox_drive_changed(void) {
    fs_mount(false);
    uint32_t sig = files_signature();
    if (sig == last_signature) { con_puts("drive changed: fox.json, defaults.json and the images are as before; not reloading\r\n"); return; }
    fox_reload("drive changed");
}

void fox_reload(const char *why) {
    if (state == FOX_BENCH) con_puts("ok (stopped)\r\n");       /* F15: the interrupted bench action's reply, so a waiting host is released */
    if (state == FOX_KEYED || state == FOX_BENCH) { player_stop(); player_key(false); }
    bench_active = false;
    if (why) { con_printf("reload: %s\r\n", why); fs_mount(false); }
    if (!load()) { have_cfg = false; }
    setup_radio();
    if (have_cfg) {
        sched_init(&sched, &cfg.schedule);
        if (cfg.payload.kind == PAYLOAD_SONGS) playlist_init(&playlist, cfg.payload.songs, cfg.payload.n_songs, cfg.payload.articulation);
        else playlist_init(&playlist, NULL, 0, 0.875f);
        img_n = 0;
        if (cfg.payload.kind == PAYLOAD_SSTV) load_images();
    }
    cycle_n = 0; cut_warned = 0;
    last_signature = files_signature();
    fox_print_banner();
    hold(0);
}

/* ---- bench */
static bool bench_begin(void) {
    if (!have_cfg || strcmp(radio_status, "ok")) { con_printf("err: radio %s\r\n", radio_status); return false; }
    if (!id_ok && !cfg.id.tx_without_callsign) { con_puts("err: callsign unset (id.callmessage; the cycle is silent for the same reason)\r\n"); return false; }   /* F15: bench actions obey the same gate as the cycle */
    if (state == FOX_KEYED || state == FOX_BENCH) { player_stop(); player_key(false); }
    bench_active = true; state = FOX_BENCH;
    return true;
}

bool fox_bench_key(uint32_t ms) {
    if (!bench_begin()) return false;
    bench_limit_ms = ms;
    events_clear(&stream); events_push(&stream, 0, (float)ms);
    player_key(true); start_play((float)cfg.radio.id_deviation_hz, 0);
    return true;
}

bool fox_bench_tone(float hz, uint32_t ms) {
    if (!bench_begin()) return false;
    bench_limit_ms = ms;
    events_clear(&stream); events_push(&stream, hz, (float)ms);
    player_key(true); start_play((float)cfg.radio.id_deviation_hz, 0);
    return true;
}

bool fox_bench_id(void) {
    if (!bench_begin()) return false;
    events_clear(&stream); events_push(&stream, 0, GAP_MS); add_morse(id_message(), 0);
    bench_limit_ms = (uint32_t)events_ms(&stream) + 1000;
    player_key(true); start_play((float)cfg.radio.id_deviation_hz, 0);
    return true;
}

bool fox_bench_freq(double mhz) {
    if (!have_cfg) return false;
    if (!freq_allowed(mhz)) { con_puts("err: outside the module ranges (20 kHz band-edge margin, as the cycle applies)\r\n"); return false; }
    if (state == FOX_KEYED || state == FOX_BENCH) { player_stop(); player_key(false); bench_active = false; }
    cfg.plan.frequencies_mhz[0] = mhz; cfg.plan.n = 1; rotating = false; freq_index = next_index = 0;
    bool ok = player_set_carrier(mhz * 1e6);
    strcpy(radio_status, ok ? "ok" : "retune_failed");
    hold(0);
    return ok;
}

/* `atten` from the console: core 1 refuses a register write mid-stream, so stop whatever is on the air, set it, and let
 * the cycle restart — the same shape as `freq`. The value sticks until the next reload (fox.json's wins then). */
bool fox_bench_atten(int code) {
    if (!have_cfg) return false;
    if (state == FOX_KEYED || state == FOX_BENCH) { if (state == FOX_BENCH) con_puts("ok (stopped)\r\n"); player_stop(); player_key(false); bench_active = false; }
    if (!player_set_attenuation(code)) return false;
    cfg.radio.attenuation = code; cycle_restart = true; hold(0);
    return true;
}

void fox_bench_stop(void) {
    if (state == FOX_BENCH) con_puts("ok (stopped)\r\n");     /* the interrupted action's reply, so a waiting host is released */
    if (state == FOX_BENCH || state == FOX_KEYED) { player_stop(); player_key(false); }
    bench_active = false; hold(500);
}

/* Before a reset of any kind (reboot, bootsel, the 1200-baud touch): off the air first. A reset does
 * not touch the Si5351 or the amplifier enable, so whatever is keyed now would stay keyed in the
 * bootloader. */
void fox_quiesce(void) {
    if (state == FOX_BENCH || state == FOX_KEYED) { player_stop(); player_key(false); }
    player_key(false); player_emergency_unkey();
    bench_active = false; hold(60000);
}
