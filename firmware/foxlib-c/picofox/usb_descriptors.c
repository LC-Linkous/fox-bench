/* SPDX-License-Identifier: GPL-3.0-or-later
 * USB descriptors: composite CDC (console) + MSC (FOXBENCH drive), full speed.
 * Serial number = the RP2040's unique id, the same string the banner prints as uid=. */
#include <string.h>
#include "pico/unique_id.h"
#include "tusb.h"

/* Raspberry Pi's VID with the Pico SDK's generic CDC PID: the page matches the drive by its
 * volume label and the port by the banner, never by PID. */
#define USB_VID 0x2E8A
#define USB_PID 0x000A
#define USB_BCD 0x0200

static const tusb_desc_device_t desc_device = {
    .bLength = sizeof(tusb_desc_device_t), .bDescriptorType = TUSB_DESC_DEVICE, .bcdUSB = USB_BCD,
    .bDeviceClass = TUSB_CLASS_MISC, .bDeviceSubClass = MISC_SUBCLASS_COMMON, .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE, .idVendor = USB_VID, .idProduct = USB_PID, .bcdDevice = 0x0100,
    .iManufacturer = 1, .iProduct = 2, .iSerialNumber = 3, .bNumConfigurations = 1,
};

const uint8_t *tud_descriptor_device_cb(void) { return (const uint8_t *)&desc_device; }

enum { ITF_NUM_CDC = 0, ITF_NUM_CDC_DATA, ITF_NUM_MSC, ITF_NUM_TOTAL };
#define EPNUM_CDC_NOTIF 0x81
#define EPNUM_CDC_OUT 0x02
#define EPNUM_CDC_IN 0x82
#define EPNUM_MSC_OUT 0x03
#define EPNUM_MSC_IN 0x83
#define CONFIG_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_CDC_DESC_LEN + TUD_MSC_DESC_LEN)

static const uint8_t desc_configuration[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, 0x00, 250),
    TUD_CDC_DESCRIPTOR(ITF_NUM_CDC, 4, EPNUM_CDC_NOTIF, 8, EPNUM_CDC_OUT, EPNUM_CDC_IN, 64),
    TUD_MSC_DESCRIPTOR(ITF_NUM_MSC, 5, EPNUM_MSC_OUT, EPNUM_MSC_IN, 64),
};

const uint8_t *tud_descriptor_configuration_cb(uint8_t index) { (void)index; return desc_configuration; }

static const char *strings[] = {
    (const char[]){0x09, 0x04},   /* 0: English (US) */
    "fox-bench",                  /* 1: manufacturer */
    "fox-bench PicoFox",          /* 2: product */
    NULL,                         /* 3: serial (unique id) */
    "fox-bench console",          /* 4: CDC */
    "FOXBENCH drive",             /* 5: MSC */
};

static uint16_t desc_str[48];

const uint16_t *tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
    (void)langid;
    size_t n;
    if (index == 0) { memcpy(&desc_str[1], strings[0], 2); n = 1; }
    else {
        char serial[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];
        const char *s;
        if (index == 3) { pico_get_unique_board_id_string(serial, sizeof serial); for (char *p = serial; *p; p++) if (*p >= 'A' && *p <= 'F') *p = (char)(*p - 'A' + 'a'); s = serial; }
        else if (index < sizeof strings / sizeof strings[0]) s = strings[index];
        else return NULL;
        n = strlen(s); if (n > 46) n = 46;
        for (size_t i = 0; i < n; i++) desc_str[1 + i] = (uint16_t)s[i];
    }
    desc_str[0] = (uint16_t)((TUSB_DESC_STRING << 8) | (2 * n + 2));
    return desc_str;
}
