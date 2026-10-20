/* SPDX-License-Identifier: GPL-3.0-or-later
 * host stubs for fox.c: player (records keying and events on the virtual clock),
 * filesystem (a directory), console (collects prints), drive state, si5351 math. */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "console.h"
#include "fs.h"
#include "msc_disk.h"
#include "player.h"
#include "si5351.h"

uint64_t sim_now_us;
const char *sim_dir = ".";
int sim_host_drive = 0;

/* ---- record */
#define MAXREC 60000   /* an SSTV image alone is ~11 000 tones */
static struct { double t; int on; } ptt[MAXREC]; static int n_ptt;
static struct { double s, e; float hz; } tones[MAXREC]; static int n_tones;
static double retunes[256]; static int n_retunes;
static char prints[1 << 16]; static size_t n_prints;
int sim_unkeys;

static void rec_ptt(int on) { if (n_ptt < MAXREC) { ptt[n_ptt].t = sim_now_us / 1000.0; ptt[n_ptt].on = on; n_ptt++; } if (!on) sim_unkeys++; }

/* ---- player */
static bool keyed; static play_req_t *cur; static uint64_t cur_end_us; static double carrier;
static uint32_t keyed_at;
void player_start(void) {}
bool player_set_carrier(double hz) { carrier = hz; if (n_retunes < 256) retunes[n_retunes++] = hz; return hz >= 100e6 && hz <= 200e6; }
void player_key(bool on) { if (on == keyed) return; keyed = on; rec_ptt(on); if (on) keyed_at = (uint32_t)(sim_now_us / 1000); }
void player_set_attenuation(int code) { (void)code; }
void player_play(play_req_t *req) {
    req->done = false; req->cut = false; req->played = 0; req->late = 0;
    if (!req->src && (!req->ev || !req->ev->n)) { req->done = true; return; }
    double t = sim_now_us / 1000.0, budget = req->max_samples ? req->max_samples * 1000.0 / req->params.sample_rate : 1e18, used = 0;
    event_t ev; int i = 0;
    for (;;) {
        if (req->src) { if (!req->src(req->src_ctx, &ev)) break; }
        else { if (i >= req->ev->n) break; ev = req->ev->e[i++]; }
        float ms = ev.ms;
        if (used + ms > budget) { ms = (float)(budget - used); req->cut = true; }
        if (ev.hz > 0 && ms > 0 && n_tones < MAXREC) { tones[n_tones].s = t; tones[n_tones].e = t + ms; tones[n_tones].hz = ev.hz; n_tones++; }
        t += ms; used += ms;
        if (req->cut) break;
    }
    cur = req; cur_end_us = (uint64_t)(t * 1000);
}
void player_stop(void) { if (cur) { cur->cut = true; cur->done = true; cur = NULL; } }
bool player_busy(void) { return cur != NULL; }
void player_status(player_status_t *out) { memset(out, 0, sizeof *out); out->si5351_ok = true; out->revision = 3; out->carrier_hz = carrier; out->keyed = keyed; }
uint32_t player_keyed_ms(void) { return keyed ? (uint32_t)(sim_now_us / 1000) - keyed_at : 0; }
bool player_charging(void) { return false; }
void sim_player_tick(void) { if (cur && sim_now_us >= cur_end_us) { cur->done = true; cur = NULL; } }

/* ---- si5351 math (what fox.c uses on core 0) */
uint32_t si5351_counts_for_deviation(double dev_hz) { return (uint32_t)(dev_hz * 6 / 25e6 * 1048575 + 0.5); }

/* ---- fs over a directory */
bool fs_mount(bool f) { (void)f; return true; }
bool fs_mounted(void) { return true; }
const char *fs_error(void) { return ""; }
static FILE *openp(const char *path, const char *mode) { char p[512]; snprintf(p, sizeof p, "%s/%s", sim_dir, path); return fopen(p, mode); }
long fs_read(const char *path, char *buf, size_t cap) { FILE *f = openp(path, "rb"); if (!f) return -1; size_t n = fread(buf, 1, cap - 1, f); fclose(f); buf[n] = 0; return (long)n; }
long fs_read_at(const char *path, uint32_t off, void *buf, size_t n) { FILE *f = openp(path, "rb"); if (!f) return -1; fseek(f, (long)off, SEEK_SET); size_t got = fread(buf, 1, n, f); fclose(f); return (long)got; }
bool fs_write(const char *path, const void *data, size_t len) { FILE *f = openp(path, "wb"); if (!f) return false; fwrite(data, 1, len, f); fclose(f); return true; }
bool fs_exists(const char *path) { FILE *f = openp(path, "rb"); if (f) fclose(f); return f != NULL; }
int fs_seed(void) { return 0; }
int fs_list(char *out, size_t cap) { snprintf(out, cap, "fox.json defaults.json"); return 2; }

/* ---- console */
void con_init(void) {}
void con_poll(void) {}
bool con_connected(void) { return true; }
void con_puts(const char *s) { size_t n = strlen(s); if (n_prints + n < sizeof prints) { memcpy(prints + n_prints, s, n); n_prints += n; } }
void con_printf(const char *fmt, ...) { char b[400]; va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof b, fmt, ap); va_end(ap); con_puts(b); }

/* ---- drive */
bool msc_host_has_drive(void) { return sim_host_drive; }
uint32_t msc_host_writes(void) { return 0; }
void msc_reset_eject(void) {}

/* ---- dump */
static void jstr(const char *s, size_t n) { putchar('"'); for (size_t i = 0; i < n; i++) { unsigned char c = (unsigned char)s[i]; if (c == '"' || c == '\\') { putchar('\\'); putchar(c); } else if (c == '\n') fputs("\\n", stdout); else if (c == '\r') {} else if (c < 32) fputs(" ", stdout); else putchar(c); } putchar('"'); }
void sim_dump(void) {
    printf("{\"prints\":"); jstr(prints, n_prints);
    printf(",\"ptt\":["); for (int i = 0; i < n_ptt; i++) printf("%s[%.3f,%d]", i ? "," : "", ptt[i].t, ptt[i].on);
    printf("],\"tones\":["); for (int i = 0; i < n_tones; i++) printf("%s[%.3f,%.3f,%g]", i ? "," : "", tones[i].s, tones[i].e, tones[i].hz);
    printf("],\"retunes\":["); for (int i = 0; i < n_retunes; i++) printf("%s%.1f", i ? "," : "", retunes[i]);
    printf("],\"keyed_now\":%d,\"end_ms\":%.1f}\n", keyed, sim_now_us / 1000.0);
}
