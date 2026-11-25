/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/filexfer.c -- see filexfer.h. */
#include "filexfer.h"
#include <stdio.h>
#include <string.h>

uint32_t xfer_crc32(const void *data, size_t n) {
    const uint8_t *p = data; uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) { c ^= p[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u))); }
    return c ^ 0xFFFFFFFFu;
}

bool xfer_name_ok(const char *name) {
    if (!name || !*name || strlen(name) > 30) return false;
    if (!strcmp(name, "fox.json") || !strcmp(name, "defaults.json")) return true;
    size_t n = strlen(name); if (n < 5 || strcmp(name + n - 4, ".bin")) return false;
    for (const char *c = name; *c; c++) if (!((*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9') || *c == '_' || *c == '-' || *c == '.')) return false;
    return name[0] != '.';
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static int b64val(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

void xfer_put_begin(xfer_put_t *p, const char *name, size_t expect, uint8_t *buf, size_t cap) {
    memset(p, 0, sizeof *p); strncpy(p->name, name, sizeof p->name - 1); p->expect = expect; p->buf = buf; p->cap = cap; p->active = true;
}

bool xfer_put_line(xfer_put_t *p, const char *line) {
    if (!p->active) return false;
    if (!strcmp(line, ".")) { p->active = false; return true; }
    for (const char *c = line; *c; c++) {
        if (*c == '=' || *c == ' ' || *c == '\r') continue;
        int v = b64val(*c); if (v < 0) { p->bad = true; continue; }
        p->acc = (p->acc << 6) | (uint32_t)v; p->acc_bits += 6;
        if (p->acc_bits >= 8) { p->acc_bits -= 8; uint8_t b = (uint8_t)(p->acc >> p->acc_bits); p->acc &= (1u << p->acc_bits) - 1u; if (p->n < p->cap) p->buf[p->n++] = b; else p->overflow = true; }
    }
    return false;
}

void xfer_get_emit(const uint8_t *data, size_t n, void (*emit)(void *ctx, const char *text), void *ctx) {
    char head[48]; snprintf(head, sizeof head, "size=%u crc32=%08x\r\n", (unsigned)n, (unsigned)xfer_crc32(data, n));
    emit(ctx, head);
    char line[XFER_LINE + 3]; int o = 0;
    for (size_t i = 0; i < n; i += 3) {
        uint32_t v = (uint32_t)data[i] << 16 | (i + 1 < n ? (uint32_t)data[i + 1] << 8 : 0) | (i + 2 < n ? data[i + 2] : 0);
        line[o++] = B64[(v >> 18) & 63]; line[o++] = B64[(v >> 12) & 63];
        line[o++] = i + 1 < n ? B64[(v >> 6) & 63] : '='; line[o++] = i + 2 < n ? B64[v & 63] : '=';
        if (o >= XFER_LINE) { line[o++] = '\r'; line[o++] = '\n'; line[o] = 0; emit(ctx, line); o = 0; }
    }
    if (o) { line[o++] = '\r'; line[o++] = '\n'; line[o] = 0; emit(ctx, line); }
    emit(ctx, ".\r\n");
}
