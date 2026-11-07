/* SPDX-License-Identifier: GPL-3.0-or-later
 * player_sim: the real picofox/player.c (core 1: mailbox, FM sample pump, keying, attenuator, bus hold) and the
 * real si5351.c, on the host. Core 1 is a pthread; time is the simulator's virtual clock, advanced only by the
 * firmware's own spin-waits and busy-waits, so a run is deterministic and "125 µs per sample" is exact.
 *
 * The "hardware" records every amplifier-enable edge (keying) and every FM offset the Si5351 was given, each on the
 * virtual clock, and prints them as JSON. player_test.py drives the scenarios and judges them:
 *
 *   player_sim morse <wpm> <tone_hz> <text...>        key, play the Morse events, unkey; dump
 *   player_sim two                                     two plays back to back on one key-down
 *   player_sim stop <after_ms>                         core 0 stops a long play after N ms of it
 *   player_sim cut <max_ms>                            max_samples cuts a play (the keydown budget)
 *   player_sim empty                                   an empty event list: done at once, nothing on the bus
 *   player_sim hold <at_ms> <for_ms>                   core 0 parks the loop mid-stream (a flash write) and releases
 *   player_sim atten <code>                            rev 3 attenuator word (refused mid-stream)
 *   player_sim dead                                    core 1 stops answering: core 0 unkeys by itself
 */
#include <pthread.h>
#include <sched.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "morse.h"
#include "player.h"
#include "si5351.h"
#include "synth.h"

const char *__asan_default_options(void) { return "detect_leaks=0"; }

/* ---- the virtual clock, shared by both "cores". Core 1 is the only thread that advances it while it runs: its
 * sample pump busy-waits from one deadline to the next, and its idle loop ticks 1 µs per poll, so the timing the
 * FM-write log records is core 1's alone and does not depend on how the host schedules the two threads (core 0
 * ticking as well would push core 1's deadlines past it whenever the OS held the thread, and show up as `late`).
 * Core 0's spin-waits yield instead, and advance the clock only before core 1 is launched or once it is frozen:
 * the "dead" scenario parks core 1 in sim_tick, which is what a hung core looks like from core 0 -- time passes,
 * no acknowledgement. */
uint64_t sim_now_us;
static pthread_mutex_t clk = PTHREAD_MUTEX_INITIALIZER;
static pthread_t core1_tid; static volatile int core1_launched, core1_frozen, core1_parked;
void sim_spin(void) {}
void sim_tick(uint64_t us) {
    bool me1 = core1_launched && pthread_equal(pthread_self(), core1_tid);
    if (me1 && core1_frozen) { core1_parked = 1; for (;;) pause(); }
    if (!me1 && core1_launched && !core1_parked) { sched_yield(); return; }   /* core 1 is the clock */
    pthread_mutex_lock(&clk); sim_now_us += us; pthread_mutex_unlock(&clk);
}
static void freeze_core1(void) { core1_frozen = 1; while (!core1_parked) sched_yield(); }   /* takes effect before it returns */
static void tick(uint64_t us) { sim_tick(us); }

/* ---- records */
#define MAXREC 200000
static struct { uint64_t t; int on; } key_rec[64]; static int n_key;
static struct { uint64_t t; int32_t counts; } fm_rec[MAXREC]; static int n_fm;
static struct { uint64_t t; int pin, v; } pin_rec[4096]; static int n_pin;
static int rev_id0 = 1;   /* ID0 high = rev 3 */
static int atten_bits[64]; static int n_atten_bits, atten_le_pulses;
static int sda_shadow = 1, scl_shadow = 1;

void sim_gpio_put(uint pin, int v) {
    if (pin == PICOFOX_PIN_AMP_EN) { int on = v == 0; if (!n_key || key_rec[n_key - 1].on != on) { if (n_key < 64) { key_rec[n_key].t = sim_now_us; key_rec[n_key].on = on; n_key++; } } }
    else if (pin == PICOFOX_PIN_SCL) { if (v && !scl_shadow && n_atten_bits < 64) atten_bits[n_atten_bits++] = sda_shadow; scl_shadow = v; }   /* data latched on the rising edge */
    else if (pin == PICOFOX_PIN_SDA) sda_shadow = v;
    else if (pin == PICOFOX_PIN_ATTN_LE) { static int le; if (v && !le) atten_le_pulses++; le = v; }
    if (n_pin < 4096) { pin_rec[n_pin].t = sim_now_us; pin_rec[n_pin].pin = (int)pin; pin_rec[n_pin].v = v; n_pin++; }
}
bool sim_gpio_get(uint pin) { if (pin == PICOFOX_PIN_ID0) return rev_id0; if (pin == PICOFOX_PIN_CHG_SENSE) return true; if (pin == PICOFOX_PIN_SDA) return true; return false; }

