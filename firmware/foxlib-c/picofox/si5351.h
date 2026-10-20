/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef SI5351_H
#define SI5351_H
#include <stdbool.h>
#include <stdint.h>
#include "hardware/i2c.h"

bool si5351_init(i2c_inst_t *i2c, double ref_hz);      /* false when the chip does not answer */
bool si5351_present(void);
uint32_t si5351_divider_for(double hz);
bool si5351_set_carrier(double hz);                     /* nominal carrier; resets PLLA */
double si5351_carrier_hz(void);                         /* what the registers actually hold */
uint32_t si5351_counts_for_deviation(double dev_hz);    /* fraction counts for a given output deviation */
void si5351_set_offset(int32_t counts);                 /* FM: carrier + counts (one short I2C write) */
void si5351_output(bool on);                            /* CLK0 output enable */
void si5351_drive(uint8_t ma);                          /* 2, 4, 6, 8 mA */
int si5351_status(void);                                /* register 0, or -1 */
#endif
