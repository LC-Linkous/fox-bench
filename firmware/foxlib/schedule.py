# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/schedule.py -- deterministic scheduling. No hardware imports.
# glibc-constant LCG with an integer seed so CircuitPython, desktop Python and
# js/audio/schedule.js produce identical sequences: organisers can reconstruct
# every transmission time from the seed.

_A, _C, _M = 1103515245, 12345, 1 << 31


def rand_next(state):
    state = (_A * state + _C) % _M
    return state / _M, state


def rand_int(state, lo, hi):
    v, state = rand_next(state)
    return lo + int(v * (hi - lo + 1)), state


class Fixed:
    kind = "fixed"

    def __init__(self, cfg):
        self.delay_ms = cfg["delay_ms"]

    def phase(self, now_ms):
        return "alive"

    def wait_ms(self, now_ms):
        return self.delay_ms


class Popcorn:
    kind = "popcorn"

    def __init__(self, cfg):
        self.cfg = cfg
        self.state = cfg["seed"]
        self.in_cluster = 0

    def phase(self, now_ms):
        return "alive"

    def wait_ms(self, now_ms):
        self.in_cluster += 1
        if self.in_cluster >= self.cfg["cluster"]:
            self.in_cluster = 0
            d, self.state = rand_int(self.state, self.cfg["dark_min_ms"], self.cfg["dark_max_ms"])
            return d
        return self.cfg["cluster_gap_ms"]


class Resurrection:
    """alive for a seeded draw; dead (single dits, full ID every Nth wake) for dead_ms; repeat."""
    kind = "resurrection"

    def __init__(self, cfg):
        self.cfg = cfg
        self.state = cfg["seed"]
        self.dead = False
        self.wakes = 0
        self.until = None          # end of the current phase, ms; set on first phase() call

    def _draw(self, lo, hi):
        v, self.state = rand_int(self.state, lo, hi)
        return v

    def phase(self, now_ms):
        c = self.cfg
        if self.until is None:
            self.until = now_ms + self._draw(c["alive_min_ms"], c["alive_max_ms"])
        if now_ms >= self.until:
            if self.dead:
                self.dead = False
                self.until = now_ms + self._draw(c["alive_min_ms"], c["alive_max_ms"])
            else:
                self.dead = True
                self.wakes = 0
                self.until = now_ms + c["dead_ms"]
        return "dead" if self.dead else "alive"

    def dead_wake(self):
        """called once per dead-phase wake: returns 'id' or 'dit'"""
        self.wakes += 1
        return "id" if self.wakes % self.cfg["id_every"] == 0 else "dit"

    def wait_ms(self, now_ms):
        c = self.cfg
        if self.dead:
            return self._draw(c["dit_min_ms"], c["dit_max_ms"])
        return c["delay_ms"]


def make(cfg):
    kind = cfg.get("kind")
    if kind == "popcorn":
        return Popcorn(cfg)
    if kind == "resurrection":
        return Resurrection(cfg)
    return Fixed(cfg if "delay_ms" in cfg else {"delay_ms": 30000})
