# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/guard.py -- keeping a fox alive for a whole hunt: the hardware watchdog and the safe-mode counter.
#
# A fox that stops after hours in the field has usually not raised anything the template could see:
#   * the supply dipped while the module keyed (brownout) -> CircuitPython reboots into SAFE MODE, where code.py
#     is never run again. safemode.py (shipped beside code.py) resets the board out of it; the count of those
#     resets lives in microcontroller.nvm so a board that cannot stay up stops trying after SAFEMODE_RESETS_MAX.
#   * the interpreter hung (a console write with nobody reading, a stuck peripheral) -> nothing in Python runs.
#     The hardware watchdog (limits.watchdog_s) resets the board; the reset lands in safe mode too, and
#     safemode.py handles it the same way.
# healthy() clears the counter once a cycle has completed, so only *consecutive* failures count.
#
# arm() is called by cycle.run() only, never by a bench Fox(quiet=True): the page's REPL session must not be reset
# under the operator. feed() is cheap and safe to call when nothing is armed.

_wd = None
NVM_RESETS = 0            # microcontroller.nvm[0]: consecutive safe-mode resets (safemode.py increments it)


def arm(seconds):
    """Start the hardware watchdog in RESET mode. Returns a status word for the boot log."""
    global _wd
    if not seconds:
        return "off"
    try:
        import microcontroller
        from watchdog import WatchDogMode
        w = microcontroller.watchdog
        w.timeout = float(seconds)
        w.mode = WatchDogMode.RESET
        w.feed()
        _wd = w
        return "%ds" % seconds
    except Exception as e:
        _wd = None
        return "unavailable(%s)" % e.__class__.__name__


def feed():
    if _wd is not None:
        try:
            _wd.feed()
        except Exception:
            pass


def disarm():
    """Stop the watchdog (bench sessions, deinit). Not every port can stop one; then it keeps being fed by nothing,
    which is why arm() never runs for a bench Fox."""
    global _wd
    w, _wd = _wd, None
    if w is None:
        try:
            import microcontroller
            w = microcontroller.watchdog
        except Exception:
            return
    try:
        w.deinit()
    except Exception:
        pass


def sleep(seconds):
    """time.sleep that keeps feeding the watchdog; whole seconds at a time."""
    import time
    feed()
    while seconds > 0:
        step = 1.0 if seconds > 1.0 else seconds
        time.sleep(step)
        seconds -= step
        feed()


def healthy():
    """A cycle completed: clear the consecutive safe-mode reset counter (a flash write only when it is set)."""
    try:
        import microcontroller
        if microcontroller.nvm[NVM_RESETS] not in (0, 0xFF):      # 0xFF: never written (erased flash)
            microcontroller.nvm[NVM_RESETS] = 0
    except Exception:
        pass


def resets():
    """How many safe-mode resets led to this boot (0 normally), for the boot log."""
    try:
        import microcontroller
        n = microcontroller.nvm[NVM_RESETS]
        return 0 if n == 0xFF else n
    except Exception:
        return 0
