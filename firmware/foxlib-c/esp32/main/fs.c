/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "fs.h"
#include <dirent.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "esp_spiffs.h"

#define MOUNT "/fs"
static const char *err = "";
static char pathbuf[64];
static const char *path(const char *name) { snprintf(pathbuf, sizeof pathbuf, MOUNT "/%s", name); return pathbuf; }

bool fs_init(void) {
    esp_vfs_spiffs_conf_t conf = { .base_path = MOUNT, .partition_label = "storage", .max_files = 4, .format_if_mount_failed = true };
    esp_err_t r = esp_vfs_spiffs_register(&conf);
    if (r != ESP_OK) { err = esp_err_to_name(r); return false; }
    return true;
}
const char *fs_error(void) { return err; }

long fs_read(const char *name, char *buf, size_t cap) {
    FILE *f = fopen(path(name), "rb"); if (!f) return -1;
    size_t n = fread(buf, 1, cap - 1, f); fclose(f); buf[n] = 0; return (long)n;
}
bool fs_write(const char *name, const void *data, size_t n) {
    FILE *f = fopen(path(name), "wb"); if (!f) { err = "open for write"; return false; }
    bool ok = fwrite(data, 1, n, f) == n; if (fclose(f)) ok = false;
    if (!ok) err = "write";
    return ok;
}
bool fs_remove(const char *name) { return unlink(path(name)) == 0; }
bool fs_exists(const char *name) { struct stat st; return stat(path(name), &st) == 0; }
long fs_size(const char *name) { struct stat st; return stat(path(name), &st) == 0 ? (long)st.st_size : -1; }
int fs_list(char *out, size_t cap) {
    out[0] = 0; int n = 0; size_t o = 0;
    DIR *d = opendir(MOUNT); if (!d) return 0;
    struct dirent *e;
    while ((e = readdir(d))) { long sz = fs_size(e->d_name); int w = snprintf(out + o, cap - o, "%s%s %ld", n ? "  " : "", e->d_name, sz); if (w < 0 || (size_t)w >= cap - o) break; o += (size_t)w; n++; }
    closedir(d);
    return n;
}