/* ---- the I2C fake: a register image; a write to 28..33 (or 26..33) is an FM offset, decoded back to counts */
static i2c_hw_t hw0; static i2c_inst_t inst0 = { &hw0, false }; i2c_inst_t *i2c0 = &inst0;
static uint8_t regs[256]; static unsigned char last_reg; static int writes;
static uint32_t base_a, base_b; static int base_known;
static void decode(const uint8_t *r, uint32_t *a, uint32_t *b) {
    /* registers 26..33: P3[15:8] P3[7:0] P1[17:16] P1[15:8] P1[7:0] (P3[19:16]|P2[19:16]) P2[15:8] P2[7:0]; C fixed */
    uint32_t p3 = ((r[0] << 8) | r[1]) | ((r[5] & 0xF0) << 12), p1 = ((r[2] & 3) << 16) | (r[3] << 8) | r[4], p2 = ((r[5] & 0x0F) << 16) | (r[6] << 8) | r[7];
    /* P1 = 128a + floor(128 b/c) - 512 ; P2 = 128 b - c floor(128 b/c) ; P3 = c  =>  128 b = P2 + c*floor = P2 + c*(P1 + 512 - 128 a) */
    uint32_t c = p3; uint32_t fl = (p1 + 512) / 128; (void)fl;
    /* a from P1: a = (P1 + 512 - floor(128b/c)) / 128 with 0 <= floor < 128 */
    uint32_t q = (p1 + 512) % 128; uint32_t aa = (p1 + 512) / 128;   /* q = floor(128b/c) */
    *a = aa; *b = (p2 + c * q) / 128;
}
int i2c_write_timeout_us(i2c_inst_t *i2c, uint8_t addr, const uint8_t *src, size_t len, bool nostop, uint32_t timeout_us) {
    (void)i2c; (void)nostop; (void)timeout_us; if (addr != 0x60) return -1;
    writes++;
    if (len >= 2) { for (size_t i = 1; i < len; i++) regs[(src[0] + i - 1) & 0xFF] = src[i]; last_reg = src[0]; }
    else { last_reg = src[0]; return (int)len; }
    if (src[0] == 26 && len == 9) { decode(regs + 26, &base_a, &base_b); base_known = 1; if (n_fm < MAXREC) { fm_rec[n_fm].t = sim_now_us; fm_rec[n_fm].counts = 0; n_fm++; } }
    else if (src[0] == 28 && len == 7 && base_known) {
        uint32_t a, b; decode(regs + 26, &a, &b);
        int64_t counts = ((int64_t)a - base_a) * 1048575 + ((int64_t)b - base_b);   /* C_DEN = 1048575 in si5351.c */
        if (n_fm < MAXREC) { fm_rec[n_fm].t = sim_now_us; fm_rec[n_fm].counts = (int32_t)counts; n_fm++; }
    }
    return (int)len;
}
int i2c_read_timeout_us(i2c_inst_t *i2c, uint8_t addr, uint8_t *dst, size_t len, bool nostop, uint32_t timeout_us) {
    (void)i2c; (void)nostop; (void)timeout_us; if (addr != 0x60) return -1;
    for (size_t i = 0; i < len; i++) dst[i] = regs[(last_reg + i) & 0xFF];
    return (int)len;
}
uint i2c_init(i2c_inst_t *i2c, uint baud) { (void)i2c; return baud; }
void i2c_deinit(i2c_inst_t *i2c) { (void)i2c; }

/* ---- core 1 as a thread */
static void (*core1_entry)(void);
static void *core1_thread(void *_) { (void)_; core1_entry(); return NULL; }
void multicore_launch_core1(void (*entry)(void)) { core1_entry = entry; pthread_create(&core1_tid, NULL, core1_thread, NULL); pthread_detach(core1_tid); core1_launched = 1; }

