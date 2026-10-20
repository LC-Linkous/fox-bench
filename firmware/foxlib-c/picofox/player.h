/* SPDX-License-Identifier: GPL-3.0-or-later
 * player -- core 1 owns the Si5351 and the amplifier pins. Core 0 sends it
 * commands over the inter-core FIFO: setup, set carrier, key, unkey, set
 * attenuation, play an event stream (FM at the configured sample rate), stop.
 * Playing is asynchronous: the request struct's `done` flips when finished. */
#ifndef PLAYER_H
#define PLAYER_H
#include <stdbool.h>
#include <stdint.h>
#include "events.h"
#include "synth.h"

typedef struct {
    const events_t *ev;
    synth_params_t params;
    int32_t dev_counts;          /* PLL fraction counts at full-scale sample (±32767) */
    uint32_t max_samples;        /* 0 = unlimited; otherwise cut after this many */
    volatile bool done, cut;
    volatile uint32_t played;    /* samples played */
    volatile uint32_t late;      /* samples where the loop missed its deadline by > 1 period */
} play_req_t;

typedef struct {
    bool si5351_ok;
    int revision;                /* 2 or 3 */
    double carrier_hz;
    bool keyed;
    int attenuation;
    uint32_t i2c_write_us;       /* measured time of one fraction write (for the console) */
} player_status_t;

void player_start(void);                        /* launches core 1; blocks until its setup ran */
bool player_set_carrier(double hz);             /* nominal carrier (PLL reset) */
void player_key(bool on);                       /* output enable + amplifier enable together */
void player_set_attenuation(int code);          /* 0..127, rev 3 only */
void player_play(play_req_t *req);              /* starts; poll req->done */
void player_stop(void);                         /* abandon the current stream (req->done set, cut) */
bool player_busy(void);
void player_status(player_status_t *out);
uint32_t player_keyed_ms(void);                 /* ms since key(true), 0 when unkeyed */
bool player_charging(void);                     /* ChgSense low */

#endif
