/* SPDX-License-Identifier: GPL-3.0-or-later */
/* host stub for the SDK's I2C: a fake controller with a register image of the Si5351 (si5351_sim) */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "pico.h"
typedef struct { volatile uint32_t enable, clr_tx_abrt, clr_intr; } i2c_hw_t;
typedef struct i2c_inst { i2c_hw_t *hw; bool restart_on_next; } i2c_inst_t;
#define I2C_IC_ENABLE_ABORT_BITS 2u
extern i2c_inst_t *i2c0;
int i2c_write_timeout_us(i2c_inst_t *i2c, uint8_t addr, const uint8_t *src, size_t len, bool nostop, uint32_t timeout_us);
int i2c_read_timeout_us(i2c_inst_t *i2c, uint8_t addr, uint8_t *dst, size_t len, bool nostop, uint32_t timeout_us);
uint i2c_init(i2c_inst_t *i2c, uint baud);
void i2c_deinit(i2c_inst_t *i2c);