/* ---- core 0 helpers */
static events_t EV;
static void wait_done(volatile play_req_t *r, uint64_t cap_us) { uint64_t t0 = sim_now_us; while (!r->done && sim_now_us - t0 < cap_us) tick(1); }
static void dump(const char *scenario, const play_req_t *r, int extra_ok, const char *extra) {
    player_status_t st; player_status(&st);
    printf("{\"scenario\":\"%s\",\"key\":[", scenario);
    for (int i = 0; i < n_key; i++) printf("%s[%.3f,%d]", i ? "," : "", key_rec[i].t / 1000.0, key_rec[i].on);
    printf("],\"fm\":[");
    for (int i = 0; i < n_fm; i++) printf("%s[%llu,%d]", i ? "," : "", (unsigned long long)fm_rec[i].t, fm_rec[i].counts);
    printf("],\"played\":%u,\"late\":%u,\"done\":%d,\"cut\":%d,\"busy\":%d,\"keyed\":%d,\"revision\":%d,\"si5351_ok\":%d,\"core1_alive\":%d,\"attenuation\":%d,\"i2c_errors\":%u,\"atten_bits\":[",
           r ? r->played : 0, r ? r->late : 0, r ? r->done : 1, r ? r->cut : 0, player_busy(), st.keyed, st.revision, st.si5351_ok, st.core1_alive, st.attenuation, st.i2c_errors);
    for (int i = 0; i < n_atten_bits; i++) printf("%s%d", i ? "," : "", atten_bits[i]);
    printf("],\"atten_le_pulses\":%d,\"writes\":%d,\"end_ms\":%.3f,\"extra_ok\":%d,\"extra\":\"%s\"}\n", atten_le_pulses, writes, sim_now_us / 1000.0, extra_ok, extra ? extra : "");
    fflush(stdout);
}
static void req_init(play_req_t *r, const events_t *ev, int rate, uint32_t max_samples) {
    memset(r, 0, sizeof *r); r->ev = ev; synth_params_default(&r->params); r->params.sample_rate = rate; r->params.level = 0.9f;
    r->dev_counts = (int32_t)si5351_counts_for_deviation(2500.0); r->max_samples = max_samples;
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: see header\n"); return 2; }
    const char *sc = argv[1];
    if (!strcmp(sc, "rev2")) rev_id0 = 0;
    regs[0] = 0;                              /* the chip answers */
    player_start();
    player_set_carrier(146565000.0);
    play_req_t r; char extra[160] = "";
    if (!strcmp(sc, "morse")) {
        char text[256] = ""; for (int i = 4; i < argc; i++) { if (i > 4) strcat(text, " "); strcat(text, argv[i]); }
        events_clear(&EV); morse_events(&EV, text, atoi(argv[2]), (float)atof(argv[3]), 0);
        req_init(&r, &EV, 8000, 0);
        player_key(true); player_play(&r); wait_done(&r, 120ull * 1000000); player_key(false);
        dump(sc, &r, 1, NULL);
    } else if (!strcmp(sc, "two")) {
        events_clear(&EV); events_push(&EV, 700, 100); events_push(&EV, 0, 50); events_push(&EV, 900, 100);
        req_init(&r, &EV, 8000, 0);
        player_key(true); player_play(&r); wait_done(&r, 5000000); uint32_t p1 = r.played, n1 = (uint32_t)n_fm;
        play_req_t r2; req_init(&r2, &EV, 8000, 0); player_play(&r2); wait_done(&r2, 5000000); player_key(false);
        snprintf(extra, sizeof extra, "first_played=%u first_fm=%u second_played=%u second_done=%d", p1, n1, r2.played, r2.done);
        dump(sc, &r2, p1 == r2.played && r2.done, extra);
    } else if (!strcmp(sc, "stop")) {
        uint64_t after = strtoull(argv[2], NULL, 10) * 1000;
        events_clear(&EV); events_push(&EV, 700, 10000);   /* a 10 s tone */
        req_init(&r, &EV, 8000, 0);
        player_key(true); player_play(&r); uint64_t t0 = sim_now_us; while (sim_now_us - t0 < after) tick(1);
        uint64_t ts = sim_now_us; player_stop(); uint64_t stop_took = sim_now_us - ts; player_key(false);
        snprintf(extra, sizeof extra, "stop_took_us=%llu", (unsigned long long)stop_took);
        dump(sc, &r, r.done && r.cut && !player_busy() && stop_took < 20000, extra);
    } else if (!strcmp(sc, "cut")) {
        uint32_t max_ms = (uint32_t)atoi(argv[2]);
        events_clear(&EV); events_push(&EV, 700, 10000);
        req_init(&r, &EV, 8000, max_ms * 8);              /* max_samples at 8 kHz */
        player_key(true); player_play(&r); wait_done(&r, 60000000); player_key(false);
        dump(sc, &r, r.done && r.cut && r.played == max_ms * 8, NULL);
    } else if (!strcmp(sc, "empty")) {
        events_clear(&EV); req_init(&r, &EV, 8000, 0);
        int w0 = writes; player_play(&r); int w1 = writes;
        snprintf(extra, sizeof extra, "writes_during=%d", w1 - w0);
        dump(sc, &r, r.done && !player_busy() && w1 == w0 && r.played == 0, extra);
    } else if (!strcmp(sc, "hold")) {
        uint64_t at = strtoull(argv[2], NULL, 10) * 1000, dur = strtoull(argv[3], NULL, 10) * 1000;
        events_clear(&EV); events_push(&EV, 700, 400);
        req_init(&r, &EV, 8000, 0);
        player_key(true); player_play(&r); uint64_t t0 = sim_now_us; while (sim_now_us - t0 < at) tick(1);
        int before = n_fm; player_bus_hold(); uint64_t h0 = sim_now_us; int during0 = n_fm;
        while (sim_now_us - h0 < dur) tick(1);
        int during1 = n_fm; player_bus_release(); wait_done(&r, 5000000); player_key(false);
        snprintf(extra, sizeof extra, "fm_before_hold=%d fm_during_hold=%d", before, during1 - during0);
        dump(sc, &r, r.done && during1 == during0 && r.late >= 1, extra);
    } else if (!strcmp(sc, "atten") || !strcmp(sc, "rev2")) {
        int code = argc > 2 ? atoi(argv[2]) : 40;
        bool ok_idle = player_set_attenuation(code);
        events_clear(&EV); events_push(&EV, 700, 300); req_init(&r, &EV, 8000, 0);
        player_key(true); player_play(&r); uint64_t t0 = sim_now_us; while (sim_now_us - t0 < 50000) tick(1);
        bool ok_mid = player_set_attenuation(code + 1);    /* refused mid-stream */
        wait_done(&r, 5000000); player_key(false);
        snprintf(extra, sizeof extra, "ok_idle=%d ok_mid=%d code=%d", ok_idle, ok_mid, code);
        dump(sc, &r, !strcmp(sc, "rev2") ? (!ok_idle && !ok_mid) : (ok_idle && !ok_mid), extra);
    } else if (!strcmp(sc, "dead")) {
        /* core 1 hangs mid-stream (frozen: it stops passing time). Core 0's next command waits CALL_TIMEOUT_US for an
         * acknowledgement that never comes, declares core 1 dead, and switches the amplifier off itself. */
        events_clear(&EV); events_push(&EV, 700, 10000); req_init(&r, &EV, 8000, 0);
        player_key(true); player_play(&r);
        uint64_t t0 = sim_now_us; while (sim_now_us - t0 < 20000) tick(1);
        int keyed_before = n_key ? key_rec[n_key - 1].on : 0;
        freeze_core1(); uint64_t tf = sim_now_us;
        bool stop_ok = (player_stop(), player_alive());        /* the STOP times out: dead */
        uint64_t took = sim_now_us - tf;
        int keyed_after = n_key ? key_rec[n_key - 1].on : 0;
        bool later = player_set_attenuation(3);                   /* every later call fails fast, without waiting */
        uint64_t took2 = sim_now_us - tf - took;
        player_status_t st; player_status(&st);
        snprintf(extra, sizeof extra, "keyed_before=%d keyed_after=%d alive=%d took_us=%llu later_ok=%d later_took_us=%llu", keyed_before, keyed_after, stop_ok, (unsigned long long)took, later, (unsigned long long)took2);
        dump(sc, &r, keyed_before && !keyed_after && !stop_ok && !st.core1_alive && !later && took2 < 100 && took >= 1000000, extra);
    } else { fprintf(stderr, "unknown scenario %s\n", sc); return 2; }
    fflush(stdout); _exit(0);   /* core 1 spins forever; do not wait for it */
}
