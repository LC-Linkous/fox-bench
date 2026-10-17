# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""Songs -> events. No hardware imports.

A song is {"name": str, "tempo": qpm, "notes": [[midi, dur32], ...]}
with midi 0 a rest and dur32 in 32nds of a whole note. Each note sounds
for `articulation` of its slot, then rests for the remainder.

Playlist wraps a list of songs and rotates one per transmission.
"""


def midi_hz(note):
    return 440.0 * (2 ** ((note - 69) / 12.0))


def events(song, articulation=0.875):
    raise NotImplementedError


class Playlist:
    def __init__(self, songs, articulation=0.875):
        raise NotImplementedError

    def next_events(self):
        raise NotImplementedError
