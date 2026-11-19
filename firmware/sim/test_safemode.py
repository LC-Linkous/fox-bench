# SPDX-License-Identifier: GPL-3.0-or-later
# test_safemode.py -- firmware/safemode.py on the host, under a fake supervisor/microcontroller: a brownout or a
# watchdog resets the board (up to RESETS_MAX in a row), a crash only CRASH_RESETS_MAX times, and safe mode entered
# on purpose is left alone. Run from anywhere: python3 firmware/sim/test_safemode.py
import os, sys, types, io, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "..", "safemode.py")).read()
REASONS = ["BROWNOUT", "WATCHDOG", "HARD_FAULT", "NO_HEAP", "USER", "PROGRAMMATIC"]


def run(reason, nvm0, cwd_has_fox=False):
    sup = types.ModuleType("supervisor")
    sup.SafeModeReason = types.SimpleNamespace(**{r: r for r in REASONS})
    sup.runtime = types.SimpleNamespace(safe_mode_reason=reason)
    mc = types.ModuleType("microcontroller")
    mc.nvm = bytearray(b"\xff" * 16); mc.nvm[0] = nvm0
    resets = []
    mc.reset = lambda: resets.append(True)
    t = types.ModuleType("time"); t.sleep = lambda s: None
    old = {k: sys.modules.get(k) for k in ("supervisor", "microcontroller", "time")}
    sys.modules.update(supervisor=sup, microcontroller=mc, time=t)
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            exec(compile(SRC, "safemode.py", "exec"), {"__name__": "__main__"})
    finally:
        for k, v in old.items():
            if v is None: sys.modules.pop(k, None)
            else: sys.modules[k] = v
    return bool(resets), mc.nvm[0], mc.nvm[1], out.getvalue().strip()


fails = []
def check(name, got, want):
    if got != want: fails.append("%s: got %r, want %r" % (name, got, want))

os.chdir(HERE)                                   # no fox.json here: recovery defaults to on
r, n, why, msg = run("BROWNOUT", 0xFF)
check("brownout on erased flash resets", r, True); check("count becomes 1", n, 1); check("reason remembered", why, 1)
r, n, why, msg = run("WATCHDOG", 49)
check("watchdog: 50th reset still happens", r, True); check("count 50", n, 50); check("reason WATCHDOG", why, 2)
r, n, why, msg = run("WATCHDOG", 50)
check("watchdog: after 50 stays in safe mode", r, False); check("stays says connectable", "connected to now" in msg, True)
r, n, why, msg = run("HARD_FAULT", 0)
check("a crash resets the first time", r, True); check("crash reason remembered", why, 3)
r, n, why, msg = run("HARD_FAULT", 3)
check("a crash stops after 3 in a row (the C3 loop)", r, False)
r, n, why, msg = run("NO_HEAP", 2)
check("third crash reset still happens", r, True); check("count 3", n, 3)
r, n, why, msg = run("USER", 0)
check("double-tap reset is left alone", r, False); check("count untouched", n, 0); check("reason not written", why, 0xFF)
r, n, why, msg = run("PROGRAMMATIC", 7)
check("reset_into_safe_mode is left alone", r, False)

for f in fails: print("FAIL " + f)
print("safemode: %d checks, %d failed" % (14, len(fails)))
sys.exit(1 if fails else 0)
