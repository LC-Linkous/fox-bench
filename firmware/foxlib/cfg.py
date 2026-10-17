# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""Configuration: defaults -> fox.json override -> validation -> banner.

load(path, defaults) returns (config_dict, report) where report is the
list of (dotted_key, reason) fallbacks used to build the cfg= field of
the boot banner. Rules are in CONFIG.md; this module and the page's
js/model/schema.js are two independent implementations of that document.

Validation order matters: schema -> template -> board -> pins -> the rest.
A fatal pin or plan problem sets report.fatal so Fox boots silent.
"""


def load(path, defaults):
    raise NotImplementedError


def validate(user, defaults, board_pins):
    """pure: no filesystem, no hardware. Testable on the desktop."""
    raise NotImplementedError


def banner(fox):
    """FOX template=... foxlib=... board=... uid=... cfg=... radio=... id=... freq=..."""
    raise NotImplementedError
