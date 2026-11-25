/* SPDX-License-Identifier: GPL-3.0-or-later
 * led -- the user LED by its catalog role name (hardware/<board>.json pins), honouring active_low: on while the fox is
 * on the air, off while it sleeps, as foxlib/led.py does. A board without one (the XIAO C3) has led_init() return false. */
#ifndef LED_H
#define LED_H
#include <stdbool.h>
bool led_init(const char *role_pin);     /* the pins.led name from fox.json ("LED", "IO27"), or NULL for the board's default */
void led_set(bool on);
#endif
