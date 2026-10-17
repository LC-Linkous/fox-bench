# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""The per-cycle prologue every fox repeats, written once.

run(fox) is a generator. Each iteration:
    1. read battery (if any) -> policy -> critical lockout handled here
       (hold 60 s with LED 'critical', loop again)
    2. unconfigured (id unset and not tx_without_callsign, or cfg fatal)
       -> hold with LED 'unconfigured', never key, loop again
    3. choose LED pattern, assemble id_message (+ telemetry)
    4. schedule.phase(): for resurrection 'dead' wakes, perform the dit /
       periodic ID here and continue; templates never see dead wakes
    5. yield Tx inside radio.keyed() -- PTT released in finally even if
       the template body raises or the REPL interrupts
    6. plan: retune to the next frequency (with optional QSY announcement
       sent before unkey)
    7. sleep schedule.wait_ms()

Tx offers: id_message, low_battery, volts, cycle, morse(text, **kw),
play(events), remaining_ms (keydown budget, None if unlimited).
"""


class Tx:
    pass


def run(fox):
    raise NotImplementedError
