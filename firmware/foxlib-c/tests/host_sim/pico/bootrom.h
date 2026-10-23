/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include <stdint.h>
void reset_usb_boot(uint32_t gpio_mask, uint32_t disable_mask);   /* host: records that the bootloader was asked for */
