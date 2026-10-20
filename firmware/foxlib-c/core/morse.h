/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef FOXLIBC_MORSE_H
#define FOXLIBC_MORSE_H
#include "events.h"

const char *morse_code(char c);                       /* ".-" or NULL when not in the table */
/* Appends the events for `text` to `out`. dit_ms > 0 overrides wpm (QRSS). */
void morse_events(events_t *out, const char *text, int wpm, float tone_hz, float dit_ms);
double morse_duration_ms(const char *text, int wpm, float dit_ms);

#endif
