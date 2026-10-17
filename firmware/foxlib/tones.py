# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""The one transmitter. Everything that goes on the air is an event
stream of (frequency_hz, duration_ms); 0 Hz is silence.

One pwmio.PWMOut is created on the audio pin with variable_frequency and
kept alive; rests set duty_cycle to 0 rather than deinit/reinit, so there
are no clicks and no per-event setup cost (matters for 2.2 ms SSTV
pixels). Events are scheduled on absolute deadlines from time.monotonic_ns
so per-event overhead cannot accumulate into slant or tempo drift.

play(events, max_ms=None) stops early and returns False when a
limits.max_keydown_s budget runs out.
"""


class Player:
    def __init__(self, audio_pin):
        raise NotImplementedError

    def play(self, events, max_ms=None):
        raise NotImplementedError

    def deinit(self):
        raise NotImplementedError
