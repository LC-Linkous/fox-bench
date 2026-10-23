/* SPDX-License-Identifier: GPL-3.0-or-later */
/* host stub for TinyUSB's CDC: a scripted input queue and an output capture, driven by console_main.c */
#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef struct { uint32_t bit_rate; uint8_t stop_bits, parity, data_bits; } cdc_line_coding_t;
bool tud_cdc_connected(void);
uint32_t tud_cdc_available(void);
int32_t tud_cdc_read_char(void);
uint32_t tud_cdc_write_available(void);
uint32_t tud_cdc_write(const void *buf, uint32_t n);
uint32_t tud_cdc_write_flush(void);
