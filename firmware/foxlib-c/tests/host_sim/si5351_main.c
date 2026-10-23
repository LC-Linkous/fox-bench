/* SPDX-License-Identifier: GPL-3.0-or-later
 * si5351_sim: the real si5351.c against a fake I2C controller holding a register image of the chip. For each
 * frequency on the command line: the divider, PLL multiplier, registers 26..33 as written, the carrier the
 * registers encode, the deviation counts, and what one FM offset write touched. si5351_ref.py recomputes all of
 * it from the datasheet's formulas and compares.
 *   si5351_sim [--ppm P] [--fail-write N] hz1 hz2 ...        (--fail-write N: the Nth write times out → recover()) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "si5351.h"

uint64_t sim_now_us;
static i2c_hw_t hw0; static i2c_inst_t inst0 = { &hw0, false }; i2c_inst_t *i2c0 = &inst0;
static uint8_t regs[256]; static int writes, fail_at, inits, deinits; static unsigned char last_reg; static int last_len;
static struct { uint8_t reg; int len; } wlog[64]; static int nlog;

static int abort_stuck, spins;   /* --stuck-abort: the controller never finishes the abort → si5351.c must clear the bus and re-init */
void sim_spin(void) { if (!abort_stuck && ++spins >= 20) { hw0.enable &= ~I2C_IC_ENABLE_ABORT_BITS; spins = 0; } }   /* a real abort completes within a few µs */
int i2c_write_timeout_us(i2c_inst_t *i2c, uint8_t addr, const uint8_t *src, size_t len, bool nostop, uint32_t timeout_us) {
    (void)i2c; (void)nostop; (void)timeout_us; if (addr != 0x60) return -1;
    writes++;
    if (writes == fail_at) return -2;                    /* PICO_ERROR_TIMEOUT: core 1 parked mid-transfer */
    if (len >= 2) { for (size_t i = 1; i < len; i++) regs[(src[0] + i - 1) & 0xFF] = src[i]; last_reg = src[0]; last_len = (int)len - 1; if (nlog < 64) { wlog[nlog].reg = src[0]; wlog[nlog].len = (int)len - 1; nlog++; } }
    else last_reg = src[0];
    return (int)len;
}
int i2c_read_timeout_us(i2c_inst_t *i2c, uint8_t addr, uint8_t *dst, size_t len, bool nostop, uint32_t timeout_us) {
    (void)i2c; (void)nostop; (void)timeout_us; if (addr != 0x60) return -1;
    for (size_t i = 0; i < len; i++) dst[i] = regs[(last_reg + i) & 0xFF];
    return (int)len;
}
uint i2c_init(i2c_inst_t *i2c, uint baud) { (void)i2c; inits++; return baud; }
void i2c_deinit(i2c_inst_t *i2c) { (void)i2c; deinits++; }

static void hexregs(int from, int n) { printf("\""); for (int i = 0; i < n; i++) printf("%02x", regs[from + i]); printf("\""); }

int main(int argc, char **argv) {
    double ppm = 0; int i = 1;
    for (; i < argc; i++) { if (!strcmp(argv[i], "--ppm")) ppm = atof(argv[++i]); else if (!strcmp(argv[i], "--fail-write")) fail_at = atoi(argv[++i]); else if (!strcmp(argv[i], "--stuck-abort")) abort_stuck = 1; else break; }
    regs[0] = 0x00;                                       /* SYS_INIT clear: the chip answers */
    bool ok = si5351_init(i2c0, 25e6, 4, 5);
    si5351_set_correction_ppm(ppm);
    printf("{\"init\":%d,\"init_writes\":%d,\"reg3\":%d,\"reg16\":%d,\"reg183\":%d,\"ms0\":", ok, writes, regs[3], regs[16], regs[183]); hexregs(42, 8);
    printf(",\"carriers\":[");
    for (int k = 0; i < argc; i++, k++) {
        double hz = atof(argv[i]);
        nlog = 0; int w0 = writes;
        bool set = si5351_set_carrier(hz);
        int set_writes = writes - w0; nlog = 0; w0 = writes;
        uint32_t counts = si5351_counts_for_deviation(2500.0);
        si5351_set_offset((int32_t)counts);               /* one FM sample at +2.5 kHz */
        int off_reg = nlog ? wlog[0].reg : -1, off_len = nlog ? wlog[0].len : 0, off_writes = writes - w0;
        si5351_set_offset((int32_t)counts);               /* same value again: must not touch the bus */
        int repeat_writes = writes - w0 - off_writes;
        si5351_set_offset(0);
        printf("%s{\"hz\":%.1f,\"ok\":%d,\"div\":%u,\"carrier\":%.3f,\"counts\":%u,\"set_writes\":%d,\"pll\":", k ? "," : "", hz, set, si5351_divider_for(hz), si5351_carrier_hz(), counts, set_writes); hexregs(26, 8);
        printf(",\"ms0\":"); hexregs(42, 8);
        printf(",\"offset_write\":[%d,%d],\"offset_writes\":%d,\"repeat_writes\":%d,\"out_enabled\":%d}", off_reg, off_len, off_writes, repeat_writes, (regs[3] & 1) == 0);
    }
    printf("],\"bus_errors\":%u,\"i2c_reinits\":%d,\"total_writes\":%d}\n", si5351_bus_errors(), inits, writes);
    return 0;
}
