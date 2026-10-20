/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef FOXLIBC_MELODY_H
#define FOXLIBC_MELODY_H
#include "events.h"

#ifndef SONG_MAX_NOTES
#define SONG_MAX_NOTES 256
#endif
#ifndef PLAYLIST_MAX
#define PLAYLIST_MAX 16
#endif

typedef struct {
    char name[32];
    int tempo;
    int n_notes;
    short notes[SONG_MAX_NOTES][2];   /* [midi, dur32] */
} song_t;

typedef struct { const song_t *songs; int n; float articulation; int index; } playlist_t;

float melody_midi_hz(int note);
void melody_events(events_t *out, const song_t *song, float articulation);
double melody_duration_ms(const song_t *song, float articulation);
void playlist_init(playlist_t *pl, const song_t *songs, int n, float articulation);
const song_t *playlist_next(playlist_t *pl, events_t *out);   /* appends the next song's events; rotates */

#endif
