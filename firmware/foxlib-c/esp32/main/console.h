/* SPDX-License-Identifier: GPL-3.0-or-later
 * console -- the fox's one interface on these boards: the USB-Serial-JTAG port as a text console (PROTOCOL.md
 * "foxlib-c console" and "Files over the console"). Lines in, `ok` / `err: …` out; the fox's log and banner interleave. */
#ifndef CONSOLE_H
#define CONSOLE_H
#include <stdbool.h>
void con_init(void);                 /* the driver, the reader task */
void con_puts(const char *s);
void con_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
void con_flush(void);
void con_poll(void);                 /* run queued commands on the main task (the radio is driven from there) */
void con_set_reset_reason(const char *why);
#endif
