/* SPDX-License-Identifier: GPL-3.0-or-later */
/* host stub for "pico.h": the few SDK basics the headers under picofox/ pull in */
#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef unsigned int uint;
void sim_spin(void);   /* each harness: what the "hardware" does while the firmware spin-waits (e.g. an I2C abort completing) */
static inline void tight_loop_contents(void) { extern uint64_t sim_now_us; sim_now_us += 1; sim_spin(); }   /* a spin-wait passes virtual time, so a timeout loop ends */
static inline void busy_wait_us(uint64_t us) { extern uint64_t sim_now_us; sim_now_us += us; }
