/* SPDX-License-Identifier: GPL-3.0-or-later
 * console.c -- see console.h. A reader task collects lines from stdin (the USB-Serial-JTAG driver blocks nicely);
 * the main task runs them from con_poll(), so everything that touches the radio runs on one task. A `put` switches the
 * reader into body mode until the `.` line (core/filexfer). */
#include "console.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "filexfer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "fs.h"
#include "netfox.h"

#define CON_LINE_MAX 160   /* (LINE_MAX is taken by the toolchain's <sys/syslimits.h>) */
static QueueHandle_t lines;              /* complete command lines, reader -> main */
static SemaphoreHandle_t out_lock;
static const char *reset_reason = "?";
static xfer_put_t put;   /* the body lands in the fox's file buffer (netfox_filebuf): no second 16 KB */
bool con_file_busy(void) { return put.active; }
static const char VERSION_TAG[] = "FOXLIBC-VERSION:" FOXLIBC_VERSION;

void con_set_reset_reason(const char *why) { reset_reason = why; }
void con_puts(const char *s) { if (out_lock) xSemaphoreTake(out_lock, portMAX_DELAY); fputs(s, stdout); fflush(stdout); if (out_lock) xSemaphoreGive(out_lock); }
void con_printf(const char *fmt, ...) { char buf[400]; va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap); con_puts(buf); }
void con_flush(void) { fflush(stdout); vTaskDelay(pdMS_TO_TICKS(50)); }

static void help(void) {
    con_puts("fox-bench ESP32 console\r\n"
             "  status            banner line, uptime, reset reason, files\r\n"
             "  key <s>           radio up for s seconds (max 60): the Bench tab's Radio up\r\n"
             "  scan              what the radio hears: -dBm ch<n> name\r\n"
             "  health            the board's numbers as JSON\r\n"
             "  files | put <name> <size> | get <name> | rm <name>\r\n"
             "  reload | stop | uid | version | reboot\r\n");
}
static void status(void) {
    char b[512]; con_puts(netfox_banner_line(b, sizeof b)); con_puts("\r\n");
    con_printf("uptime=%lus reset=%s version=%s radio=%s on_air=%d\r\n", (unsigned long)(esp_timer_get_time() / 1000000), reset_reason, FOXLIBC_VERSION, netfox_radio_status(), netfox_on_air() ? 1 : 0);
    char files[256]; fs_list(files, sizeof files); con_printf("files: %s\r\n", files);
}
static void emit(void *ctx, const char *text) { (void)ctx; con_puts(text); }

static void dispatch(char *cmd) {
    char *arg = strchr(cmd, ' '); if (arg) { *arg++ = 0; while (*arg == ' ') arg++; }
    if (!strcmp(cmd, "help") || !strcmp(cmd, "?")) { help(); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "status")) { status(); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "uid")) con_printf("uid=%s\r\nok\r\n", netfox_uid());
    else if (!strcmp(cmd, "version")) con_printf("foxlib-c %s board=%s\r\nok\r\n", VERSION_TAG + 16, BOARD_ID);
    else if (!strcmp(cmd, "files")) { char files[256]; fs_list(files, sizeof files); con_printf("%s\r\nok\r\n", files); }
    else if (!strcmp(cmd, "health")) { char b[200]; netfox_health_json(b, sizeof b); con_printf("%s\r\nok\r\n", b); }
    else if (!strcmp(cmd, "key")) { double s = arg ? atof(arg) : 2; if (s <= 0 || s > 60) con_puts("err: 0 < s <= 60\r\n"); else if (!netfox_bench_key((uint32_t)(s * 1000))) con_puts("err: no usable configuration\r\n"); }   /* the ok comes when the radio is down again */
    else if (!strcmp(cmd, "scan")) { if (netfox_bench_scan()) con_puts("ok\r\n"); else con_puts("err: scan failed\r\n"); }
    else if (!strcmp(cmd, "stop")) { netfox_bench_stop(); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "reload")) { netfox_reload("console"); con_puts("ok\r\n"); }
    else if (!strcmp(cmd, "reboot")) { con_puts("ok\r\n"); con_flush(); esp_restart(); }
    else if (!strcmp(cmd, "get")) {
        if (!xfer_name_ok(arg ? arg : "")) { con_puts("err: refused name\r\n"); return; }
        size_t cap; char *buf = netfox_filebuf(&cap);
        long n = fs_read(arg, buf, cap);
        if (n < 0) { con_puts("err: no such file\r\n"); return; }
        xfer_get_emit((const uint8_t *)buf, (size_t)n, emit, NULL); con_puts("ok\r\n");
    }
    else if (!strcmp(cmd, "rm")) { if (!xfer_name_ok(arg ? arg : "")) con_puts("err: refused name\r\n"); else if (fs_remove(arg)) { con_puts("ok\r\n"); if (!strcmp(arg, "fox.json") || !strcmp(arg, "defaults.json")) netfox_schedule_reload(1000); } else con_puts("err: no such file\r\n"); }
    else if (!strcmp(cmd, "put")) {
        char *sz = arg ? strchr(arg, ' ') : NULL; if (sz) *sz++ = 0;
        long n = sz ? atol(sz) : -1;
        if (!xfer_name_ok(arg ? arg : "")) { con_puts("err: refused name\r\n"); return; }
        size_t cap; uint8_t *buf = (uint8_t *)netfox_filebuf(&cap); if (cap > XFER_MAX_FILE) cap = XFER_MAX_FILE;
        if (n < 0 || n > (long)cap) { con_printf("err: put <name> <size 0-%u>\r\n", (unsigned)cap); return; }
        xfer_put_begin(&put, arg, (size_t)n, buf, cap);
        con_puts("send\r\n");
    }
    else if (*cmd) con_printf("err: unknown command '%s' (help)\r\n", cmd);
}

