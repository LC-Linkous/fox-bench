/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/report.h -- the validation report cfg.c (FM) and netcfg.c (network) share: twin of foxlib/report.py.
 * "ok" | "partial(a,b)" | "default(<why>)" | "fatal(<why>)", as the banner's cfg= word. */
#ifndef FOXLIBC_REPORT_H
#define FOXLIBC_REPORT_H

#define CFG_MAX_ITEMS 24

typedef struct {
    struct { char key[32]; char reason[48]; } items[CFG_MAX_ITEMS];
    int n_items;
    char fatal[32];           /* "" when none */
    char mode[24];            /* ok | partial | default(<why>) */
} cfg_report_t;

void cfg_report_init(cfg_report_t *rep);
void cfg_report_bad(cfg_report_t *rep, const char *key, const char *reason);
void cfg_report_mode(cfg_report_t *rep, const char *mode);      /* "default(schema)" and the like */
/* "ok" | "partial(a,b)" | "default(schema)" | "fatal(x)" into buf */
const char *cfg_report_status(const cfg_report_t *rep, char *buf, int n);

#endif
