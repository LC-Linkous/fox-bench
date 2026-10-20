/* SPDX-License-Identifier: GPL-3.0-or-later
 * flash_disk -- 512-byte block device over the QSPI flash above the program image.
 * Shared by the USB mass-storage LUN and FatFs. Writes go through one 4 KB sector
 * cache (erase size) and are committed with flash_safe_execute, so core1 is parked
 * while the flash is unavailable for XIP. */
#ifndef FLASH_DISK_H
#define FLASH_DISK_H
#include <stdbool.h>
#include <stdint.h>
#include "pico.h"

#define FLASH_DISK_BLOCK 512u
#define FLASH_DISK_OFFSET (1024u * 1024u)                                   /* program image lives below */
#define FLASH_DISK_BYTES (PICO_FLASH_SIZE_BYTES - FLASH_DISK_OFFSET)
#define FLASH_DISK_BLOCKS (FLASH_DISK_BYTES / FLASH_DISK_BLOCK)

void flash_disk_init(void);
bool flash_disk_read(uint32_t lba, uint32_t offset, void *buf, uint32_t len);
bool flash_disk_write(uint32_t lba, uint32_t offset, const void *buf, uint32_t len);
bool flash_disk_flush(void);               /* commit the dirty sector, if any */
bool flash_disk_dirty(void);
uint32_t flash_disk_last_write_ms(void);   /* 0 if never */
uint32_t flash_disk_writes(void);          /* count of host/firmware writes, for the console */
void flash_disk_poll(void);                /* call from the main loop: flushes a sector left dirty for > 100 ms */

#endif
