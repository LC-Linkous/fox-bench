/* SPDX-License-Identifier: GPL-3.0-or-later
 * fox-bench firmware for the AI6YM PicoFox hardware.
 *
 * Core 0: USB (mass storage FOXBENCH + serial console), the configuration, the
 * cycle state machine. Core 1: the Si5351 and amplifier, FM at the configured
 * sample rate. Files on the drive are the whole interface (fox.json over
 * defaults.json, CONFIG.md); the console carries the foxlib banner, the log and
 * the bench commands. When the host finishes writing the drive the fox reloads.
 *
 * Written from the published schematic and component datasheets
 * (docs/picofox-hardware.md); hardware design by AI6YM.radio (CC BY-NC-SA 4.0).
 * This program is free software under the GNU GPL v3 or later, WITHOUT ANY
 * WARRANTY; see firmware/LICENSE. */
#include "bsp/board_api.h"
#include "console.h"
#include "flash_disk.h"
#include "fox.h"
#include "fs.h"
#include "msc_disk.h"
#include "pico/stdlib.h"
#include "player.h"
#include "tusb.h"

#define RELOAD_SETTLE_MS 1500

int main(void) {
    board_init();
    flash_disk_init();
    con_init();
    player_start();                 /* core 1: pins, I2C, Si5351 */
    tusb_init();
    fox_init();                     /* mount, seed, load, banner, go */

    uint32_t seen_writes = msc_host_writes();
    bool banner_pending = false;
    bool was_connected = false;
    for (;;) {
        tud_task();
        con_poll();
        flash_disk_poll();
        /* host wrote the drive: wait for the writes to settle, then reload */
        uint32_t w = msc_host_writes();
        if (w != seen_writes) { seen_writes = w; banner_pending = true; }
        if (banner_pending && to_ms_since_boot(get_absolute_time()) - flash_disk_last_write_ms() > RELOAD_SETTLE_MS && !flash_disk_dirty()) {
            banner_pending = false;
            fox_reload("drive changed");
        }
        /* a terminal just opened: give it the banner (the page's Listen expects one line starting FOX) */
        bool c = con_connected();
        if (c && !was_connected) fox_print_banner();
        was_connected = c;
        fox_poll();
    }
}
