# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netfeatures.py -- the contest features of a network fox, attached to the runner's hooks.
#
# Phase A (docs/network-fox-payloads-plan.md): the four sections (payload, checkpoint, sense, stealth) are validated
# by netcfg and named in the banner; their behaviour arrives in phases B-E as modules that register functions on
# fox.hooks["before_up" | "while_up" | "after_down"]. Until a module exists, attach() returns the section's name so the
# banner can say it is accepted but not built -- the fox never pretends.
from . import netcfg

# section -> module name once built; None = not in this foxlib yet
MODULES = {"payload": "netpayload", "checkpoint": None, "sense": None, "stealth": None}


def attach(fox):
    """Register every enabled, built feature on the fox's hooks. Returns the enabled sections that have no module."""
    unbuilt = []
    for sec in netcfg.enabled_features(fox.cfg):
        mod = MODULES.get(sec)
        if mod is None:
            unbuilt.append(sec)
            continue
        try:
            m = __import__("foxlib." + mod, None, None, ["attach"])
            m.attach(fox)
        except Exception as e:
            fox.log("%s: not attached (%s)" % (sec, e.__class__.__name__))
            unbuilt.append(sec)
    return unbuilt
