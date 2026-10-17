# SPDX-License-Identifier: GPL-3.0-or-later
# sim/decode.py -- turn recorded tones back into what was sent.
import os, importlib.util
_spec = importlib.util.spec_from_file_location("_morse", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "foxlib", "morse.py"))
_m = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_m)
TABLE = _m.TABLE

REV = {v: k for k, v in TABLE.items()}


def tones_in(tones, start, end):
    return [(s, e, hz) for s, e, hz in tones if s >= start and (end is None or e <= end)]


def morse_text(tones, tone_hz, unit_ms, tol=0.35):
    """Decode on/off keying at tone_hz into text. Tones at other frequencies split segments."""
    marks = []        # ('on'|'off', ms)
    last_end = None
    for s, e, hz in tones:
        if abs(hz - tone_hz) > 2:
            if marks:
                marks.append(("break", 0))
            last_end = None
            continue
        if last_end is not None:
            marks.append(("off", s - last_end))
        marks.append(("on", e - s))
        last_end = e
    text, sym = [], ""
    def flush_sym():
        nonlocal sym
        if sym:
            text.append(REV.get(sym, "?"))
            sym = ""
    for kind, ms in marks:
        u = ms / unit_ms
        if kind == "on":
            sym += "." if u < 2 else "-"
        elif kind == "off":
            if u < 2:
                pass
            elif u < 5:
                flush_sym()
            else:
                flush_sym()
                text.append(" ")
        else:
            flush_sym()
            text.append(" | ")
    flush_sym()
    return "".join(text).strip().upper()


def classify(tones, tone_hz):
    """What kinds of audio appeared: 'morse', 'melody', 'sstv'."""
    kinds = set()
    for s, e, hz in tones:
        if abs(hz - tone_hz) <= 2:
            kinds.add("morse")
        elif hz in (1200, 1900) or 1500 <= hz <= 2300 and (e - s) < 20:
            kinds.add("sstv")
        else:
            kinds.add("melody")
    return kinds
