/* SPDX-License-Identifier: GPL-3.0-or-later
 * console.c -- see console.h. Output is buffered in a ring so the fox never blocks
 * on a host that is not reading; commands are single lines, replies end with
 * "ok" or "err: ...". The bench commands mirror what the page does over the REPL
 * on CircuitPython boards (PROTOCOL.md, "foxlib-c console"). */
#include "console.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "flash_disk.h"
#include "fox.h"
#include "fs.h"
#include "hardware/watchdog.h"
#include "msc_disk.h"
#include "pico/bootrom.h"
#include "player.h"
#include "tusb.h"

#define OUT_RING 4096
static char ring[OUT_RING];
static volatile unsigned ring_w, ring_r;
static char line[160];
static unsigned line_n;

void con_init(void) { ring_w = ring_r = 0; line_n = 0; }
bool con_connected(void) { return tud_cdc_connected(); }

void con_puts(const char *s) {
    while (*s) {
        unsigned next = (ring_w + 1) % OUT_RING;
        if (next == ring_r) ring_r = (ring_r + 1) % OUT_RING;   /* overrun: drop the oldest */
        ring[ring_w] = *s++; ring_w = next;
    }
}

void con_printf(const char *fmt, ...) {
    char buf[320]; va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
    con_puts(buf);
}

static void pump(void) {
    if (!tud_cdc_connected()) { ring_r = ring_w; return; }   /* nobody listening: keep the ring from filling with stale log */
    while (ring_r != ring_w && tud_cdc_write_available()) {
        unsigned n = ring_w >= ring_r ? ring_w - ring_r : OUT_RING - ring_r;
        unsigned room = tud_cdc_write_available(); if (n > room) n = room;
        tud_cdc_write(ring + ring_r, n);
        ring_r = (ring_r + n) % OUT_RING;
    }
    tud_cdc_write_flush();
}

static void help(void) {
    con_puts("fox-bench PicoFox console\r\n"
             "  status            banner line, revision, charging, drive, files\r\n"
             "  key <s>           unmodulated carrier for s seconds (max 60)\r\n"
             "  tone <hz> <s>     carrier with a tone\r\n"
             "  id                send the ID once now\r\n"
             "  freq <mhz>        retune until the next reload\r\n"
             "  atten <0-127>     attenuator code now (rev 3 boards; dB per step not yet metered)\r\n"
             "  batt              charging state (no voltage sense on this board)\r\n"
             "  files | reload | stop | uid | version | reboot | bootsel\r\n");
}

static const char *reset_reason = "?";
void con_set_reset_reason(const char *why) { reset_reason = why; }

static void status(void) {
    char b[400]; player_status_t ps; player_status(&ps);
    con_puts(fox_banner_line(b, sizeof b)); con_puts("\r\n");
    con_printf("uptime=%lus reset=%s version=%s\r\n", (unsigned long)(to_ms_since_boot(get_absolute_time()) / 1000), reset_reason, FOXLIBC_VERSION);
    con_printf("revision=%d si5351=%s carrier=%.1f keyed=%d attenuation=%d i2c_write_us=%lu i2c_errors=%lu core1=%s correction_ppm=%.1f state=%d\r\n",
               ps.revision, ps.si5351_ok ? "ok" : "absent", ps.carrier_hz, ps.keyed, ps.attenuation, (unsigned long)ps.i2c_write_us, (unsigned long)ps.i2c_errors, ps.core1_alive ? "ok" : "dead", (double)ps.correction_ppm, (int)fox_state());
    con_printf("charging=%s host_drive=%s host_writes=%lu dirty=%d\r\n", player_charging() ? "yes" : "no", msc_host_has_drive() ? "mounted" : "no", (unsigned long)msc_host_writes(), flash_disk_dirty());
    char files[256]; fs_list(files, sizeof files); con_printf("files: %s\r\n", files);
}

