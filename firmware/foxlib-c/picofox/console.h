/* SPDX-License-Identifier: GPL-3.0-or-later
 * console -- the USB CDC port: fox log out, bench commands in. 115200 (ignored), lines. */
#ifndef CONSOLE_H
#define CONSOLE_H
#include <stdbool.h>
void con_init(void);
void con_poll(void);                       /* pump output, read and dispatch command lines */
void con_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
void con_puts(const char *s);              /* line without newline handling */
bool con_connected(void);                  /* a terminal has DTR up */
void con_set_reset_reason(const char *why); /* shown by status as reset=; decided once at boot */
#endif
