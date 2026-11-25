/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/report.c -- see report.h. */
#include "report.h"
#include <stdio.h>
#include <string.h>

static void rcopy(char *dst, int n, const char *s) { if (!s) { dst[0] = 0; return; } strncpy(dst, s, (size_t)n - 1); dst[n - 1] = 0; }

void cfg_report_init(cfg_report_t *rep) { rep->n_items = 0; rep->fatal[0] = 0; strcpy(rep->mode, "ok"); }
void cfg_report_bad(cfg_report_t *rep, const char *key, const char *reason) {
    if (!rep || rep->n_items >= CFG_MAX_ITEMS) return;
    rcopy(rep->items[rep->n_items].key, sizeof rep->items[0].key, key);
    rcopy(rep->items[rep->n_items].reason, sizeof rep->items[0].reason, reason);
    rep->n_items++;
}
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

void cfg_report_mode(cfg_report_t *rep, const char *mode) { if (rep) rcopy(rep->mode, sizeof rep->mode, mode); }