static void dispatch(char *cmd) {
    char *arg = strchr(cmd, ' '); if (arg) { *arg++ = 0; while (*arg == ' ') arg++; }
    if (!strcmp(cmd, "help") || !strcmp(cmd, "?")) { help(); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "status")) { status(); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "uid")) { char b[400]; const char *p = strstr(fox_banner_line(b, sizeof b), "uid="); con_printf("%.*s\r\nok\r\n", p ? (int)(strchr(p, ' ') - p) : 0, p ? p : ""); }
    else if (!strcmp(cmd, "version")) { con_printf("foxlib-c %s board=%s\r\nok\r\n", FOXLIBC_VERSION, BOARD_ID); }
    else if (!strcmp(cmd, "batt")) { con_printf("batt charging=%s volts=none note=%s\r\nok\r\n", player_charging() ? "yes" : "no", player_charging() ? "charger_active" : "charger_idle(full_or_no_usb_power)"); }
    else if (!strcmp(cmd, "files")) { char files[256]; fs_list(files, sizeof files); con_printf("%s\r\nok\r\n", files); }
    else if (!strcmp(cmd, "key")) { double s = arg ? atof(arg) : 2; if (s <= 0 || s > 60) con_puts("err: 0 < s <= 60\r\n"); else if (fox_bench_key((uint32_t)(s * 1000))) con_printf("keyed %.1f s\r\n", s); }
    else if (!strcmp(cmd, "tone")) { double hz = arg ? atof(arg) : 0; char *s2 = arg ? strchr(arg, ' ') : NULL; double s = s2 ? atof(s2) : 2;
        if (hz < 50 || hz > 4000 || s <= 0 || s > 60) con_puts("err: tone <50-4000 hz> <s<=60>\r\n"); else if (fox_bench_tone((float)hz, (uint32_t)(s * 1000))) con_printf("tone %.0f Hz %.1f s\r\n", hz, s); }
    else if (!strcmp(cmd, "id")) { fox_bench_id(); }
    else if (!strcmp(cmd, "freq")) { double m = arg ? atof(arg) : 0; if (fox_bench_freq(m)) con_printf("carrier %.4f MHz\r\nok\r\n", m); else con_puts("err: retune\r\n"); }
    else if (!strcmp(cmd, "atten")) { int v = arg ? atoi(arg) : -1; if (v < 0 || v > 127) con_puts("err: 0-127\r\n"); else { player_set_attenuation(v); con_printf("attenuation %d\r\nok\r\n", v); } }
    else if (!strcmp(cmd, "stop")) { fox_bench_stop(); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "reload")) { fox_reload("console"); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "reboot")) { fox_quiesce(); con_puts("ok\r\n"); pump(); flash_disk_flush(); watchdog_reboot(0, 0, 50); }
    else if (!strcmp(cmd, "bootsel")) { fox_quiesce(); con_puts("ok (entering UF2 bootloader: the RPI-RP2 drive appears)\r\n"); pump(); flash_disk_flush(); sleep_ms(50); reset_usb_boot(0, 0); }
    else if (*cmd) con_printf("err: unknown command '%s' (help)\r\n", cmd);
}

/* The Arduino "1200-baud touch": a host that opens the port at 1200 baud and then drops DTR wants the UF2
 * bootloader. The vendor firmware (Arduino core) answers it; so do we, so the two can be swapped from the
 * page on a board whose BOOTSEL button is inside the case. */
static bool touch_armed;
void tud_cdc_line_coding_cb(uint8_t itf, const cdc_line_coding_t *coding) { (void)itf; touch_armed = coding->bit_rate == 1200; }
void tud_cdc_line_state_cb(uint8_t itf, bool dtr, bool rts) {
    (void)itf; (void)rts;
    if (touch_armed && !dtr) { fox_quiesce(); flash_disk_flush(); reset_usb_boot(0, 0); }
}

void con_poll(void) {
    while (tud_cdc_available()) {
        char c = (char)tud_cdc_read_char();
        if (c == '\r' || c == '\n') { if (line_n) { line[line_n] = 0; line_n = 0; dispatch(line); } }
        else if (c == 3) { fox_bench_stop(); con_puts("^C\r\nok\r\n"); line_n = 0; }   /* Ctrl-C from a terminal: stop like a REPL would */
        else if (c == 8 || c == 127) { if (line_n) line_n--; }
        else if (line_n < sizeof line - 1 && c >= 32) line[line_n++] = c;
    }
    pump();
}
