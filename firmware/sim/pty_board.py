#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# sim/pty_board.py -- a fake CircuitPython board on a pseudo-terminal, for testing
# tools that talk to a real one (tools/hw_smoke.py) without hardware.
#
#   python3 firmware/sim/pty_board.py            prints the port to use, e.g. /dev/pts/4
#   python3 tools/hw_smoke.py --port /dev/pts/4 --yes-antenna
#
# It speaks the REPL protocol (Ctrl-C/A/B/D, "OK" <out> ^D <err> ^D ">") and
# keeps a flash directory. Code run in raw mode is real Python executed in a
# worker process inside that directory with the simulator's hardware mocks
# installed, so file operations, `import foxlib`, bench calls and a soft
# reboot (code.py under the mocks for a few virtual seconds) all behave.
#
#   python3 firmware/sim/pty_board.py --replay bench.json
#
# answers from a recording made by tools/hw_smoke.py --record instead: each
# raw-mode command is looked up by its text and the board's recorded reply
# is returned, a soft reboot returns the recorded boot text, and anything
# the recording does not contain is answered with an error that says so.
# That makes a bench run a test that needs no board (docs/bench-recordings.md).
# Linux/macOS only (openpty).
import os, pty, re, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(HERE, "pty_worker.py")
CP_BANNER = b"Adafruit CircuitPython 10.0.0 on 2025-09-10; Seeed Xiao ESP32C3 with ESP32-C3"


