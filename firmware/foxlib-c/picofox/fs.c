/* SPDX-License-Identifier: GPL-3.0-or-later
 * fs -- the FOXBENCH volume: mount (format on first boot), seed the files the
 * page expects, read/write whole files. */
#include "fs.h"
#include <string.h>
#include "builtin_defaults.h"
#include "ff.h"
#include "flash_disk.h"

static FATFS fatfs;
static bool mounted;
static char fs_last_err[48];

static const char README[] =
    "fox-bench PicoFox firmware\r\n"
    "\r\n"
    "fox.json      what this fox does (edit with the fox-bench page, or by hand)\r\n"
    "defaults.json the template's known-good values; fox.json overrides them\r\n"
    "board.json    who this fox is (board, chip uid, firmware) - written by the firmware\r\n"
    "\r\n"
    "The fox reloads a second after the last write. Serial console: 115200 baud,\r\n"
    "type 'help'. https://lc-linkous.github.io/fox-bench/\r\n";

const char *fs_error(void) { return fs_last_err; }

static bool format(void) {
    static BYTE work[FF_MAX_SS * 2];
    MKFS_PARM opt = { .fmt = FM_FAT | FM_SFD, .n_fat = 1, .align = 0, .n_root = 128, .au_size = 2048 };   /* 2 KB clusters -> FAT16 on 15 MB */
    FRESULT r = f_mkfs("", &opt, work, sizeof work);
    if (r != FR_OK) { snprintf(fs_last_err, sizeof fs_last_err, "mkfs %d", r); return false; }
    return true;
}

bool fs_mount(bool allow_format) {
    flash_disk_flush();
    if (mounted) { f_unmount(""); mounted = false; }
    FRESULT r = f_mount(&fatfs, "", 1);
    if (r == FR_NO_FILESYSTEM && allow_format) {
        if (!format()) return false;
        r = f_mount(&fatfs, "", 1);
        if (r == FR_OK) { f_setlabel(FS_LABEL); }
    }
    if (r != FR_OK) { snprintf(fs_last_err, sizeof fs_last_err, "mount %d", r); return false; }
    mounted = true;
    /* A volume inherited from other firmware (the vendor's "PicoFox") keeps its files and its name: the vendor
       firmware could not rename it back, so neither side renames. The files on the drive say which firmware runs. */
    return true;
}

bool fs_mounted(void) { return mounted; }

long fs_read(const char *path, char *buf, size_t cap) {
    FIL f; UINT n = 0;
    if (!mounted) return -1;
    if (f_open(&f, path, FA_READ) != FR_OK) return -1;
    FRESULT r = f_read(&f, buf, (UINT)(cap - 1), &n);
    f_close(&f);
    if (r != FR_OK) return -1;
    buf[n] = 0;
    return (long)n;
}

long fs_read_at(const char *path, uint32_t off, void *buf, size_t n) {
    FIL f; UINT got = 0;
    if (!mounted) return -1;
    if (f_open(&f, path, FA_READ) != FR_OK) return -1;
    FRESULT r = f_lseek(&f, off);
    if (r == FR_OK) r = f_read(&f, buf, (UINT)n, &got);
    f_close(&f);
    return r == FR_OK ? (long)got : -1;
}

bool fs_write(const char *path, const void *data, size_t len) {
    FIL f; UINT n = 0;
    if (!mounted) return false;
    if (f_open(&f, path, FA_WRITE | FA_CREATE_ALWAYS) != FR_OK) return false;
    FRESULT r = f_write(&f, data, (UINT)len, &n);
    f_close(&f);
    flash_disk_flush();
    return r == FR_OK && n == len;
}

bool fs_exists(const char *path) { FILINFO fi; return mounted && f_stat(path, &fi) == FR_OK; }
long fs_size(const char *path) { FILINFO fi; return mounted && f_stat(path, &fi) == FR_OK ? (long)fi.fsize : -1; }

int fs_seed(const char *board_json) {
    int made = 0;
    if (!fs_exists("defaults.json")) { fs_write("defaults.json", BUILTIN_DEFAULTS, BUILTIN_DEFAULTS_LEN); made++; }
    if (!fs_exists("fox.json")) { fs_write("fox.json", BUILTIN_DEFAULTS, BUILTIN_DEFAULTS_LEN); made++; }
    if (!fs_exists("README.txt")) { fs_write("README.txt", README, sizeof README - 1); made++; }
    /* board.json: the fox's identity for a host that only sees the drive (the page's deploy log and audit).
     * Rewritten whenever it differs, so a firmware update refreshes it. */
    char cur[160]; long n = fs_read("board.json", cur, sizeof cur);
    if (n < 0 || strcmp(cur, board_json)) { fs_write("board.json", board_json, strlen(board_json)); made++; }
    return made;
}

int fs_list(char *out, size_t cap) {
    DIR d; FILINFO fi; int o = 0, n = 0;
    out[0] = 0;
    if (!mounted || f_opendir(&d, "") != FR_OK) return 0;
    while (f_readdir(&d, &fi) == FR_OK && fi.fname[0]) {
        if (fi.fattrib & AM_HID) continue;
        int w = snprintf(out + o, cap - (size_t)o, "%s%s %lu", o ? "  " : "", fi.fname, (unsigned long)fi.fsize);
        if (w < 0 || (size_t)(o + w) >= cap) break;
        o += w; n++;
    }
    f_closedir(&d);
    return n;
}
