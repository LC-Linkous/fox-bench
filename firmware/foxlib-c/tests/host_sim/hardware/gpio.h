/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include "pico.h"
enum { GPIO_FUNC_I2C = 3, GPIO_FUNC_SIO = 5 };
/* player_sim records what the firmware does to the pins by defining these; every other harness gets the weak
 * defaults (writes ignored, reads high) */
void sim_gpio_put(uint pin, int v) __attribute__((weak));
bool sim_gpio_get(uint pin) __attribute__((weak));
static inline void gpio_init(uint pin) { (void)pin; }
static inline void gpio_set_function(uint pin, int f) { (void)pin; (void)f; }
static inline void gpio_set_dir(uint pin, bool out) { (void)pin; (void)out; }
static inline void gpio_pull_up(uint pin) { (void)pin; }
static inline void gpio_pull_down(uint pin) { (void)pin; }
static inline void gpio_put(uint pin, int v) { if (sim_gpio_put) sim_gpio_put(pin, v); }
static inline bool gpio_get(uint pin) { return sim_gpio_get ? sim_gpio_get(pin) : true; }
