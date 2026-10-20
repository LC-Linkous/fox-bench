/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/melody.c -- songs -> events. Twin of foxlib/melody.py.
 * song: tempo (quarter notes/min), notes [[midi, dur32], ...]; midi 0 is a rest;
 * dur32 in 32nds of a whole note. A note sounds for `articulation` of its slot
 * and rests for the remainder (rests shorter than 0.01 ms are not emitted). */
#include "melody.h"
#include <math.h>

float melody_midi_hz(int note) { return 440.0f * powf(2.0f, ((float)note - 69.0f) / 12.0f); }

void melody_events(events_t *out, const song_t *song, float articulation) {
    double ms_per_32 = 7500.0 / (double)song->tempo;
    for (int i = 0; i < song->n_notes; i++) {
        int note = song->notes[i][0], d = song->notes[i][1];
        double slot = d * ms_per_32;
        if (note == 0) { events_push(out, 0, (float)slot); continue; }
        double on = slot * articulation;
        events_push(out, melody_midi_hz(note), (float)on);
        if (slot - on > 0.01) events_push(out, 0, (float)(slot - on));
    }
}

double melody_duration_ms(const song_t *song, float articulation) {
    double ms_per_32 = 7500.0 / (double)song->tempo, t = 0;
    for (int i = 0; i < song->n_notes; i++) t += song->notes[i][1] * ms_per_32;
    return t;
}

void playlist_init(playlist_t *pl, const song_t *songs, int n, float articulation) {
    pl->songs = songs; pl->n = n; pl->articulation = articulation; pl->index = 0;
}

const song_t *playlist_next(playlist_t *pl, events_t *out) {
    if (pl->n <= 0) return NULL;
    const song_t *s = &pl->songs[pl->index];
    pl->index = (pl->index + 1) % pl->n;
    melody_events(out, s, pl->articulation);
    return s;
}
