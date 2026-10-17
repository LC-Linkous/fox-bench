# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""Deterministic scheduling. No hardware imports.

The LCG uses glibc constants and an integer seed so CircuitPython, desktop
Python and js/audio/schedule.js produce identical sequences: organisers
(and the page's Timeline view) can reconstruct every transmission time.

Schedulers expose wait_ms(cycle_index, context) -> ms to sleep after the
current transmission, and for resurrection, phase() -> 'alive' | 'dead'
plus what a dead-phase wake should transmit.
"""

_A, _C, _M = 1103515245, 12345, 1 << 31


def rand_next(state):
    state = (_A * state + _C) % _M
    return state / _M, state


def rand_int(state, lo, hi):
    v, state = rand_next(state)
    return lo + int(v * (hi - lo + 1)), state


class Fixed:
    pass


class Popcorn:
    pass


class Resurrection:
    pass


def make(schedule_cfg):
    raise NotImplementedError
