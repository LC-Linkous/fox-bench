/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/cfg.h -- fox.json over defaults.json -> validated configuration.
 * Independent implementation of CONFIG.md for the foxlib-c family (twin of
 * foxlib/cfg.py; the page has js/model/schema.js). Pure: the host tests run it. */
#ifndef FOXLIBC_CFG_H
#define FOXLIBC_CFG_H
#include <stdbool.h>
#include <stdint.h>
#include "json.h"
#include "melody.h"
#include "schedule.h"
#include "synth.h"

#define CFG_SCHEMA 1
#define CFG_MAX_RANGES 4
#define CFG_MAX_FREQS 16
#define CFG_MAX_ITEMS 24

typedef enum { PAYLOAD_NONE, PAYLOAD_SONGS, PAYLOAD_SSTV } payload_kind_t;

typedef struct {
    char template_id[32];
    char board[32];
    char module[32];
    struct {
        char family[16];
        float ranges_mhz[CFG_MAX_RANGES][2]; int n_ranges;
        float bandwidth_khz;
        float power_dbm; bool power_set;                 /* power_set false == null */
        int itu_zone;
        int attenuation;                                 /* 0..127 (rev 3 boards) */
        int id_deviation_hz, audio_deviation_hz;         /* peak deviation */
        tone_shape_t tone_shape;
        bool preemphasis;
        float correction_ppm;
        int sample_rate;                                 /* FM update rate, Hz */
        bool tx_while_mounted;
    } radio;
    struct { double frequencies_mhz[CFG_MAX_FREQS]; int n; bool announce_qsy; } plan;   /* double: 146.565f * 1e6 is 2 Hz off */
    struct { char callmessage[65]; char placeholder[17]; int wpm; int tone_hz; bool telemetry_batt; bool tx_without_callsign; } id;
    struct {
        payload_kind_t kind;
        float articulation; bool skip_on_low_battery;
        song_t songs[PLAYLIST_MAX]; int n_songs;
        float dit_s; bool dit_set;                        /* none: QRSS element length */
        char message[65]; bool message_set;
        char images_file[32];
    } payload;
    sched_cfg_t schedule;
    struct { float divider_ratio, calibration, low_v, critical_v, recovery_v; int samples; } battery;
    struct { float max_keydown_s; bool set; } limits;
} fox_cfg_t;

typedef struct {
    struct { char key[32]; char reason[32]; } items[CFG_MAX_ITEMS];
    int n_items;
    char fatal[32];           /* "" when none */
    char mode[24];            /* ok | partial | default(<why>) */
} cfg_report_t;

/* Fill cfg from the defaults document (trusted, no report). Returns false if it is not usable. */
bool cfg_load_defaults(fox_cfg_t *cfg, const json_doc *d, int root);
/* Apply a user document on top (fox.json). Validation and fallbacks per CONFIG.md. */
void cfg_apply_user(fox_cfg_t *cfg, const fox_cfg_t *defaults, const json_doc *d, int root, const char *board_id, cfg_report_t *rep);
void cfg_report_init(cfg_report_t *rep);
void cfg_report_bad(cfg_report_t *rep, const char *key, const char *reason);
/* "ok" | "partial(a,b)" | "default(schema)" | "fatal(x)" into buf */
const char *cfg_report_status(const cfg_report_t *rep, char *buf, int n);
bool cfg_id_ok(const fox_cfg_t *cfg);
bool cfg_freq_in_ranges(const fox_cfg_t *cfg, double mhz);

#endif
