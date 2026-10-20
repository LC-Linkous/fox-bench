/* SPDX-License-Identifier: GPL-3.0-or-later
 * USB mass-storage callbacks over flash_disk. Tracks whether a host has the
 * drive (mounted and not ejected) and when it last wrote, so the fox can reload
 * its configuration once the host's writes settle. */
#include "msc_disk.h"
#include <string.h>
#include "flash_disk.h"
#include "tusb.h"

static bool ejected;
static uint32_t host_writes;

bool msc_host_has_drive(void) { return tud_mounted() && !ejected; }
uint32_t msc_host_writes(void) { return host_writes; }
void msc_reset_eject(void) { ejected = false; }

void tud_msc_inquiry_cb(uint8_t lun, uint8_t vendor_id[8], uint8_t product_id[16], uint8_t product_rev[4]) {
    (void)lun;
    memcpy(vendor_id, "fox-bnch", 8);
    memcpy(product_id, "PicoFox FOXBENCH", 16);
    memcpy(product_rev, "0.1 ", 4);
}

bool tud_msc_test_unit_ready_cb(uint8_t lun) {
    (void)lun;
    if (ejected) { tud_msc_set_sense(lun, SCSI_SENSE_NOT_READY, 0x3a, 0x00); return false; }
    return true;
}

void tud_msc_capacity_cb(uint8_t lun, uint32_t *block_count, uint16_t *block_size) {
    (void)lun; *block_count = FLASH_DISK_BLOCKS; *block_size = FLASH_DISK_BLOCK;
}

bool tud_msc_start_stop_cb(uint8_t lun, uint8_t power_condition, bool start, bool load_eject) {
    (void)lun; (void)power_condition;
    if (load_eject) {
        if (start) ejected = false;
        else { flash_disk_flush(); ejected = true; }
    }
    return true;
}

int32_t tud_msc_read10_cb(uint8_t lun, uint32_t lba, uint32_t offset, void *buffer, uint32_t bufsize) {
    (void)lun;
    return flash_disk_read(lba, offset, buffer, bufsize) ? (int32_t)bufsize : -1;
}

bool tud_msc_is_writable_cb(uint8_t lun) { (void)lun; return true; }

int32_t tud_msc_write10_cb(uint8_t lun, uint32_t lba, uint32_t offset, uint8_t *buffer, uint32_t bufsize) {
    (void)lun;
    if (!flash_disk_write(lba, offset, buffer, bufsize)) return -1;
    host_writes++;
    return (int32_t)bufsize;
}

int32_t tud_msc_scsi_cb(uint8_t lun, const uint8_t scsi_cmd[16], void *buffer, uint16_t bufsize) {
    (void)buffer; (void)bufsize;
    switch (scsi_cmd[0]) {
        case 0x35:   /* SYNCHRONIZE CACHE (10) */ flash_disk_flush(); return 0;
        default: tud_msc_set_sense(lun, SCSI_SENSE_ILLEGAL_REQUEST, 0x20, 0x00); return -1;
    }
}
