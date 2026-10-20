/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/sstv.c -- see sstv.h. Event order and timing follow foxlib/sstv.py exactly:
 *   VIS: 1900/300, 1200/10, 1900/300, 1200/30, 7 data bits LSB first (1100 = 1, 1300 = 0) 30 ms each,
 *        even parity bit, 1200/30
 *   line: 1200/9, 1500/3, run-length pixels over 88 ms, 1500 or 2300 /4.5 (even/odd line), 1900/1.5, 1900/44
 *   240 lines; rows past the image height are black. */
#include "sstv.h"
#include <stdlib.h>
#include <string.h>

#define SYNC_MS 9.0f
#define SYNC_PORCH_MS 3.0f
#define Y_MS 88.0f
#define SEP_MS 4.5f
#define PORCH_MS 1.5f
#define CHROMA_MS 44.0f

float sstv_pixel_hz(uint8_t v) { return SSTV_F_BLACK + (SSTV_F_WHITE - SSTV_F_BLACK) * (float)v / 255.0f; }

void sstv_init(sstv_gen_t *g, const uint8_t *pixels, int w, int h) {
    memset(g, 0, sizeof *g); g->px = pixels; g->w = w > 0 ? w : 1; g->h = h; g->phase = 0;
}

static uint8_t pixel(const sstv_gen_t *g, int line, int col) { return line < g->h ? g->px[line * g->w + col] : 0; }

bool sstv_next(sstv_gen_t *g, event_t *e) {
    if (g->phase == 0) {
        int s = g->step++;
        switch (s) {
            case 0: *e = (event_t){ SSTV_F_LEADER, 300 }; return true;
            case 1: *e = (event_t){ SSTV_F_SYNC, 10 }; return true;
            case 2: *e = (event_t){ SSTV_F_LEADER, 300 }; return true;
            case 3: *e = (event_t){ SSTV_F_SYNC, 30 }; return true;
            default: break;
        }
        int bit = s - 4;
        if (bit < 7) { bool one = (SSTV_VIS >> bit) & 1; if (one) g->ones++; *e = (event_t){ one ? SSTV_F_BIT1 : SSTV_F_BIT0, 30 }; return true; }
        if (bit == 7) { *e = (event_t){ (g->ones % 2) ? SSTV_F_BIT1 : SSTV_F_BIT0, 30 }; return true; }
        *e = (event_t){ SSTV_F_SYNC, 30 }; g->phase = 1; g->step = 0; g->line = 0; g->col = 0; return true;
    }
    if (g->phase == 1) {
        if (g->line >= SSTV_LINES) { g->phase = 2; return false; }
        switch (g->step) {
            case 0: g->step = 1; *e = (event_t){ SSTV_F_SYNC, SYNC_MS }; return true;
            case 1: g->step = 2; g->col = 0; *e = (event_t){ 1500, SYNC_PORCH_MS }; return true;
            case 2: {   /* one run of equal pixels */
                uint8_t v = pixel(g, g->line, g->col); int run = 1;
                while (g->col + run < g->w && pixel(g, g->line, g->col + run) == v) run++;
                *e = (event_t){ sstv_pixel_hz(v), Y_MS / (float)g->w * (float)run };
                g->col += run;
                if (g->col >= g->w) g->step = 3;
                return true;
            }
            case 3: g->step = 4; *e = (event_t){ (g->line % 2 == 0) ? 1500 : 2300, SEP_MS }; return true;
            case 4: g->step = 5; *e = (event_t){ SSTV_F_LEADER, PORCH_MS }; return true;
            default: g->step = 0; g->line++; *e = (event_t){ SSTV_F_LEADER, CHROMA_MS }; return true;
        }
    }
    return false;
}

double sstv_duration_ms(void) {
    double line = SYNC_MS + SYNC_PORCH_MS + Y_MS + SEP_MS + PORCH_MS + CHROMA_MS, header = 300 + 10 + 300 + 30 + 7 * 30 + 30 + 30;
    return header + SSTV_LINES * line;
}

void sstv_test_card(uint8_t *px, int w, int h) {
    int band = h / 3;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        int v;
        if (y < band) v = 255 * x / (w - 1);
        else if (y < 2 * band) v = ((x / 4 + y / 4) % 2) ? 255 : 0;
        else { int yy = y - 2 * band, span = h - 2 * band; int d1 = abs(x * span - yy * w), d2 = abs(x * span - (span - yy) * w); v = (d1 < d2 ? d1 : d2) < 2 * span ? 255 : 0; }
        px[y * w + x] = (uint8_t)v;
    }
}

int sstv_index(sstv_read_fn rd, void *ctx, sstv_entry_t *out, int max) {
    uint8_t hdr[3 + 255]; uint32_t off = 0;
    if (rd(ctx, 0, hdr, 1) != 1) return 0;
    int count = hdr[0]; off = 1;
    int n = 0;
    for (int i = 0; i < count && n < max; i++) {
        if (rd(ctx, off, hdr, 3) != 3) return n;
        int w = hdr[0], h = hdr[1], nl = hdr[2];
        if (w < 1 || h < 1) return n;
        if (nl && rd(ctx, off + 3, hdr + 3, (uint32_t)nl) != nl) return n;
        memcpy(out[n].name, hdr + 3, (size_t)(nl > 32 ? 32 : nl)); out[n].name[nl > 32 ? 32 : nl] = 0;
        out[n].w = w; out[n].h = h; out[n].offset = off + 3 + (uint32_t)nl;
        off = out[n].offset + (uint32_t)(w * h);
        n++;
    }
    return n;
}
