# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/report.py -- what cfg.py (FM) and netcfg.py (network) share: the validation report and the small value helpers.
# Its own module so a network fox does not carry cfg.py's 17 kB for one class (foxlib 1.10.8: files per template).

SCHEMA = 1


def _copy(o):
    if isinstance(o, dict):
        return {k: _copy(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_copy(v) for v in o]
    return o


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v):
    return (isinstance(v, (int, float))) and not isinstance(v, bool)


def _intify(v):
    """JSON has one number type: a hand-edited '3.0' means 3. Floats with an integral value become ints, recursively."""
    if isinstance(v, float) and v == int(v):
        return int(v)
    if isinstance(v, dict):
        return {k: _intify(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_intify(x) for x in v]
    return v


class Report:
    def __init__(self):
        self.items = []       # (key, reason)
        self.fatal = None
        self.mode = "ok"      # ok | partial | default(<why>) | fatal

    def bad(self, key, reason):
        self.items.append((key, reason))

    def status(self):
        if self.fatal:
            return "fatal(%s)" % self.fatal
        if self.mode.startswith("default"):
            return self.mode
        if self.items:
            return "partial(%s)" % ",".join(k for k, _ in self.items)
        return "ok"