class Board:
    def __init__(self, flash, running=False, quiet=False, replay=None):
        self.flash = flash; self.state = "running" if running else "friendly"; self.code = b""; self.quiet = quiet
        self.master, slave = pty.openpty()
        self.port = os.ttyname(slave)
        self.reboots = 0
        self.replay = Replay(replay) if replay else None

    def emit(self, b): os.write(self.master, b)
    def log(self, *a):
        if not self.quiet: print("[pty_board]", *a, file=sys.stderr, flush=True)

    def boot_worker(self):
        self.kill_vm()
        p = subprocess.run([sys.executable, WORKER, self.flash, "boot"], capture_output=True, timeout=120)
        return p.stdout, p.stderr

    def kill_vm(self):
        if getattr(self, "vm", None):
            try: self.vm.kill(); self.vm.wait(timeout=5)
            except Exception: pass
            self.vm = None

    def exec_in_vm(self, code):
        """A REPL session is one VM: globals persist between commands until the next soft reboot."""
        import json
        if self.replay: return self.replay.exec(code)
        if not getattr(self, "vm", None):
            self.vm = subprocess.Popen([sys.executable, WORKER, self.flash, "exec"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.vm.stdin.write(json.dumps({"code": code.decode()}) + "\n"); self.vm.stdin.flush()
        line = self.vm.stdout.readline()
        if not line:
            self.vm = None; return b"", b"RuntimeError: VM died\n"
        r = json.loads(line)
        return r["out"].encode(), r["err"].encode()

    def handle(self, ch):
        st = self.state
        if st == "running":
            if ch == b"\x03":
                self.emit(b"\r\nTraceback (most recent call last):\r\n  File \"code.py\", line 15, in <module>\r\nKeyboardInterrupt: \r\n\r\nCode done running.\r\n\r\nPress any key to enter the REPL. Use CTRL-D to reload.\r\n")
                self.state = "anykey"
            return
        if st == "anykey":
            if ch == b"\x04": return self.reboot()
            self.kill_vm(); self.emit(b"\r\n" + CP_BANNER + b"\r\n>>> "); self.state = "friendly"; return
        if st == "friendly":
            if ch == b"\x03": self.emit(b"\r\nKeyboardInterrupt\r\n>>> ")
            elif ch == b"\x01": self.emit(b"\r\nraw REPL; CTRL-B to exit\r\n>"); self.state = "raw"; self.code = b""
            elif ch == b"\x04": self.reboot()
            elif ch == b"\r": self.emit(b"\r\n>>> ")
            else: self.emit(ch)
            return
        if st == "raw":
            if ch == b"\x02": self.emit(b"\r\n" + CP_BANNER + b"\r\n>>> "); self.state = "friendly"
            elif ch == b"\x01": self.emit(b"\r\nraw REPL; CTRL-B to exit\r\n>"); self.code = b""
            elif ch == b"\x03": self.code = b""; self.emit(b"\r\n>")
            elif ch == b"\x04":
                code, self.code = self.code, b""
                if not code: self.emit(b"OK\x04\x04>"); return
                self.emit(b"OK")
                out, err = self.exec_in_vm(code)
                self.log("exec", code.split(b"\n")[0][:60], "->", (out or err)[:60])
                self.emit(out.replace(b"\n", b"\r\n") + b"\x04" + err + b"\x04>")
            else: self.code += ch

    def reboot(self):
        self.reboots += 1; self.state = "running"
        if self.replay:
            text = self.replay.reboot()
            self.log("replay boot ->", text.strip().splitlines()[-1][:80] if text.strip() else "(empty)")
            self.emit(text.replace("\n", "\r\n").encode())
            # what the fox printed while the bench script listened after that boot, so the listen window sees it too
            tail = self.replay.listen_text()
            if tail: self.emit(tail.replace("\n", "\r\n").encode())
            return
        self.emit(b"\r\nsoft reboot\r\n\r\nAuto-reload is on. Simply save files over USB to run them or enter REPL to disable.\r\ncode.py output:\r\n")
        out, err = self.boot_worker()
        self.log("boot ->", out.strip().splitlines()[-1][:80] if out.strip() else err[-200:])
        self.emit(out.replace(b"\n", b"\r\n") + (err.replace(b"\n", b"\r\n") if err else b""))

    def serve(self):
        while True:
            try: data = os.read(self.master, 1024)
            except OSError: return
            if not data: return
            for i in range(len(data)):
                self.handle(data[i:i + 1])


class Replay:
    """Answers REPL exchanges from a tools/hw_smoke.py --record file.

    Commands are matched by text: the next unconsumed exchange with the same command text, searched from the cursor
    and then from the start (a command the run repeats, like the verify snippet, is answered the way it was
    answered that time). Each recorded exchange answers once. A command with no unconsumed match — never recorded,
    or sent more times than it was recorded — gets an error reply naming it, so a changed hw_smoke.py shows up as a
    failed check rather than a hang. A soft reboot returns the next recorded boot text."""
    def __init__(self, path):
        import json
        self.rec = json.load(open(path))
        if self.rec.get("format") != "fox-bench-bench-recording/1":
            raise SystemExit("%s: not a fox-bench bench recording" % path)
        self.ex = self.rec["exchanges"]
        self.used = [False] * len(self.ex)
        self.cursor = 0
        self.misses = []
    def _take(self, kind, cmd=None):
        for i in range(self.cursor, len(self.ex)):
            e = self.ex[i]
            if not self.used[i] and e["kind"] == kind and (cmd is None or e.get("cmd") == cmd):
                self.used[i] = True; self.cursor = i + 1; return e
        for i, e in enumerate(self.ex):
            if not self.used[i] and e["kind"] == kind and (cmd is None or e.get("cmd") == cmd):
                self.used[i] = True; return e
        return None
    def exec(self, code):
        e = self._take("exec", code.decode())
        if e is None:
            self.misses.append(code.decode().split("\n")[0][:80])
            return b"", ("ReplayError: command not in the recording: %r\n" % code.decode().split("\n")[0][:60]).encode()
        return e["out"].encode(), e["err"].encode()
    def reboot(self):
        e = self._take("reboot")
        return e["out"] if e else "ReplayError: no recorded reboot left\n"
    def listen_text(self):
        e = self._take("listen")
        return e["out"] if e else ""


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--flash", help="directory to use as the board's filesystem (default: a fresh temp dir)")
    ap.add_argument("--running", action="store_true", help="start with code.py running (as a fox in the field)")
    ap.add_argument("--replay", help="answer from a tools/hw_smoke.py --record file instead of running code")
    ap.add_argument("--replay-report", help="with --replay: write {misses, used, total} here when the port closes (CI checks misses == 0)")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    flash = a.flash or tempfile.mkdtemp(prefix="pty-flash-")
    b = Board(flash, a.running, a.quiet, a.replay)
    print(b.port, flush=True)
    def write_replay_report(*_):
        if b.replay and a.replay_report:
            import json
            r = b.replay
            json.dump({"misses": r.misses, "used": sum(r.used), "total": len(r.ex)}, open(a.replay_report, "w"), indent=1)
    import signal
    signal.signal(signal.SIGTERM, lambda *_: (write_replay_report(), sys.exit(0)))
    try: b.serve()
    finally: write_replay_report()


if __name__ == "__main__":
    main()
