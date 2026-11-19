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

RESETS_MAX = 50          # a supply or a hang: keep trying (the field case this file is for)
CRASH_RESETS_MAX = 3     # a crash in CircuitPython itself: it will crash again; stop early so the bench can get in
RECOVER_S = 5

# supervisor.SafeModeReason members in CircuitPython 9.2 (shared-bindings/supervisor/SafeModeReason.c) that mean
# "something went wrong while running"; a name a build lacks is skipped by the getattr below. The first two are
# the field cases; the rest are crashes, which a reset does not cure -- the ESP32-C3 crashing in esp_wifi_init on
# every boot (foxlib 1.10.6) looped here fifty times, five seconds apart, with no way to connect in between.
AUTO_RESET = ("BROWNOUT", "WATCHDOG", "HARD_FAULT", "STACK_OVERFLOW", "GC_ALLOC_OUTSIDE_VM",
              "NLR_JUMP_FAIL", "INTERRUPT_ERROR", "SDK_FATAL_ERROR", "NO_HEAP")
FIELD = ("BROWNOUT", "WATCHDOG")
NVM_REASON = 1           # microcontroller.nvm[1]: 1 + index into AUTO_RESET of the last safe mode this file saw
                         # (the page's Re-read board shows it; guard.healthy() leaves it, nvm[0] is the count)


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
    try:
        microcontroller.nvm[NVM_REASON] = 1 + AUTO_RESET.index(names[0])
    except Exception:
        pass
    limit = RESETS_MAX if names[0] in FIELD else CRASH_RESETS_MAX
    if n < limit:
        microcontroller.nvm[0] = n + 1
        print("fox safemode: %s, reset %d of %d in %d s" % (names[0], n + 1, limit, RECOVER_S))
        time.sleep(RECOVER_S)
        microcontroller.reset()
    else:
        print("fox safemode: %s, %d consecutive resets; staying in safe mode (the board can be connected to now)" % (names[0], n))
else:
    print("fox safemode: %r; staying in safe mode" % (reason,))
