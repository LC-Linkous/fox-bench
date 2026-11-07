/* SPDX-License-Identifier: GPL-3.0-or-later */
/* host stub for "pico.h": the few SDK basics the headers under picofox/ pull in */
#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef unsigned int uint;
#include "boards/picofox.h"   /* the SDK includes the PICO_BOARD header from pico.h; same here */
void sim_spin(void);   /* each harness: what the "hardware" does while the firmware spin-waits (e.g. an I2C abort completing) */
void sim_tick(uint64_t us);   /* passes virtual time; a harness with two "cores" (player_sim) serialises it */
static inline void tight_loop_contents(void) { sim_tick(1); sim_spin(); }   /* a spin-wait passes virtual time, so a timeout loop ends */
static inline void busy_wait_us(uint64_t us) { sim_tick(us); }
