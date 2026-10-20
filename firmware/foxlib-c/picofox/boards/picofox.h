/* SPDX-License-Identifier: GPL-3.0-or-later
 * Pico SDK board header for the AI6YM PicoFox (RP2040, W25Q128 16 MB, 12 MHz crystal).
 * Hardware facts from docs/picofox-hardware.md. Everything not listed falls back to
 * the generic RP2040 defaults. */
#ifndef _BOARDS_PICOFOX_H
#define _BOARDS_PICOFOX_H

#define PICOFOX

#define PICO_DEFAULT_UART 0
#define PICO_DEFAULT_UART_TX_PIN 16
#define PICO_DEFAULT_UART_RX_PIN 17

/* no LED on a GPIO (D2 is a power indicator) */
#define PICO_DEFAULT_I2C 0
#define PICO_DEFAULT_I2C_SDA_PIN 0
#define PICO_DEFAULT_I2C_SCL_PIN 1

#define PICO_FLASH_SPI_CLKDIV 2
#define PICO_FLASH_SIZE_BYTES (16 * 1024 * 1024)
#define PICO_BOOT_STAGE2_CHOOSE_W25Q080 1

#define PICO_RP2040_B0_SUPPORTED 1

/* PicoFox pins */
#define PICOFOX_PIN_SDA 0
#define PICOFOX_PIN_SCL 1
#define PICOFOX_PIN_AMP_EN 2
#define PICOFOX_PIN_ATTN_LE 4
#define PICOFOX_PIN_TEST 14
#define PICOFOX_PIN_CHG_SENSE 15
#define PICOFOX_PIN_ID0 22
#define PICOFOX_PIN_ID1 23
#define PICOFOX_PIN_ID2 24
#define PICOFOX_PIN_ID3 25
#define PICOFOX_ADC_CC1 1
#define PICOFOX_ADC_CC2 3

#endif
