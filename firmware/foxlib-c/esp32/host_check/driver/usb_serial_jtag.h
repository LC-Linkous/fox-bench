#pragma once
typedef struct { int tx_buffer_size, rx_buffer_size; } usb_serial_jtag_driver_config_t;
#define USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT() { 256, 256 }
int usb_serial_jtag_driver_install(usb_serial_jtag_driver_config_t *);
