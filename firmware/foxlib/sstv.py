# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/sstv.py -- Robot 36 (grayscale) SSTV as an event stream; images.bin reader.
# No hardware imports. Twin of js/audio/sstv.js.
#
# Robot 36 is a colour mode nearly every decoder supports; the image is sent
# as luminance with both chroma scans held at 1900 Hz, which decodes as
# grayscale. 40 px per 88 ms line = 2.2 ms per pixel, within CircuitPython's
# timing. ~37 s per image regardless of content.

MODE = {"name": "Robot 36 (grayscale)", "vis": 8, "lines": 240,
        "sync_ms": 9.0, "sync_porch_ms": 3.0, "y_ms": 88.0,
        "sep_ms": 4.5, "porch_ms": 1.5, "chroma_ms": 44.0}
PIXELS_PER_LINE = 40
F_SYNC, F_BLACK, F_WHITE, F_LEADER, F_BIT0, F_BIT1 = 1200, 1500, 2300, 1900, 1300, 1100


def pixel_hz(v):
    return F_BLACK + (F_WHITE - F_BLACK) * v / 255


def vis_events(vis=None):
    if vis is None:
        vis = MODE["vis"]
    yield (F_LEADER, 300.0)
    yield (F_SYNC, 10.0)
    yield (F_LEADER, 300.0)
    yield (F_SYNC, 30.0)
    ones = 0
    for bit in range(7):
        if (vis >> bit) & 1:
            ones += 1
            yield (F_BIT1, 30.0)
        else:
            yield (F_BIT0, 30.0)
    yield ((F_BIT1 if ones % 2 else F_BIT0), 30.0)
    yield (F_SYNC, 30.0)


def line_events(row, line_no):
    yield (F_SYNC, MODE["sync_ms"])
    yield (1500, MODE["sync_porch_ms"])
    px = MODE["y_ms"] / len(row)
    v, run = row[0], 1
    for i in range(1, len(row)):
        if row[i] == v:
            run += 1
        else:
            yield (pixel_hz(v), px * run)
            v, run = row[i], 1
    yield (pixel_hz(v), px * run)
    yield ((1500 if line_no % 2 == 0 else 2300), MODE["sep_ms"])
    yield (F_LEADER, MODE["porch_ms"])
    yield (F_LEADER, MODE["chroma_ms"])


def events(image):
    """image = {"name", "width", "height", "pixels": bytes}; pads with black / crops to 240 lines."""
    w, h, px = image["width"], image["height"], image["pixels"]
    for e in vis_events():
        yield e
    black = bytes(w)
    for line in range(MODE["lines"]):
        row = px[line * w:(line + 1) * w] if line < h else black
        for e in line_events(row, line):
            yield e


LINE_MS = MODE["sync_ms"] + MODE["sync_porch_ms"] + MODE["y_ms"] + MODE["sep_ms"] + MODE["porch_ms"] + MODE["chroma_ms"]
HEADER_MS = 300 + 10 + 300 + 30 + 7 * 30 + 30 + 30


def duration_ms():
    return HEADER_MS + MODE["lines"] * LINE_MS


def test_card(w=PIXELS_PER_LINE, h=240):
    px = bytearray(w * h)
    band = h // 3
    for y in range(h):
        for x in range(w):
            if y < band:
                v = 255 * x // (w - 1)
            elif y < 2 * band:
                v = 255 if ((x // 4 + y // 4) % 2) else 0
            else:
                yy = y - 2 * band
                span = h - 2 * band
                d1 = abs(x * span - yy * w)
                d2 = abs(x * span - (span - yy) * w)
                v = 255 if min(d1, d2) < 2 * span else 0
            px[y * w + x] = v
    return {"name": "test_card", "width": w, "height": h, "pixels": bytes(px)}


def load_images(path="images.bin"):
    """u8 count; per image u8 w, u8 h, u8 name_len, name, w*h bytes. Falls back to the test card."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return [test_card()]
    out = []
    try:
        o = 0
        count = data[o]
        o += 1
        for _ in range(count):
            w, h, nl = data[o], data[o + 1], data[o + 2]
            o += 3
            name = data[o:o + nl].decode()
            o += nl
            out.append({"name": name, "width": w, "height": h, "pixels": data[o:o + w * h]})
            o += w * h
    except Exception:
        pass
    return out or [test_card()]


class Images:
    def __init__(self, images):
        self.images = images
        self.index = 0

    def __len__(self):
        return len(self.images)

    def next_events(self):
        im = self.images[self.index]
        self.index = (self.index + 1) % len(self.images)
        return events(im)
