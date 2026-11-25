/* SPDX-License-Identifier: GPL-3.0-or-later
 * fs -- the fox's files on the SPIFFS partition: fox.json, defaults.json, a payload image. The console is the only
 * way in or out (PROTOCOL.md "Files over the console"); there is no USB drive on these boards. */
#ifndef FS_H
#define FS_H
#include <stdbool.h>
#include <stddef.h>

bool fs_init(void);                                         /* mount (format on first boot); false when the partition is unusable */
const char *fs_error(void);
long fs_read(const char *name, char *buf, size_t cap);      /* bytes read (NUL-terminated within cap), -1 if missing */
bool fs_write(const char *name, const void *data, size_t n);
bool fs_remove(const char *name);                           /* false when missing */
bool fs_exists(const char *name);
long fs_size(const char *name);
int fs_list(char *out, size_t cap);                         /* "name size  name size ..." */
#endif
