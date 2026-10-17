# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""Robot 36 (grayscale) SSTV as an event stream. No hardware imports.

Carried over from the earlier fox: VIS header, 240 lines, 40 px/line
(2.2 ms per pixel, within CircuitPython timing), chroma scans held at
1900 Hz so colour decoders show grayscale. ~37 s per image.

images.bin reader: u8 count; per image u8 w, u8 h, u8 name_len, name,
w*h bytes. load_images(path) -> list of image dicts; test_card() when
the file is missing so a fresh fox still transmits something decodable.
"""

MODE = {"name": "Robot 36 (grayscale)", "vis": 8, "lines": 240,
        "sync_ms": 9.0, "sync_porch_ms": 3.0, "y_ms": 88.0,
        "sep_ms": 4.5, "porch_ms": 1.5, "chroma_ms": 44.0}
PIXELS_PER_LINE = 40


def events(image):
    raise NotImplementedError


def test_card(width=PIXELS_PER_LINE, height=240):
    raise NotImplementedError


def load_images(path="images.bin"):
    raise NotImplementedError
