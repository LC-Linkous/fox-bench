/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef FOXLIBC_SCHEDULE_H
#define FOXLIBC_SCHEDULE_H
#include <stdbool.h>
#include <stdint.h>

typedef enum { SCHED_FIXED, SCHED_POPCORN, SCHED_RESURRECTION } sched_kind_t;
typedef enum { PHASE_ALIVE, PHASE_DEAD } sched_phase_t;
typedef enum { WAKE_DIT, WAKE_ID } sched_wake_t;

typedef struct {
    sched_kind_t kind;
    uint32_t seed;
    int32_t delay_ms;                                   /* fixed, resurrection */
    int32_t cluster, cluster_gap_ms, dark_min_ms, dark_max_ms;   /* popcorn */
    int32_t alive_min_ms, alive_max_ms, dead_ms, dit_min_ms, dit_max_ms, id_every;   /* resurrection */
    bool dead_song;
} sched_cfg_t;

typedef struct {
    sched_cfg_t cfg;
    uint32_t state;
    int32_t in_cluster;
    bool dead, until_set;
    int32_t wakes;
    int64_t until;
} sched_t;

uint32_t sched_rand_next(uint32_t state);
int32_t sched_rand_int(uint32_t *state, int32_t lo, int32_t hi);
void sched_init(sched_t *s, const sched_cfg_t *cfg);
sched_phase_t sched_phase(sched_t *s, int64_t now_ms);
sched_wake_t sched_dead_wake(sched_t *s);
int32_t sched_wait_ms(sched_t *s, int64_t now_ms);
const char *sched_kind_name(sched_kind_t k);

#endif
