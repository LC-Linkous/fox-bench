# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/led.py -- the status-LED vocabulary, one place so every template blinks the same.
#   alive          1 short blink per cycle
#   low            3 quick blinks per cycle
#   critical       slow continuous blink while locked out
#   unconfigured   double blink every 2 s (callsign unset or fatal config: silent on RF)
#   keydown-limit  one long blink when a transmission was cut by limits

import time
import digitalio

PATTERNS = {
    "alive": [(80, 140)],
    "low": [(80, 140), (80, 140), (80, 140)],
    "critical": [(500, 500)],
    "unconfigured": [(80, 120), (80, 1720)],
    "keydown-limit": [(600, 200)],
}


class Status:
    def __init__(self, pin):
        self.pin = None
        if pin is not None:
            self.pin = digitalio.DigitalInOut(pin)
            self.pin.direction = digitalio.Direction.OUTPUT
            self.pin.value = False

    def _set(self, on):
        if self.pin:
            self.pin.value = on

    def show(self, pattern):
        for on_ms, off_ms in PATTERNS.get(pattern, PATTERNS["alive"]):
            self._set(True)
            time.sleep(on_ms / 1000)
            self._set(False)
            time.sleep(off_ms / 1000)

    def hold(self, ms, pattern=None):
        """sleep ms; if pattern is given, loop it the whole time."""
        if not pattern or not self.pin:
            time.sleep(ms / 1000)
            return
        end = time.monotonic() + ms / 1000
        while time.monotonic() < end:
            for on_ms, off_ms in PATTERNS[pattern]:
                self._set(True)
                time.sleep(on_ms / 1000)
                self._set(False)
                time.sleep(off_ms / 1000)
                if time.monotonic() >= end:
                    break
        self._set(False)
