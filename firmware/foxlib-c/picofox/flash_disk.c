/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "flash_disk.h"
#include "player.h"
#include <string.h>
#include "hardware/flash.h"
#include "hardware/sync.h"
#include "pico/flash.h"
#include "pico/time.h"

#define SECTOR FLASH_SECTOR_SIZE   /* 4096 */

static uint8_t cache[SECTOR] __attribute__((aligned(4)));
static uint32_t cache_sector = 0xFFFFFFFFu;   /* flash offset of the cached sector, or none */
static bool dirty;
static uint32_t last_write_ms, n_writes;

static const uint8_t *xip(uint32_t flash_off) { return (const uint8_t *)(XIP_BASE + flash_off); }

void flash_disk_init(void) { cache_sector = 0xFFFFFFFFu; dirty = false; }

typedef struct { uint32_t off; const uint8_t *data; } prog_t;
static void do_program(void *arg) {
    const prog_t *p = arg;
    flash_range_erase(p->off, SECTOR);
    flash_range_program(p->off, p->data, SECTOR);
}

bool flash_disk_flush(void) {
    if (!dirty) return true;
    /* skip the erase/program when the flash already holds these bytes (host rewrites of identical sectors) */
    if (!memcmp(xip(cache_sector), cache, SECTOR)) { dirty = false; return true; }
    prog_t p = { cache_sector, cache };
    player_bus_hold();                       /* core 1 off the I2C bus before it is parked */
    int rc = flash_safe_execute(do_program, &p, 2000);
    player_bus_release();
    if (rc != PICO_OK) return false;
    dirty = false;
    return true;
}

static bool load_sector(uint32_t sector_off) {
    if (cache_sector == sector_off) return true;
    if (!flash_disk_flush()) return false;
    memcpy(cache, xip(sector_off), SECTOR);
    cache_sector = sector_off;
    return true;
}

bool flash_disk_read(uint32_t lba, uint32_t offset, void *buf, uint32_t len) {
    uint32_t off = FLASH_DISK_OFFSET + lba * FLASH_DISK_BLOCK + offset;
    if (lba >= FLASH_DISK_BLOCKS || off + len > PICO_FLASH_SIZE_BYTES) return false;
    uint8_t *out = buf;
    while (len) {
        uint32_t sec = off & ~(SECTOR - 1), in = off - sec, n = SECTOR - in; if (n > len) n = len;
        if (cache_sector == sec) memcpy(out, cache + in, n); else memcpy(out, xip(off), n);
        out += n; off += n; len -= n;
    }
    return true;
}

bool flash_disk_write(uint32_t lba, uint32_t offset, const void *buf, uint32_t len) {
    uint32_t off = FLASH_DISK_OFFSET + lba * FLASH_DISK_BLOCK + offset;
    if (lba >= FLASH_DISK_BLOCKS || off + len > PICO_FLASH_SIZE_BYTES) return false;
    const uint8_t *in = buf;
    while (len) {
        uint32_t sec = off & ~(SECTOR - 1), at = off - sec, n = SECTOR - at; if (n > len) n = len;
        if (!load_sector(sec)) return false;
        if (memcmp(cache + at, in, n)) { memcpy(cache + at, in, n); dirty = true; }
        in += n; off += n; len -= n;
    }
    last_write_ms = to_ms_since_boot(get_absolute_time()); n_writes++;
    return true;
}

bool flash_disk_dirty(void) { return dirty; }
uint32_t flash_disk_last_write_ms(void) { return last_write_ms; }
uint32_t flash_disk_writes(void) { return n_writes; }

void flash_disk_poll(void) {
    if (dirty && to_ms_since_boot(get_absolute_time()) - last_write_ms > 100) flash_disk_flush();
}
