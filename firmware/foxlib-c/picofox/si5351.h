/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef SI5351_H
#define SI5351_H
#include <stdbool.h>
#include <stdint.h>
#include "hardware/i2c.h"

bool si5351_init(i2c_inst_t *i2c, double ref_hz, unsigned sda, unsigned scl);   /* outputs off first, then setup; false when the chip does not answer */
void si5351_bus_clear(unsigned sda, unsigned scl);              /* 9 clocks + STOP with the pins as GPIO, before i2c_init */
uint32_t si5351_bus_errors(void);                       /* writes that timed out (each followed by a controller abort / bus clear) */
bool si5351_present(void);
uint32_t si5351_divider_for(double hz);
bool si5351_set_carrier(double hz);                     /* nominal carrier; resets PLLA */
double si5351_carrier_hz(void);                         /* what the registers actually hold */
uint32_t si5351_counts_for_deviation(double dev_hz);    /* fraction counts for a given output deviation */
void si5351_set_offset(int32_t counts);                 /* FM: carrier + counts (one short I2C write) */
bool si5351_output(bool on);                            /* CLK0 output enable; false when the write failed */
void si5351_drive(uint8_t ma);                          /* 2, 4, 6, 8 mA */
int si5351_status(void);                                /* register 0, or -1 */
#endif
