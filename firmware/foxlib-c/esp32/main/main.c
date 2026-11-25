/* SPDX-License-Identifier: GPL-3.0-or-later
 * fox-bench firmware for the Espressif boards (XIAO ESP32-C3 / C6 / C5 / S3): a network fox in C.
 *
 * The same contract as the CircuitPython foxes -- fox.json over defaults.json (CONFIG.md), the FOX banner, the bench
 * words -- with no CircuitPython and no USB drive: the USB-Serial-JTAG console on the USB lead is the whole interface,
 * files included (PROTOCOL.md). This program is free software under the GNU GPL v3 or later, WITHOUT ANY WARRANTY;
 * see firmware/LICENSE. */
#include <stdio.h>
#include "console.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "fs.h"
#include "netfox.h"
#include "nvs_flash.h"

void app_main(void) {
    if (nvs_flash_init() != ESP_OK) { nvs_flash_erase(); nvs_flash_init(); }   /* a partition from another firmware: start it fresh */
    con_init();
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: con_set_reset_reason("power_on"); break;
        case ESP_RST_SW: con_set_reset_reason("software(reboot)"); break;
        case ESP_RST_DEEPSLEEP: con_set_reset_reason("deep_sleep(wake)"); break;
        case ESP_RST_TASK_WDT: case ESP_RST_INT_WDT: case ESP_RST_WDT: con_set_reset_reason("watchdog(timeout)"); break;
        case ESP_RST_PANIC: con_set_reset_reason("panic"); break;
        case ESP_RST_BROWNOUT: con_set_reset_reason("brownout"); break;
        default: con_set_reset_reason("other"); break;
    }
    if (!fs_init()) con_printf("** files: the storage partition is not usable (%s): running the compiled-in defaults **\r\n", fs_error());
    netfox_init();
    for (;;) {
        con_poll();
        netfox_poll();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
