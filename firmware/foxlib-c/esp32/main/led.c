/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "led.h"
#include <stdlib.h>
#include <string.h>
#include "driver/gpio.h"
#include "sdkconfig.h"

/* the user LEDs of the boards this firmware is built for, by the names the catalog gives them (the hardware descriptors) */
typedef struct { const char *name; int gpio; bool active_low; } led_t;
static const led_t LEDS[] = {
#if CONFIG_IDF_TARGET_ESP32C6
    { "LED", 15, true },
#elif CONFIG_IDF_TARGET_ESP32S3
    { "LED", 21, true },
#elif CONFIG_IDF_TARGET_ESP32C5
    { "LED", 27, true }, { "IO27", 27, true },
#endif
    { NULL, -1, false },
};
static int pin = -1; static bool low = false;

bool led_init(const char *role_pin) {
    const led_t *l = LEDS;
    if (role_pin && *role_pin) { for (; l->name; l++) if (!strcmp(l->name, role_pin)) break; if (!l->name) { /* "IO<n>" / "GPIO<n>": any pin, active high */
        const char *d = role_pin; while (*d && (*d < '0' || *d > '9')) d++; if (!*d) return false; pin = atoi(d); low = false; goto cfg; } }
    if (!l->name) return false;
    pin = l->gpio; low = l->active_low;
cfg:
    gpio_reset_pin(pin); gpio_set_direction(pin, GPIO_MODE_OUTPUT); led_set(false);
    return true;
}
void led_set(bool on) { if (pin >= 0) gpio_set_level(pin, (on ^ low) ? 1 : 0); }
