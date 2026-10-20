/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/sstv.h -- Robot 36 (grayscale) SSTV as a streamed event source; images.bin index.
 * Twin of foxlib/sstv.py. An image is ~10 800 events, too many for an events_t, so the
 * generator produces them one at a time for the synth (synth_prepare_src). */
#ifndef FOXLIBC_SSTV_H
#define FOXLIBC_SSTV_H
#include <stdbool.h>
#include <stdint.h>
#include "events.h"

#define SSTV_PIXELS_PER_LINE 40
#define SSTV_LINES 240
#define SSTV_VIS 8
#define SSTV_F_SYNC 1200
#define SSTV_F_BLACK 1500
#define SSTV_F_WHITE 2300
#define SSTV_F_LEADER 1900
#define SSTV_F_BIT0 1300
#define SSTV_F_BIT1 1100
#define SSTV_MAX_IMAGES 16
#define SSTV_MAX_PIXELS (255 * 255)

typedef struct {
    const uint8_t *px; int w, h;
    int phase;              /* 0 = VIS, 1 = lines, 2 = done */
    int step;               /* VIS step index, or line sub-step */
    int line, col;          /* current line; column where the next run starts */
    int ones;               /* VIS parity */
} sstv_gen_t;

typedef struct { char name[33]; int w, h; uint32_t offset; } sstv_entry_t;   /* offset of the pixel bytes in images.bin */

void sstv_init(sstv_gen_t *g, const uint8_t *pixels, int w, int h);
bool sstv_next(sstv_gen_t *g, event_t *out);          /* false when the image is finished */
double sstv_duration_ms(void);                        /* same for every image */
float sstv_pixel_hz(uint8_t v);
void sstv_test_card(uint8_t *px, int w, int h);       /* the firmware's fallback image */

/* Parse the images.bin header into entries by reading small pieces through `rd` (returns bytes read, <0 on error).
 * Returns the number of images (0 when the file is missing or malformed: caller uses the test card). */
typedef long (*sstv_read_fn)(void *ctx, uint32_t off, void *buf, uint32_t n);
int sstv_index(sstv_read_fn rd, void *ctx, sstv_entry_t *out, int max);

#endif
