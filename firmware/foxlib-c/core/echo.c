/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "echo.h"
#include <string.h>

#define ECHO_RING 12
#define ECHO_LEN 96
static char ring[ECHO_RING][ECHO_LEN];
static unsigned head;

static void note_line(const char *s, size_t n) {
    if (!n) return;
    if (n >= ECHO_LEN) n = ECHO_LEN - 1;
    memcpy(ring[head], s, n); ring[head][n] = 0;
    head = (head + 1) % ECHO_RING;
}

void echo_note(const char *text) {
    const char *p = text;
    while (*p) {
        const char *e = strpbrk(p, "\r\n");
        if (!e) { note_line(p, strlen(p)); break; }
        note_line(p, (size_t)(e - p));
        p = e; while (*p == '\r' || *p == '\n') p++;
    }
}

bool echo_is(const char *line) {
    size_t n = strlen(line); if (!n) return false;
    if (n >= ECHO_LEN) n = ECHO_LEN - 1;
    for (unsigned i = 0; i < ECHO_RING; i++)
        if (ring[i][0] && strlen(ring[i]) == n && !memcmp(ring[i], line, n)) { ring[i][0] = 0; return true; }
    return false;
}
