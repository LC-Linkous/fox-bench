/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/synth.c -- see synth.h. */
#include "synth.h"
#include <math.h>
#include <string.h>

#define TBL_BITS 10
#define TBL_N (1 << TBL_BITS)
static int16_t SIN[TBL_N];
static bool sin_ready;
static int32_t PEAK_Q15[4];    /* peak of sin + sin3/3 (+ sin5/5) for 1, 2, 3 harmonics */

static void tables(void) {
    if (sin_ready) return;
    for (int i = 0; i < TBL_N; i++) SIN[i] = (int16_t)lrint(32767.0 * sin(2 * M_PI * i / TBL_N));
    sin_ready = true;    /* before the peak scan below, which uses the lookup */
    for (int h = 1; h <= 3; h++) {
        int32_t pk = 0;
        for (int i = 0; i < 400; i++) {
            uint32_t ph = (uint32_t)(((uint64_t)i << 32) / 400);
            int32_t v = synth_sin_q15(ph);
            if (h >= 2) v += synth_sin_q15(ph * 3) / 3;
            if (h >= 3) v += synth_sin_q15(ph * 5) / 5;
            if (v < 0) v = -v;
            if (v > pk) pk = v;
        }
        PEAK_Q15[h] = pk ? pk : 32767;
    }
}

int32_t synth_sin_q15(uint32_t phase) {
    tables();
    uint32_t i = phase >> (32 - TBL_BITS), f = (phase >> (32 - TBL_BITS - 8)) & 0xFF;   /* linear interpolation, 8 fraction bits */
    int32_t a = SIN[i], b = SIN[(i + 1) & (TBL_N - 1)];
    return a + (((b - a) * (int32_t)f) >> 8);
}

void synth_params_default(synth_params_t *p) {
    p->sample_rate = 8000; p->shape = SHAPE_BRIGHT; p->preemphasis = true; p->pre_floor = 0.4f; p->ramp_ms = 5; p->level = 0.5f;
}

static float fold(float hz, int max_hz) { while (hz > (float)max_hz) hz *= 0.5f; return hz; }

static void start_event(synth_t *s) {
    const event_t *e = &s->ev->e[s->idx];
    s->ev_start = s->ev_end;
    s->ms_acc += e->ms;
    s->ev_end = (uint32_t)lrint(s->ms_acc * s->p.sample_rate / 1000.0);
    if (s->ev_end < s->ev_start) s->ev_end = s->ev_start;
    float hz = fold(e->hz, s->max_hz);
    if (hz <= 0) { s->silent = true; s->phase = 0; s->step = 0; return; }
    s->silent = false;
    s->step = (uint32_t)((double)hz * 4294967296.0 / s->p.sample_rate);
    int h = 1;
    if (s->p.shape == SHAPE_BRIGHT) { if (hz * 3 <= s->max_hz) h = 2; if (hz * 5 <= s->max_hz) h = 3; }
    s->harmonics = (uint8_t)h;
    float g = s->p.preemphasis ? fmaxf(s->p.pre_floor, hz / s->f_top) : 1.0f;
    float lvl = fminf(1.0f, fmaxf(0.0f, s->p.level));
    s->gain_q15 = (int32_t)lrintf(lvl * g * 32768.0f * 32767.0f / (float)PEAK_Q15[h]);
}

void synth_prepare(synth_t *s, const events_t *ev, const synth_params_t *p) {
    tables();
    memset(s, 0, sizeof *s);
    s->ev = ev; s->p = *p;
    s->max_hz = p->sample_rate / 2 - 100;
    s->ramp = (uint32_t)lrintf(p->ramp_ms * p->sample_rate / 1000.0f); if (s->ramp < 1) s->ramp = 1;
    float top = 0;
    double ms = 0;
    for (int i = 0; i < ev->n; i++) { float f = fold(ev->e[i].hz, s->max_hz); if (f > top) top = f; ms += ev->e[i].ms; }
    s->f_top = top > 0 ? top : 1;
    s->total = (uint32_t)lrint(ms * p->sample_rate / 1000.0);
    s->idx = -1; s->ev_end = 0; s->ms_acc = 0;
    s->done = ev->n == 0 || s->total == 0;
}

static inline int32_t env_q15(const synth_t *s, uint32_t i, uint32_t n) {
    /* raised cosine over the first and last `ramp` samples of an event (0.5 - 0.5 cos(pi i / ramp)) */
    uint32_t k;
    if (i < s->ramp) k = i; else if (n - i <= s->ramp) k = n - i; else return 32767;
    /* cos(pi k / ramp) = sin(pi k / ramp + pi/2): phase = k / (2 ramp) turns + quarter turn */
    uint32_t ph = (uint32_t)(((uint64_t)k << 31) / s->ramp) + 0x40000000u;
    return (32767 - synth_sin_q15(ph)) / 2;
}

int16_t synth_next(synth_t *s) {
    if (s->done) return 0;
    while (s->idx < 0 || s->pos >= s->ev_end) {
        s->idx++;
        if (s->idx >= s->ev->n) { s->done = true; return 0; }
        start_event(s);
    }
    int32_t out = 0;
    if (!s->silent) {
        int32_t v = synth_sin_q15(s->phase);
        if (s->harmonics >= 2) v += synth_sin_q15(s->phase * 3) / 3;
        if (s->harmonics >= 3) v += synth_sin_q15(s->phase * 5) / 5;
        int32_t e = env_q15(s, s->pos - s->ev_start, s->ev_end - s->ev_start);
        out = (int32_t)(((int64_t)v * s->gain_q15 >> 15) * e >> 15);
        s->phase += s->step;
    }
    s->pos++;
    if (s->pos >= s->total) s->done = true;
    if (out > 32767) out = 32767;
    if (out < -32767) out = -32767;
    return (int16_t)out;
}

uint32_t synth_total_samples(const synth_t *s) { return s->total; }

uint32_t synth_render(const events_t *ev, const synth_params_t *p, int16_t *out, uint32_t n) {
    synth_t s; synth_prepare(&s, ev, p);
    uint32_t i = 0;
    while (!synth_done(&s) && i < n) out[i++] = synth_next(&s);
    return i;
}
