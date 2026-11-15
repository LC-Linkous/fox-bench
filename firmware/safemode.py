# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench safemode.py -- runs INSTEAD of code.py when CircuitPython boots into safe mode.
#
# A fox in the field gets there two ways: the supply dipped while the module keyed (brownout), or the hardware
# watchdog fired because the interpreter hung. Left alone the board sits in safe mode, silent, until someone power
# cycles it. This file resets it back into a normal boot, after a pause for the supply to recover, and counts how
# many times in a row it has had to (microcontroller.nvm[0]; foxlib.guard.healthy() clears the count once a cycle
# completes). After RESETS_MAX consecutive resets the board stays in safe mode so it can be looked at.
#
# Safe mode entered on purpose -- the reset button pressed twice (USER), supervisor.reset_into_safe_mode()
# (PROGRAMMATIC), a flash write failure, a USB descriptor problem -- is left alone: someone wants the drive.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY; see firmware/LICENSE.
import time
import microcontroller
import supervisor

RESETS_MAX = 50
RECOVER_S = 5

AUTO_RESET = ("BROWNOUT", "WATCHDOG", "HARD_FAULT", "STACK_OVERFLOW", "HEAP_OVERWRITTEN", "GC_ALLOC_OUTSIDE_VM",
              "NLR_JUMP_FAIL", "INTERRUPT_ERROR", "SDK_FATAL_ERROR", "NO_HEAP")


def recovery_enabled():
    """fox.json limits.recover (the page's 'enable automatic recovery attempts'); absent = on."""
    try:
        import json
        with open("fox.json") as f:
            return bool(json.load(f).get("limits", {}).get("recover", True))
    except Exception:
        return True


reason = supervisor.runtime.safe_mode_reason
names = [n for n in AUTO_RESET if getattr(supervisor.SafeModeReason, n, None) == reason]
if names and not recovery_enabled():
    print("fox safemode: %s; recovery is off in fox.json, staying in safe mode" % names[0])
elif names:
    n = microcontroller.nvm[0]
    if n == 0xFF:            # erased flash: never written
        n = 0
    if n < RESETS_MAX:
        microcontroller.nvm[0] = n + 1
        print("fox safemode: %s, reset %d of %d in %d s" % (names[0], n + 1, RESETS_MAX, RECOVER_S))
        time.sleep(RECOVER_S)
        microcontroller.reset()
    else:
        print("fox safemode: %s, %d consecutive resets; staying in safe mode" % (names[0], n))
else:
    print("fox safemode: %r; staying in safe mode" % (reason,))
