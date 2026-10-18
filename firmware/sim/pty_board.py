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
# Linux/macOS only (openpty).
import os, pty, re, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(HERE, "pty_worker.py")
CP_BANNER = b"Adafruit CircuitPython 10.0.0 on 2025-09-10; Seeed Xiao ESP32C3 with ESP32-C3"


class Board:
    def __init__(self, flash, running=False, quiet=False):
        self.flash = flash; self.state = "running" if running else "friendly"; self.code = b""; self.quiet = quiet
        self.master, slave = pty.openpty()
        self.port = os.ttyname(slave)
        self.reboots = 0

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


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--flash", help="directory to use as the board's filesystem (default: a fresh temp dir)")
    ap.add_argument("--running", action="store_true", help="start with code.py running (as a fox in the field)")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    flash = a.flash or tempfile.mkdtemp(prefix="pty-flash-")
    b = Board(flash, a.running, a.quiet)
    print(b.port, flush=True)
    b.serve()


if __name__ == "__main__":
    main()
