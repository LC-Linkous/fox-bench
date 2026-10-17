# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/tones.py -- the one transmitter. Everything on the air is an event
# stream of (frequency_hz, duration_ms); 0 Hz is silence.
#
# One PWMOut on the audio pin, kept alive with variable_frequency; rests set
# duty to 0 instead of deinit/reinit (no clicks, no per-event setup cost --
# SSTV pixels are 2.2 ms). Events are scheduled on absolute deadlines from
# time.monotonic_ns so loop overhead cannot accumulate into slant or tempo drift.

import time
import pwmio

DUTY_ON = 32768


class Player:
    def __init__(self, audio_pin):
        self.pwm = pwmio.PWMOut(audio_pin, frequency=800, duty_cycle=0, variable_frequency=True)

    def play(self, events, max_ms=None, on_tick=None):
        """Play events. Returns True if completed, False if cut by max_ms."""
        start = time.monotonic_ns()
        deadline = start
        budget = None if max_ms is None else start + int(max_ms * 1e6)
        pwm = self.pwm
        try:
            for hz, ms in events:
                if hz > 0:
                    f = int(hz)
                    if f < 1:
                        f = 1
                    if pwm.frequency != f:
                        pwm.frequency = f
                    pwm.duty_cycle = DUTY_ON
                else:
                    pwm.duty_cycle = 0
                deadline += int(ms * 1e6)
                if budget is not None and deadline > budget:
                    self._wait_until(budget)
                    return False
                self._wait_until(deadline)
        finally:
            pwm.duty_cycle = 0
        return True

    @staticmethod
    def _wait_until(t_ns):
        remaining = t_ns - time.monotonic_ns()
        if remaining > 2000000:
            time.sleep((remaining - 1000000) / 1e9)
        while time.monotonic_ns() < t_ns:
            pass

    def deinit(self):
        self.pwm.deinit()
