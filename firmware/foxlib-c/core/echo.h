/* SPDX-License-Identifier: GPL-3.0-or-later
 * Echo guard for the consoles. A Linux host can send a fox's own output straight back to it (a freshly enumerated
 * ttyACM has tty echo on, and ModemManager opens every new port to probe it): the fox then reads "initializing
 * system ..." or its own "err: ..." line as a command and answers, and the answer comes back too. The console
 * notes the last lines it sent; a received line equal to one of them is an echo and is dropped. */
#ifndef FOXLIBC_ECHO_H
#define FOXLIBC_ECHO_H
#include <stdbool.h>
void echo_note(const char *text);      /* text just sent (may hold several lines) */
bool echo_is(const char *line);        /* true when line is one of the last lines sent: drop it. Not applied inside a put: a body may repeat the lines a `get` just sent */
#endif
