#pragma once
#include <stddef.h>
#include "esp_err.h"
typedef struct { const char *base_path, *partition_label; size_t max_files; _Bool format_if_mount_failed; } esp_vfs_spiffs_conf_t;
esp_err_t esp_vfs_spiffs_register(const esp_vfs_spiffs_conf_t *);
