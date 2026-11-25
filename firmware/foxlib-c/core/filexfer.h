/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/filexfer.h -- files over the console (PROTOCOL.md "Files over the console"): base64 in lines of up to
 * 76 characters, a `.` line ends the body, `size=<n> crc32=<hex8>` verifies it. Shared by the PicoFox and ESP32
 * consoles; pure, so the host console simulator runs it. */
#ifndef FOXLIBC_FILEXFER_H
#define FOXLIBC_FILEXFER_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define XFER_MAX_FILE 16384            /* fox.json / defaults.json are a few kB; a payload image a few more */
#define XFER_LINE 76

uint32_t xfer_crc32(const void *data, size_t n);
/* Which names may be put / got / removed: fox.json, defaults.json, and <something>.bin (a template's images_file). */
bool xfer_name_ok(const char *name);

/* A put in progress: the console feeds it the body lines; done() says whether the body is complete. */
typedef struct {
    char name[32];
    size_t expect;           /* the size `put` announced */
    uint8_t *buf; size_t cap, n;
    uint32_t acc; int acc_bits;   /* base64 decoder state across lines */
    bool active, overflow, bad;
} xfer_put_t;
void xfer_put_begin(xfer_put_t *p, const char *name, size_t expect, uint8_t *buf, size_t cap);
/* One body line (without its newline). Returns true when this was the `.` terminator: the body is complete in buf/n. */
bool xfer_put_line(xfer_put_t *p, const char *line);

/* Encoding for `get`: emit(ctx, text) is called with the size line, each base64 line and the `.` line, each with "\r\n". */
void xfer_get_emit(const uint8_t *data, size_t n, void (*emit)(void *ctx, const char *text), void *ctx);

#endif
