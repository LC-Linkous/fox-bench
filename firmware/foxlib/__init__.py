# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""foxlib -- shared firmware library for fox-bench transmitters.

A template's code.py does:

    import foxlib
    fox = foxlib.Fox("fox.json")
    for tx in fox.cycles():
        tx.morse(tx.id_message)
        ...

Fox.__init__ loads and validates config (cfg), brings up the radio
(sa868), battery monitor (battery, or None), status LED (led), tone
transmitter (tones) and scheduler (schedule), then prints the boot
banner. cycles() is implemented in cycle.py.
"""
from . import cfg, cycle

__version__ = open(__file__.rsplit("/", 1)[0] + "/VERSION").read().strip()


class Fox:
    def __init__(self, path="fox.json", defaults=None):
        """defaults: the template's complete per-board default dict
        (templates embed it; see templates/<id>/code.py)."""
        raise NotImplementedError

    def cycles(self):
        """yield one Tx context per transmission cycle; see cycle.py"""
        return cycle.run(self)

    # objects the bench tab drives after Ctrl-C through exec-and-capture:
    #   fox.radio   sa868.Radio   .key(seconds) .rssi() .retune(mhz) .probe()
    #   fox.batt    battery.Monitor or None   .read()
    #   fox.led     led.Status
    #   fox.cfg     validated config dict
