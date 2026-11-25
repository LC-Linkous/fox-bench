/* SPDX-License-Identifier: GPL-3.0-or-later
 * netfox -- the runner for a network fox on an Espressif chip: configuration (core/netcfg), the FOX banner, the duty
 * cycle on the chip's own radio, the bench actions the console exposes. The CircuitPython twin is foxlib/netfox.py;
 * the banner and the log lines are the same words, so the page and hw_smoke read both. */
#ifndef NETFOX_H
#define NETFOX_H
#include <stdbool.h>
#include <stdint.h>
#include "netcfg.h"

void netfox_init(void);                          /* load defaults.json / fox.json, validate, banner, start the cycle */
void netfox_reload(const char *why);             /* a file changed (console put): stop, load again, banner, restart */
void netfox_poll(void);                          /* advance the cycle; from the main loop */
char *netfox_filebuf(size_t *cap);          /* the file text buffer, lent to the console for put/get between loads */
void netfox_schedule_reload(uint32_t in_ms);     /* a put settles for a moment before the reload */
const char *netfox_banner_line(char *buf, int n);
void netfox_print_banner(void);
const net_cfg_t *netfox_cfg(void);
const cfg_report_t *netfox_report(void);
const char *netfox_uid(void);
const char *netfox_radio_status(void);           /* ok | unsupported | failed | skipped */
bool netfox_on_air(void);

/* bench (console): the cycle pauses, the action runs, the cycle resumes a second later */
bool netfox_bench_key(uint32_t ms);              /* radio up for ms; prints foxlib's key line, then the console prints ok */
bool netfox_bench_scan(void);                    /* prints "-dBm ch<n> name" lines */
void netfox_bench_stop(void);
void netfox_health_json(char *buf, int n);
#endif
