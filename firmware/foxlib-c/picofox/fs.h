/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef FS_H
#define FS_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

#define FS_LABEL "FOXBENCH"

bool fs_mount(bool allow_format);          /* (re)mount; formats an empty flash when allowed */
bool fs_mounted(void);
const char *fs_error(void);
long fs_read(const char *path, char *buf, size_t cap);   /* bytes read (NUL-terminated), -1 if missing */
long fs_read_at(const char *path, uint32_t off, void *buf, size_t n);   /* bytes read from an offset, -1 if missing */
bool fs_write(const char *path, const void *data, size_t len);
bool fs_exists(const char *path);
int fs_seed(const char *board_json);        /* create the files the page expects if missing, keep board.json current; returns how many written */
int fs_list(char *out, size_t cap);         /* "name size  name size ..." */
long fs_size(const char *path);             /* file size, -1 if missing */
#endif
