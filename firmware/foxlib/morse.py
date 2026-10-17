# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""Morse: table, encoder, and text -> events. No hardware imports.

events(text, wpm=12, tone_hz=800, dit_ms=None) yields (hz, ms).
PARIS timing: dit = 1200 / wpm ms; dah 3; intra 1; inter-char 3; word 7.
dit_ms overrides the element length directly (QRSS).
The table here and js/audio/morse.js must agree; CI compares them.
"""

TABLE = {
    "a": ".-", "b": "-...", "c": "-.-.", "d": "-..", "e": ".", "f": "..-.",
    "g": "--.", "h": "....", "i": "..", "j": ".---", "k": "-.-", "l": ".-..",
    "m": "--", "n": "-.", "o": "---", "p": ".--.", "q": "--.-", "r": ".-.",
    "s": "...", "t": "-", "u": "..-", "v": "...-", "w": ".--", "x": "-..-",
    "y": "-.--", "z": "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.", "=": "-...-",
    "+": ".-.-.", "-": "-....-", "@": ".--.-.",
}


def encode(text):
    """'hi u' -> [['....', '..'], ['..-']]; unknown characters skipped"""
    words = []
    for word in text.lower().split(" "):
        chars = [TABLE[c] for c in word if c in TABLE]
        if chars:
            words.append(chars)
    return words


def events(text, wpm=12, tone_hz=800, dit_ms=None):
    raise NotImplementedError


def duration_ms(text, **kw):
    return sum(ms for _, ms in events(text, **kw))
