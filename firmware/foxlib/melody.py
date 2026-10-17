# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/melody.py -- songs -> events. No hardware imports. Twin of js/audio/melody.js.
# song = {"name": str, "tempo": quarter notes/min, "notes": [[midi, dur32], ...]}
# midi 0 is a rest; dur32 is in 32nds of a whole note. Each note sounds for
# `articulation` of its slot, then rests for the remainder.


def midi_hz(note):
    return 440.0 * (2 ** ((note - 69) / 12.0))


def events(song, articulation=0.875):
    ms_per_32 = 7500.0 / song["tempo"]
    for pair in song["notes"]:
        note, d = pair[0], pair[1]
        slot = d * ms_per_32
        if note == 0:
            yield (0, slot)
        else:
            on = slot * articulation
            yield (midi_hz(note), on)
            if slot - on > 0.01:
                yield (0, slot - on)


def duration_ms(song, articulation=0.875):
    t = 0
    for _, ms in events(song, articulation):
        t += ms
    return t


class Playlist:
    """Rotates through songs, one per call to next_events()."""

    def __init__(self, songs, articulation=0.875):
        self.songs = songs
        self.articulation = articulation
        self.index = 0

    def __len__(self):
        return len(self.songs)

    def current(self):
        return self.songs[self.index] if self.songs else None

    def next_events(self):
        song = self.songs[self.index]
        self.index = (self.index + 1) % len(self.songs)
        return events(song, self.articulation)
