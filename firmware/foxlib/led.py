# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""Status LED vocabulary. One place, so every template blinks the same.

    alive          1 short blink per cycle
    low            3 quick blinks per cycle
    critical       slow continuous blink while locked out
    unconfigured   double blink every 2 s (callsign unset or fatal config;
                   the fox is silent on RF, so this is the only sign of life)
    keydown-limit  one long blink when a transmission was cut by limits
"""


class Status:
    def __init__(self, pin):
        raise NotImplementedError

    def show(self, pattern):
        raise NotImplementedError

    def hold(self, ms, pattern="critical"):
        """sleep ms while showing pattern"""
        raise NotImplementedError
