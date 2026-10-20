/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/morse.c -- Morse table and text -> events. Twin of foxlib/morse.py
 * (and js/audio/morse.js); the parity test checks the three agree to the millisecond.
 *
 * PARIS timing: dit = 1200/wpm ms; dah 3; intra-character gap 1; inter-character 3;
 * word gap 7; a 3-unit gap after the last character of the last word. dit_ms, when
 * > 0, overrides the element length directly (QRSS). Characters outside the table
 * are skipped; words that end up empty are skipped. */
#include "morse.h"
#include <ctype.h>
#include <string.h>

static const struct { char c; const char *code; } TABLE[] = {
    {'a', ".-"}, {'b', "-..."}, {'c', "-.-."}, {'d', "-.."}, {'e', "."}, {'f', "..-."},
    {'g', "--."}, {'h', "...."}, {'i', ".."}, {'j', ".---"}, {'k', "-.-"}, {'l', ".-.."},
    {'m', "--"}, {'n', "-."}, {'o', "---"}, {'p', ".--."}, {'q', "--.-"}, {'r', ".-."},
    {'s', "..."}, {'t', "-"}, {'u', "..-"}, {'v', "...-"}, {'w', ".--"}, {'x', "-..-"},
    {'y', "-.--"}, {'z', "--.."},
    {'0', "-----"}, {'1', ".----"}, {'2', "..---"}, {'3', "...--"}, {'4', "....-"},
    {'5', "....."}, {'6', "-...."}, {'7', "--..."}, {'8', "---.."}, {'9', "----."},
    {'.', ".-.-.-"}, {',', "--..--"}, {'?', "..--.."}, {'/', "-..-."}, {'=', "-...-"},
    {'+', ".-.-."}, {'-', "-....-"}, {'@', ".--.-."},
};

const char *morse_code(char c) {
    c = (char)tolower((unsigned char)c);
    for (size_t i = 0; i < sizeof TABLE / sizeof TABLE[0]; i++) if (TABLE[i].c == c) return TABLE[i].code;
    return NULL;
}

/* Words are split on single spaces exactly as str.split(" ") does: consecutive spaces
 * make empty words, which encode() drops. */
void morse_events(events_t *out, const char *text, int wpm, float tone_hz, float dit_ms) {
    float unit = dit_ms > 0 ? dit_ms : 1200.0f / (float)wpm;
    /* first pass: find the words that contain at least one encodable character */
    const char *p = text;
    bool first_word = true;
    bool any_word = false;
    /* We need to know which word is the last non-empty one; scan ahead each time. */
    while (*p || p == text) {
        const char *ws = p;
        while (*p && *p != ' ') p++;
        const char *we = p;
        bool has = false;
        for (const char *q = ws; q < we; q++) if (morse_code(*q)) { has = true; break; }
        if (has) {
            /* is there a later word with content? */
            bool later = false;
            for (const char *q = we; *q; q++) if (*q != ' ' && morse_code(*q)) { later = true; break; }
            if (!first_word) events_push(out, 0, unit * 7);
            first_word = false; any_word = true;
            /* characters */
            const char *last_char = NULL;
            for (const char *q = ws; q < we; q++) if (morse_code(*q)) last_char = q;
            for (const char *q = ws; q < we; q++) {
                const char *code = morse_code(*q);
                if (!code) continue;
                size_t nm = strlen(code);
                for (size_t m = 0; m < nm; m++) {
                    events_push(out, tone_hz, code[m] == '.' ? unit : unit * 3);
                    if (m < nm - 1) events_push(out, 0, unit);
                }
                if (q != last_char) events_push(out, 0, unit * 3);
            }
            if (!later) events_push(out, 0, unit * 3);
        }
        if (!*p) break;
        p++;   /* skip the space */
    }
    (void)any_word;
}

double morse_duration_ms(const char *text, int wpm, float dit_ms) {
    static events_t tmp;
    events_clear(&tmp);
    morse_events(&tmp, text, wpm, 800, dit_ms);
    return events_ms(&tmp);
}
