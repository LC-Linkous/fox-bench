/* SPDX-License-Identifier: GPL-3.0-or-later
 * console_sim: the firmware's console.c (the real command parser and reply text) over fox.c and the host stubs,
 * fed scripted command lines through a stub TinyUSB CDC. Prints one JSON object per command: what the fox wrote
 * back, how far the virtual clock moved, and the side effects (keying, bootloader/reboot requests).
 *   console_sim DIR [--advance-ms N] cmd1 cmd2 ...        (DIR holds fox.json / defaults.json, as for host_sim) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "console.h"
#include "fox.h"
#include "tusb.h"
#include "pico/bootrom.h"
#include "hardware/watchdog.h"
#include "flash_disk.h"

extern uint64_t sim_now_us; extern const char *sim_dir; extern int sim_host_drive, sim_unkeys, sim_charging;
void sim_player_tick(void); int sim_keyed_now(void);
const char *__asan_default_options(void) { return "detect_leaks=0"; }

/* ---- the CDC: input is a string the harness sets; output is captured */
static const char *in_p = ""; static char out_buf[1 << 15]; static size_t out_n; static int connected = 1;
static int bootsel_requests, reboot_requests;
bool tud_cdc_connected(void) { return connected; }
uint32_t tud_cdc_available(void) { return (uint32_t)strlen(in_p); }
int32_t tud_cdc_read_char(void) { return *in_p ? (unsigned char)*in_p++ : -1; }
uint32_t tud_cdc_write_available(void) { return 64; }   /* small, like the real endpoint: the ring must drain in pieces */
uint32_t tud_cdc_write(const void *buf, uint32_t n) { if (out_n + n < sizeof out_buf) { memcpy(out_buf + out_n, buf, n); out_n += n; } return n; }
uint32_t tud_cdc_write_flush(void) { return 0; }
void reset_usb_boot(uint32_t a, uint32_t b) { (void)a; (void)b; bootsel_requests++; }
void watchdog_reboot(uint32_t a, uint32_t b, uint32_t c) { (void)a; (void)b; (void)c; reboot_requests++; }
bool flash_disk_flush(void) { return true; }
bool flash_disk_dirty(void) { return false; }

static void jstr(const char *s, size_t n) { putchar('"'); for (size_t i = 0; i < n; i++) { unsigned char c = (unsigned char)s[i]; if (c == '"' || c == '\\') { putchar('\\'); putchar(c); } else if (c == '\n') fputs("\\n", stdout); else if (c == '\r') fputs("\\r", stdout); else if (c < 32) fputs(" ", stdout); else putchar(c); } putchar('"'); }
static void run_ms(uint64_t ms) { uint64_t end = sim_now_us + ms * 1000; while (sim_now_us < end) { sim_player_tick(); fox_poll(); con_poll(); sim_now_us += 10000; } }

int main(int argc, char **argv) {
    uint64_t advance = 100; int first = 1;
    if (argc < 2) { fprintf(stderr, "console_sim DIR [--advance-ms N] cmd...\n"); return 2; }
    sim_dir = argv[first++];
    if (first < argc && !strcmp(argv[first], "--advance-ms")) { advance = strtoull(argv[first + 1], NULL, 10); first += 2; }
    con_init(); con_set_reset_reason("power_on"); fox_init();
    run_ms(500);                                        /* the boot banner goes out; discard it */
    con_poll(); out_n = 0;
    printf("[");
    for (int i = first; i < argc; i++) {
        char cmdline[200]; snprintf(cmdline, sizeof cmdline, "%s\r", argv[i]);
        in_p = cmdline; out_n = 0; int b0 = bootsel_requests, r0 = reboot_requests; uint64_t t0 = sim_now_us;
        con_poll();                                       /* reads the line, dispatches, pumps */
        run_ms(advance);                                  /* let the fox react (bench actions print as they go) */
        printf("%s{\"cmd\":", i > first ? "," : ""); jstr(argv[i], strlen(argv[i]));
        printf(",\"out\":"); jstr(out_buf, out_n);
        printf(",\"ms\":%.0f,\"keyed\":%d,\"bootsel\":%d,\"reboot\":%d}", (sim_now_us - t0) / 1000.0, sim_keyed_now(), bootsel_requests - b0, reboot_requests - r0);
    }
    printf("]\n");
    return 0;
}
