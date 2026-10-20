/* SPDX-License-Identifier: GPL-3.0-or-later
 * FatFs disk I/O over flash_disk (the same blocks the USB host sees). */
#include "ff.h"
#include "diskio.h"
#include "flash_disk.h"

DSTATUS disk_status(BYTE pdrv) { (void)pdrv; return 0; }
DSTATUS disk_initialize(BYTE pdrv) { (void)pdrv; return 0; }

DRESULT disk_read(BYTE pdrv, BYTE *buff, LBA_t sector, UINT count) {
    (void)pdrv;
    return flash_disk_read((uint32_t)sector, 0, buff, count * FLASH_DISK_BLOCK) ? RES_OK : RES_ERROR;
}

DRESULT disk_write(BYTE pdrv, const BYTE *buff, LBA_t sector, UINT count) {
    (void)pdrv;
    return flash_disk_write((uint32_t)sector, 0, buff, count * FLASH_DISK_BLOCK) ? RES_OK : RES_ERROR;
}

DRESULT disk_ioctl(BYTE pdrv, BYTE cmd, void *buff) {
    (void)pdrv;
    switch (cmd) {
        case CTRL_SYNC: return flash_disk_flush() ? RES_OK : RES_ERROR;
        case GET_SECTOR_COUNT: *(LBA_t *)buff = FLASH_DISK_BLOCKS; return RES_OK;
        case GET_SECTOR_SIZE: *(WORD *)buff = FLASH_DISK_BLOCK; return RES_OK;
        case GET_BLOCK_SIZE: *(DWORD *)buff = 4096 / FLASH_DISK_BLOCK; return RES_OK;
        default: return RES_PARERR;
    }
}

DWORD get_fattime(void) { return ((DWORD)(2026 - 1980) << 25) | (1 << 21) | (1 << 16); }