static void put_done(void) {
    if (put.bad) { con_puts("err: bad base64\r\n"); return; }
    if (put.overflow || put.n != put.expect) { con_printf("err: got %u bytes, put said %u\r\n", (unsigned)put.n, (unsigned)put.expect); return; }
    if (!fs_write(put.name, put.buf, put.n)) { con_printf("err: write failed (%s)\r\n", fs_error()); return; }
    con_printf("ok size=%u crc32=%08x\r\n", (unsigned)put.n, (unsigned)xfer_crc32(put.buf, put.n));
    if (!strcmp(put.name, "fox.json") || !strcmp(put.name, "defaults.json")) netfox_schedule_reload(1000);
}

static void reader(void *arg) {
    /* Bytes straight from the USB-Serial-JTAG driver (not stdin: the VFS route depends on the console choice in
     * sdkconfig and on line-ending conversion, and the first C3 session got no reply to `version` through it). */
    (void)arg;
    static char line[CON_LINE_MAX]; static unsigned n; uint8_t buf[64];
    for (;;) {
        int got = usb_serial_jtag_read_bytes(buf, sizeof buf, pdMS_TO_TICKS(20));
        for (int i = 0; i < got; i++) {
            int c = buf[i];
            if (c == '\r' || c == '\n') { if (n || put.active) { line[n] = 0; n = 0; char *copy = strdup(line); if (copy) xQueueSend(lines, &copy, portMAX_DELAY); } }
            else if (c == 3) { char *copy = strdup("\x03"); if (copy) xQueueSend(lines, &copy, portMAX_DELAY); n = 0; }
            else if (c == 8 || c == 127) { if (n) n--; }
            else if (n < CON_LINE_MAX - 1 && c >= 32) line[n++] = (char)c;
        }
    }
}

void con_init(void) {
    usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    cfg.rx_buffer_size = 1024; cfg.tx_buffer_size = 2048;   /* a put's base64 lines arrive faster than the fox reads them; a `get` answers a file at once */
    usb_serial_jtag_driver_install(&cfg);
    usb_serial_jtag_vfs_use_driver();                       /* printf (the banner, log, replies) through the driver, so it does not block when no host reads */
    setvbuf(stdout, NULL, _IONBF, 0);
    out_lock = xSemaphoreCreateMutex();
    lines = xQueueCreate(8, sizeof(char *));
    xTaskCreate(reader, "console", 4096, NULL, 5, NULL);
}

void con_poll(void) {
    char *line;
    while (xQueueReceive(lines, &line, 0) == pdTRUE) {
        if (put.active) { if (xfer_put_line(&put, line)) put_done(); }
        else if (line[0] == 3) { netfox_bench_stop(); con_puts("^C\r\nok\r\n"); }
        else dispatch(line);
        free(line);
    }
}
