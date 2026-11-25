/* host_check: just enough of ESP-IDF's headers for `gcc -fsyntax-only` over the application. Not the SDK. */
#pragma once
typedef int esp_err_t;
#define ESP_OK 0
const char *esp_err_to_name(esp_err_t e);
