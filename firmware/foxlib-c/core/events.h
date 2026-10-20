/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/events.h -- everything on the air is a stream of (hz, ms); 0 Hz is silence.
 * Twin of foxlib/tones.py's event contract. */
#ifndef FOXLIBC_EVENTS_H
#define FOXLIBC_EVENTS_H

#include <stdbool.h>
#include <stddef.h>

typedef struct { float hz; float ms; } event_t;

#ifndef EVENTS_MAX
#define EVENTS_MAX 2048
#endif

typedef struct {
    event_t e[EVENTS_MAX];
    int n;
    bool overflow;     /* set when an encoder ran out of room; the stream is truncated, never garbage */
} events_t;

static inline void events_clear(events_t *ev) { ev->n = 0; ev->overflow = false; }
static inline void events_push(events_t *ev, float hz, float ms) {
    if (ev->n < EVENTS_MAX) { ev->e[ev->n].hz = hz; ev->e[ev->n].ms = ms; ev->n++; } else ev->overflow = true;
}
static inline double events_ms(const events_t *ev) { double t = 0; for (int i = 0; i < ev->n; i++) t += ev->e[i].ms; return t; }

#endif
