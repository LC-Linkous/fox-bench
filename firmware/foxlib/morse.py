# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/morse.py -- Morse table, encoder, text -> events. No hardware imports.
# Twin of js/audio/morse.js; CI checks the two produce identical streams.

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
    """'hi u' -> [['....', '..'], ['..-']]; characters not in TABLE are skipped."""
    words = []
    for word in text.lower().split(" "):
        chars = [TABLE[c] for c in word if c in TABLE]
        if chars:
            words.append(chars)
    return words


def events(text, wpm=12, tone_hz=800, dit_ms=None):
    """PARIS timing. Yields (hz, ms); hz 0 is silence.
    dit = 1200/wpm ms; dah 3; intra-character 1; inter-character 3; word 7.
    dit_ms overrides the element length directly (QRSS)."""
    unit = dit_ms if dit_ms else 1200.0 / wpm
    words = encode(text)
    nw = len(words)
    for wi in range(nw):
        word = words[wi]
        if wi > 0:
            yield (0, unit * 7)              # word gap (no gap is sent after a word's last character)
        nc = len(word)
        for ci in range(nc):
            ch = word[ci]
            nm = len(ch)
            for mi in range(nm):
                yield (tone_hz, unit if ch[mi] == "." else unit * 3)
                if mi < nm - 1:
                    yield (0, unit)
            if ci < nc - 1:
                yield (0, unit * 3)
        if wi == nw - 1:
            yield (0, unit * 3)


def duration_ms(text, **kw):
    t = 0
    for _, ms in events(text, **kw):
        t += ms
    return t
