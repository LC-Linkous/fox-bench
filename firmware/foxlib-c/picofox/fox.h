/* SPDX-License-Identifier: GPL-3.0-or-later
 * fox -- the runner: configuration, the per-cycle prologue every fox repeats
 * (foxlib/cycle.py written as a state machine), the template bodies, bench actions. */
#ifndef FOX_H
#define FOX_H
#include <stdbool.h>
#include <stdint.h>
#include "cfg.h"

#define BOARD_ID "picofox-foxlibc"

typedef enum { FOX_HOLD, FOX_KEYED, FOX_BENCH } fox_state_t;

void fox_init(void);                            /* mount, seed files, load, banner, start the cycle */
void fox_reload(const char *why);               /* stop, reload fox.json/defaults.json, banner, restart */
void fox_drive_changed(void);                   /* host writes settled: reload if the files that matter changed */
void fox_poll(void);                            /* advance the state machine; call from the main loop */
const char *fox_banner_line(char *buf, int n);  /* "FOX template=... " */
void fox_print_banner(void);
const fox_cfg_t *fox_cfg(void);
const cfg_report_t *fox_report(void);
bool fox_id_ok(void);
fox_state_t fox_state(void);
const char *fox_radio_status(void);             /* ok | nosi5351 | band_edge | retune_failed | core1_dead | skipped */

/* bench actions (console): suspend the cycle, key, do the thing, unkey, resume */
bool fox_bench_key(uint32_t ms);                /* unmodulated carrier */
bool fox_bench_tone(float hz, uint32_t ms);
bool fox_bench_id(void);
bool fox_bench_freq(double mhz);                 /* retune until the next reload */
bool fox_bench_atten(int code);                  /* attenuator code until the next reload; stops what is on the air first (core 1 refuses it mid-stream) */
void fox_bench_stop(void);
void fox_quiesce(void);                         /* unkey and stay silent: before reboot / bootsel / the 1200-baud touch */

#endif
