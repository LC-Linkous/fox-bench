#pragma once
#include <stdint.h>
#include "esp_err.h"
typedef enum { WIFI_MODE_NULL, WIFI_MODE_STA, WIFI_MODE_AP, WIFI_MODE_APSTA } wifi_mode_t;
typedef enum { WIFI_IF_STA, WIFI_IF_AP } wifi_interface_t;
typedef enum { WIFI_AUTH_OPEN, WIFI_AUTH_WPA2_PSK } wifi_auth_mode_t;
typedef enum { WIFI_STORAGE_FLASH, WIFI_STORAGE_RAM } wifi_storage_t;
typedef struct { uint8_t ssid[32]; uint8_t password[64]; uint8_t ssid_len; uint8_t channel; wifi_auth_mode_t authmode; uint8_t ssid_hidden; uint8_t max_connection; } wifi_ap_config_t;
typedef union { wifi_ap_config_t ap; } wifi_config_t;
typedef struct { int dummy; } wifi_init_config_t;
#define WIFI_INIT_CONFIG_DEFAULT() { 0 }
typedef struct { int dummy; } wifi_scan_config_t;
typedef struct { uint8_t ssid[33]; int8_t rssi; uint8_t primary; } wifi_ap_record_t;
esp_err_t esp_wifi_init(const wifi_init_config_t *); esp_err_t esp_wifi_set_storage(wifi_storage_t); esp_err_t esp_wifi_set_mode(wifi_mode_t);
esp_err_t esp_wifi_set_config(wifi_interface_t, wifi_config_t *); esp_err_t esp_wifi_start(void); esp_err_t esp_wifi_stop(void);
esp_err_t esp_wifi_set_mac(wifi_interface_t, const uint8_t[6]); esp_err_t esp_wifi_get_mac(wifi_interface_t, uint8_t[6]);
esp_err_t esp_wifi_set_max_tx_power(int8_t); esp_err_t esp_wifi_scan_start(const wifi_scan_config_t *, _Bool); esp_err_t esp_wifi_scan_get_ap_records(uint16_t *, wifi_ap_record_t *);
