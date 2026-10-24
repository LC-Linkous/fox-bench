#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# sim/pty_worker.py -- one REPL command (or one boot) for pty_board.py, in a fresh process.
#   python3 pty_worker.py FLASHDIR exec               JSON lines in/out, one REPL VM session
#   python3 pty_worker.py FLASHDIR boot               run code.py under the mocks for a few virtual seconds
import json, os, sys, traceback, types, time as _time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mocks                      # noqa: E402
import run as simrun              # noqa: E402

flash, mode = sys.argv[1], sys.argv[2]
UID = bytes.fromhex("85c818eae840")


def effective():
    try:
        defaults = json.load(open(os.path.join(flash, "defaults.json")))
    except Exception:
        defaults = None
    try:
        fox = json.load(open(os.path.join(flash, "fox.json")))
    except Exception:
        fox = {}
    if defaults and "net" in defaults:
        return None                             # a network fox: the mocks' defaults (both radios) serve
    if defaults:
        eff, _ = simrun.fwcfg.validate(fox, defaults, simrun.BOARD_NAMES, defaults.get("board"))
        return eff
    return None


def install_mocks(cap_ms):
    eff = effective()
    scen = {"cap_ms": cap_ms, "board_id": "seeed_xiao_esp32c3", "board_names": simrun.BOARD_NAMES}
    if eff:
        scen.update(module_ranges=eff["radio"]["ranges_mhz"], pin_roles=eff["pins"], divider_ratio=eff["battery"]["divider_ratio"])
    rec = mocks.install(scen)
    # things the simulator's mocks do not provide but a REPL session touches
    mc = sys.modules["microcontroller"]
    if not hasattr(mc, "cpu"):
        mc.cpu = types.SimpleNamespace(uid=UID)
    else:
        mc.cpu.uid = UID
    import gc
    gc.mem_free = lambda: 120000
    # time.monotonic under the mocks is virtual; a real REPL measures wall time for import timing
    sys.modules["time"].monotonic = _time.monotonic
    return rec


os.chdir(flash)
sys.path.insert(0, flash)
if mode == "boot":
    try:
        rec, err = simrun.boot_dir(flash, cap_ms=20000, stop_after_unkeys=3)
        sys.stdout.write("\n".join(rec.prints) + ("\n" if rec.prints else ""))
    except Exception:
        err = traceback.format_exc()            # no code.py / defaults.json: what CircuitPython prints is a traceback too
    if err:
        sys.stderr.write(err.strip().splitlines()[-1] + "\n\nCode done running.\n\nPress any key to enter the REPL. Use CTRL-D to reload.\n")
    sys.exit(0)

# exec mode: a persistent VM. One JSON line in ({"code": ...}), one JSON line out ({"out": ..., "err": ...}),
# globals kept between commands like a real REPL session; the process is replaced on soft reboot.
import io, contextlib
install_mocks(cap_ms=10 ** 9)
G = {"__name__": "__main__"}
for line in sys.stdin:
    req = json.loads(line)
    out, err = io.StringIO(), ""
    try:
        with contextlib.redirect_stdout(out):
            exec(compile(req["code"], "<stdin>", "exec"), G)
    except mocks.SimDone:
        pass
    except Exception:
        tb = traceback.format_exc().strip().splitlines()
        err = "Traceback (most recent call last):\n  File \"<stdin>\", line 1, in <module>\n" + tb[-1] + "\n"
    sys.stdout.write(json.dumps({"out": out.getvalue(), "err": err}) + "\n"); sys.stdout.flush()
