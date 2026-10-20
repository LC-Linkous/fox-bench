/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/synth.h -- event stream -> audio samples, one at a time, integer math.
 *
 * The streaming twin of js/audio/wav.js renderPcm(): raised-cosine edges, octave
 * folding above Nyquist, 'sine' | 'bright' (odd harmonics 3 and 5 that fit under
 * maxHz), 6 dB/octave pre-emphasis relative to the highest tone in the stream
 * (floored), per-tone-shape peak normalisation so `level` is the true peak.
 * Event boundaries fall on cumulative deadlines (no per-event rounding drift).
 * No floating point in the per-sample path: a Cortex-M0+ runs it in a few µs. */
#ifndef FOXLIBC_SYNTH_H
#define FOXLIBC_SYNTH_H
#include <stdbool.h>
#include <stdint.h>
#include "events.h"

typedef enum { SHAPE_SINE = 0, SHAPE_BRIGHT = 1 } tone_shape_t;

typedef struct {
    int sample_rate;        /* Hz */
    tone_shape_t shape;
    bool preemphasis;
    float pre_floor;        /* 0.4 */
    float ramp_ms;          /* 5 */
    float level;            /* peak amplitude 0..1 of full scale (32767) */
} synth_params_t;

typedef struct {
    const events_t *ev;
    synth_params_t p;
    int max_hz;
    float f_top;
    /* stream position */
    int idx;                /* current event */
    uint32_t pos;           /* sample index from stream start */
    uint32_t ev_start, ev_end;   /* sample bounds of the current event */
    double ms_acc;          /* cumulative ms at ev_end */
    /* current event's voice */
    uint32_t phase, step;   /* 32-bit phase accumulator */
    int32_t gain_q15;       /* level * preemphasis / peak, Q15 */
    uint8_t harmonics;      /* 1, 2 or 3 harmonics in use */
    bool silent;
    uint32_t ramp;          /* samples */
    uint32_t total;
    bool done;
} synth_t;

void synth_params_default(synth_params_t *p);
void synth_prepare(synth_t *s, const events_t *ev, const synth_params_t *p);
int16_t synth_next(synth_t *s);           /* next sample; 0 once done */
static inline bool synth_done(const synth_t *s) { return s->done; }
uint32_t synth_total_samples(const synth_t *s);
/* Host/test helper: render the whole stream into `out` (capacity n), returns samples written. */
uint32_t synth_render(const events_t *ev, const synth_params_t *p, int16_t *out, uint32_t n);

/* Exposed for tests: 1024-entry quarter-free full sine table lookup, Q15. */
int32_t synth_sin_q15(uint32_t phase);

#endif
