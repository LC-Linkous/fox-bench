/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include "pico.h"
enum { GPIO_FUNC_I2C = 3, GPIO_FUNC_SIO = 5 };
static inline void gpio_set_function(uint pin, int f) { (void)pin; (void)f; }
static inline void gpio_set_dir(uint pin, bool out) { (void)pin; (void)out; }
static inline void gpio_pull_up(uint pin) { (void)pin; }
static inline void gpio_put(uint pin, int v) { (void)pin; (void)v; }
static inline bool gpio_get(uint pin) { (void)pin; return true; }
