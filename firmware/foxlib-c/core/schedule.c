/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/schedule.c -- deterministic scheduling. Twin of foxlib/schedule.py.
 * glibc-constant LCG on a 31-bit state so CircuitPython, desktop Python, the page
 * and this firmware draw identical sequences from one seed. */
#include "schedule.h"

#define LCG_A 1103515245u
#define LCG_C 12345u
#define LCG_M (1u << 31)

uint32_t sched_rand_next(uint32_t state) { return (LCG_A * state + LCG_C) % LCG_M; }

/* Python: v = state / M (a float in [0,1)); lo + int(v * (hi - lo + 1)). Doubles reproduce that exactly
 * for the ranges used (hi - lo + 1 < 2^31). */
int32_t sched_rand_int(uint32_t *state, int32_t lo, int32_t hi) {
    *state = sched_rand_next(*state);
    double v = (double)*state / (double)LCG_M;
    return lo + (int32_t)(v * (double)((int64_t)hi - lo + 1));
}

void sched_init(sched_t *s, const sched_cfg_t *cfg) {
    s->cfg = *cfg; s->state = cfg->seed; s->in_cluster = 0; s->dead = false; s->wakes = 0; s->until_set = false; s->until = 0;
}

sched_phase_t sched_phase(sched_t *s, int64_t now_ms) {
    if (s->cfg.kind != SCHED_RESURRECTION) return PHASE_ALIVE;
    const sched_cfg_t *c = &s->cfg;
    if (!s->until_set) { s->until = now_ms + sched_rand_int(&s->state, c->alive_min_ms, c->alive_max_ms); s->until_set = true; }
    if (now_ms >= s->until) {
        if (s->dead) { s->dead = false; s->until = now_ms + sched_rand_int(&s->state, c->alive_min_ms, c->alive_max_ms); }
        else { s->dead = true; s->wakes = 0; s->until = now_ms + c->dead_ms; }
    }
    return s->dead ? PHASE_DEAD : PHASE_ALIVE;
}

sched_wake_t sched_dead_wake(sched_t *s) {
    s->wakes++;
    return (s->wakes % s->cfg.id_every) == 0 ? WAKE_ID : WAKE_DIT;
}

int32_t sched_wait_ms(sched_t *s, int64_t now_ms) {
    (void)now_ms;
    const sched_cfg_t *c = &s->cfg;
    switch (c->kind) {
        case SCHED_POPCORN:
            s->in_cluster++;
            if (s->in_cluster >= c->cluster) { s->in_cluster = 0; return sched_rand_int(&s->state, c->dark_min_ms, c->dark_max_ms); }
            return c->cluster_gap_ms;
        case SCHED_RESURRECTION:
            if (s->dead) return sched_rand_int(&s->state, c->dit_min_ms, c->dit_max_ms);
            return c->delay_ms;
        default:
            return c->delay_ms;
    }
}

const char *sched_kind_name(sched_kind_t k) { return k == SCHED_POPCORN ? "popcorn" : k == SCHED_RESURRECTION ? "resurrection" : "fixed"; }
