/* SPDX-License-Identifier: GPL-3.0-or-later
 * si5351 -- the PicoFox exciter: Si5351A, 25 MHz TCXO on XA, CLK0 to the RF chain.
 *
 * Frequency plan (docs/picofox-hardware.md): MultiSynth0 is an even integer
 * divider (6 for 2 m) in integer mode; PLLA = 25 MHz x (a + b/c), c = 2^20 - 1.
 * Fine tuning and FM are done by rewriting the PLLA fraction only (registers
 * 28..33: P1 and P2; P3 = c never changes), ~4 Hz resolution at the output.
 * Register map and parameter encoding per the Si5351 datasheet / AN619. */
#include "si5351.h"
#include <string.h>
#include "hardware/gpio.h"
#include "hardware/i2c.h"
#include "pico/time.h"

#define ADDR 0x60
#define C_DEN 1048575u    /* 2^20 - 1 */

static i2c_inst_t *bus;
static double xtal_hz = 25e6;
static uint32_t out_div = 6;
static uint32_t pll_a, pll_b;          /* nominal PLL multiplier a + b/c for the current carrier */
static bool present;
static uint8_t last_regs[6];

static bool wr(uint8_t reg, const uint8_t *data, int n) {
    uint8_t buf[12]; buf[0] = reg; memcpy(buf + 1, data, (size_t)n);
    return i2c_write_timeout_us(bus, ADDR, buf, n + 1, false, 2000) == n + 1;
}
static bool wr1(uint8_t reg, uint8_t v) { return wr(reg, &v, 1); }
static int rd1(uint8_t reg) {
    uint8_t v;
    if (i2c_write_timeout_us(bus, ADDR, &reg, 1, true, 2000) != 1) return -1;
    if (i2c_read_timeout_us(bus, ADDR, &v, 1, false, 2000) != 1) return -1;
    return v;
}

static void encode(uint32_t a, uint32_t b, uint32_t c, uint8_t out[8]) {
    uint32_t q = (128u * b) / c;
    uint32_t p1 = 128u * a + q - 512u, p2 = 128u * b - c * q, p3 = c;
    out[0] = (uint8_t)(p3 >> 8); out[1] = (uint8_t)p3;
    out[2] = (uint8_t)((p1 >> 16) & 3); out[3] = (uint8_t)(p1 >> 8); out[4] = (uint8_t)p1;
    out[5] = (uint8_t)(((p3 >> 12) & 0xF0) | ((p2 >> 16) & 0x0F)); out[6] = (uint8_t)(p2 >> 8); out[7] = (uint8_t)p2;
}

bool si5351_init(i2c_inst_t *i2c, double ref_hz) {
    bus = i2c; xtal_hz = ref_hz; present = false;
    /* wait for SYS_INIT to clear (reg 0 bit 7), up to 100 ms */
    for (int i = 0; i < 20; i++) { int s = rd1(0); if (s >= 0 && !(s & 0x80)) { present = true; break; } sleep_ms(5); }
    if (!present) return false;
    wr1(3, 0xFF);                                   /* all outputs disabled */
    for (uint8_t r = 16; r <= 23; r++) wr1(r, 0x80); /* all drivers powered down */
    wr1(183, 0x52);                                 /* XTAL_CL: 6 pF (external CMOS reference on XA) */
    wr1(15, 0x00);                                  /* PLLA/PLLB from XTAL input */
    wr1(149, 0x00);                                 /* spread spectrum off */
    /* MS0 = integer 6 (set again by si5351_set_carrier when the divider changes) */
    uint8_t ms[8]; encode(out_div, 0, 1, ms); wr(42, ms, 8);
    wr1(16, 0x4C);                                  /* CLK0: powered, MS0 integer mode, PLLA, MS0 source, 2 mA */
    wr1(177, 0xA0);                                 /* reset both PLLs */
    return true;
}

bool si5351_present(void) { return present; }

uint32_t si5351_divider_for(double hz) {
    /* even integer divider keeping the VCO in 600..900 MHz, as low a VCO as allowed */
    uint32_t d = (uint32_t)(900e6 / hz); if (d & 1) d--; if (d < 6) d = 6; if (d > 254) d = 254;
    while (hz * d < 600e6 && d < 254) d += 2;
    return d;
}

bool si5351_set_carrier(double hz) {
    if (!present) return false;
    uint32_t d = si5351_divider_for(hz);
    double mult = hz * d / xtal_hz;
    if (mult < 15 || mult > 90) return false;
    bool div_changed = d != out_div;
    out_div = d;
    pll_a = (uint32_t)mult;
    pll_b = (uint32_t)((mult - pll_a) * C_DEN + 0.5);
    if (pll_b >= C_DEN) { pll_b = 0; pll_a++; }
    uint8_t regs[8]; encode(pll_a, pll_b, C_DEN, regs);
    wr(26, regs, 8);
    memcpy(last_regs, regs + 2, 6);
    if (div_changed) { uint8_t ms[8]; encode(out_div, 0, 1, ms); wr(42, ms, 8); }
    wr1(177, 0x20);                                 /* PLLA reset after an integer-part / divider change */
    return true;
}

double si5351_carrier_hz(void) { return xtal_hz * (pll_a + (double)pll_b / C_DEN) / out_div; }

uint32_t si5351_counts_for_deviation(double dev_hz) {
    /* output deviation dev -> VCO deviation dev*div -> fraction dev*div/xtal -> counts of 1/c */
    return (uint32_t)(dev_hz * out_div / xtal_hz * C_DEN + 0.5);
}

void si5351_set_offset(int32_t counts) {
    int64_t b = (int64_t)pll_b + counts; uint32_t a = pll_a;
    while (b < 0) { b += C_DEN; a--; }
    while (b >= (int64_t)C_DEN) { b -= C_DEN; a++; }
    uint8_t regs[8]; encode(a, (uint32_t)b, C_DEN, regs);
    /* only P1/P2 change: write registers 28..33 (6 bytes). Skip the bus when nothing changed. */
    if (!memcmp(last_regs, regs + 2, 6)) return;
    memcpy(last_regs, regs + 2, 6);
    wr(28, regs + 2, 6);
}

void si5351_output(bool on) {
    if (!present) return;
    wr1(3, on ? 0xFE : 0xFF);     /* bit 0 = CLK0 output disable */
}

void si5351_drive(uint8_t ma) {
    uint8_t v = 0x4C | (ma >= 8 ? 3 : ma >= 6 ? 2 : ma >= 4 ? 1 : 0);
    wr1(16, v);
}

int si5351_status(void) { return rd1(0); }
