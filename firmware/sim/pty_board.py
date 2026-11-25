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
# That makes a bench run a test that needs no board (docs/bench-runbook.md).
# A recording made on a foxlib-c board ("transport": "console") is replayed
# in line mode instead: the fake answers `version`, `get`, `put` and the
# bench words the way the console did (ConsoleBoard below).
# Linux/macOS only (openpty).
import ast, os, pty, re, subprocess, sys, tempfile, threading, time, zlib

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
        p = subprocess.run([sys.executable, "-B", WORKER, self.flash, "boot"], capture_output=True, timeout=120)   # -B: no __pycache__ in the fake flash (a real board has none, and hw_smoke's stale-file sweep would trip on it)
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
            self.vm = subprocess.Popen([sys.executable, "-B", WORKER, self.flash, "exec"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
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


class ConsoleBoard:
    """A foxlib-c console (PicoFox or ESP32) on a pty: one command per line, replies ending `ok…` / `err:…`, files
    over `get` / `put` / `rm` (PROTOCOL.md, "Files over the console"). Live (--console TARGET) it is a small fake fox:
    a file store, a banner built from the fox.json it holds, and the bench words answered plausibly — enough for
    tools/hw_smoke.py to make a console recording without a board. Replaying a console recording ("transport":
    "console") it answers `put` from the bytes received (send / ok size= crc32=), everything else from the recording,
    and a reload (a put or rm of fox.json / defaults.json) emits the next recorded banner and the listen window after
    it, as the real fox prints them on its own."""
    CFG_FILES = ("fox.json", "defaults.json")
    def __init__(self, replay=None, quiet=False, board="esp32c3-foxlibc"):
        import json
        self.replay = replay; self.quiet = quiet; self.board = board
        self.master, slave = pty.openpty()
        self.port = os.ttyname(slave)
        self.buf = b""; self.put = None
        self.files = {"defaults.json": json.dumps({"template": "wifi-beacon", "id": {"callmessage": "N0CALL DECOY DECOY N0CALL"}, "net": {"kind": "wifi-ap"}}).encode()}
        self.picofox = board.startswith("picofox")
    def emit(self, text): os.write(self.master, text.replace("\n", "\r\n").encode() if isinstance(text, str) else text)
    def log(self, *a):
        if not self.quiet: print("[pty_board]", *a, file=sys.stderr, flush=True)
    # ---- the live fake
    def banner(self):
        import json
        try: cfg = json.loads(self.files.get("fox.json") or self.files["defaults.json"])
        except ValueError: cfg = {"template": "?", "id": {}}
        call = (cfg.get("id") or {}).get("callmessage", "")
        if self.picofox:
            return "FOX template=%s/1.0.0 foxlib=c-0.1.14 board=picofox-foxlibc uid=e66138528b4c1234 cfg=ok radio=ok id=%s freq=146.5650 mode=fm\n" % (cfg.get("template", "?"), "set" if call and "N0CALL" not in call else "unset")
        kind = (cfg.get("net") or {}).get("kind", "wifi-ap")
        lines = "FOX template=%s/1.0.1 foxlib=c-0.1.14 board=%s uid=0123456789abcdef cfg=ok radio=ok id=%s freq=none net=%s name=\"%s\" mac=F2:B0:00:00:00:01 clock=unset mem=180000\n" % (
            cfg.get("template", "?"), self.board, "set" if call and "N0CALL" not in call else "unset", kind, call)
        if kind != "wifi-ap": lines += "  note: %s is not in this firmware yet: the fox stays silent\n" % kind
        return lines + "cycle 0\n" + ("wifi-ap up: %s (F2:B0:00:00:00:01) for 15 s\n" % call if kind == "wifi-ap" else "")
    def live(self, text):
        import base64, json
        cmd, _, arg = text.partition(" ")
        if cmd == "version": self.emit("foxlib-c 0.1.14 board=%s\nok\n" % self.board)
        elif cmd == "uid": self.emit("uid=%s\nok\n" % ("e66138528b4c1234" if self.picofox else "0123456789abcdef"))
        elif cmd == "files": self.emit("  ".join("%s (%d B)" % (n, len(b)) for n, b in sorted(self.files.items())) + "\nok\n")
        elif cmd == "get":
            b = self.files.get(arg)
            if b is None: self.emit("err: no such file\n"); return
            b64 = base64.b64encode(b).decode()
            self.emit("size=%d crc32=%08x\n" % (len(b), zlib.crc32(b) & 0xffffffff) + "".join(b64[i:i + 76] + "\n" for i in range(0, len(b64), 76)) + ".\nok\n")
        elif cmd == "rm":
            if arg in self.files: del self.files[arg]; self.emit("ok\n"); self._reload()
            else: self.emit("err: no such file\n")
        elif cmd == "health": self.emit(json.dumps({"free": 180000, "after_import": 180000, "import_s": 0, "with_fox": 150000, "foxlib": "c-0.1.14", "fatal": None}) + "\nok\n")
        elif cmd == "scan": self.emit("-38 ch6 neighbour-1\n-71 ch11 neighbour-2\nok\n")
        elif cmd == "status": self.emit(self.banner().split("\n")[0] + "\nuptime=12s reset=power_on version=0.1.14\nrevision=3 si5351=ok carrier=146565000.0 keyed=0 attenuation=20 i2c_write_us=0 i2c_errors=0 core1=ok correction_ppm=0.0 state=1\nok\n")
        elif cmd == "batt": self.emit("batt=4.02 V charging=no\nok\n")
        elif cmd == "key":
            try: sec = float(arg or "2")
            except ValueError: sec = 2
            if self.picofox: self.emit("keyed %.1f s\n" % sec); threading.Timer(min(sec, 2), lambda: self.emit("ok\n")).start()
            else:
                try: cfg = json.loads(self.files.get("fox.json") or b"{}")
                except ValueError: cfg = {}
                net = cfg.get("net") or {}; mac = (net.get("mac") or "F2:B0:00:00:00:01").upper()
                if net.get("kind") == "ble": mac = "%02X%s" % (int(mac[:2], 16) | 0xC0, mac[2:])   # a static random address: the two top bits set
                threading.Timer(min(sec, 2), lambda: self.emit("ok %s %s (%s) for %.1f s\nok\n" % (net.get("kind", "wifi-ap"), (cfg.get("id") or {}).get("callmessage", ""), mac, sec))).start()
        elif cmd in ("stop", "reload", "help"): self.emit("ok\n"); (self._reload() if cmd == "reload" else None)
        else: self.emit("err: unknown command %s\n" % cmd)
    def _reload(self):
        """The firmware reloads about a second after the last put of a config file (a put of defaults.json followed
        by fox.json is one reload, one banner): a pending reload is pushed back by the next."""
        self._schedule(lambda: self.emit("reload: console\n" + self.banner()))
    def _schedule(self, fn):
        t = getattr(self, "_reload_timer", None)
        if t: t.cancel()
        self._reload_timer = threading.Timer(0.3, fn); self._reload_timer.start()
    # ---- the replay
    def _after_reload(self):
        def go():
            e = self.replay._take("banner")
            if e: self.emit(e["out"]); self._listen_tail()
        self._schedule(go)
    def _listen_tail(self):
        e = self.replay._take("listen")
        if e and e["out"]: self.emit(e["out"])
    def line(self, text):
        import base64
        if self.put is not None:
            name, size, body = self.put
            if text != ".": body.append(text); return
            try: data = base64.b64decode("".join(body))
            except Exception: data = b""
            self.put = None
            if self.replay:
                self.replay.recorded_writes = getattr(self.replay, "recorded_writes", 0) + 1
                if not self.replay._take("put", path=name): self.replay.misses.append("put " + name)
            else:
                self.files[name] = data
            self.emit("ok size=%d crc32=%08x\n" % (len(data), zlib.crc32(data) & 0xffffffff))
            if name in self.CFG_FILES: (self._after_reload() if self.replay else self._reload())
            return
        m = re.match(r"^put (\S+) (\d+)$", text)
        if m:
            self.put = (m.group(1), int(m.group(2)), []); self.emit("send\n"); return
        if not self.replay: return self.live(text)
        e = self.replay._take("con", cmd=text)
        if not e:
            self.replay.misses.append(text); self.emit("err: not in the recording: %s\n" % text); return
        self.emit(e["out"] + "\n")
        if text.startswith("rm ") and text[3:] in self.CFG_FILES and e["out"].startswith("ok"): self._after_reload()
    def serve(self):
        while True:
            try: data = os.read(self.master, 1024)
            except OSError: return
            if not data: return
            self.buf += data
            while b"\n" in self.buf:
                raw, self.buf = self.buf.split(b"\n", 1)
                self.line(raw.rstrip(b"\r").decode(errors="replace"))


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
        if self.rec.get("format") not in ("fox-bench-bench-recording/1", "fox-bench-bench-recording/2"):
            raise SystemExit("%s: not a fox-bench bench recording" % path)
        # format 2 (page 0.18.16): a file write is one {"kind": "write", "path", "size", "crc"} line, not its bytes; the
        # open/write/close/verify exchanges are answered from the bytes the tool writes at replay time (below).
        # Format 1 recordings, which carry the chunks, still replay: their chunks match or count as content
        self.ex = self.rec["exchanges"]
        self.used = [e.get("kind") == "host" for e in self.ex]   # "host" lines are the computer's Wi-Fi side; hw_smoke --host-from replays them, not the board
        self.cursor = 0
        self.misses = []
    def _take(self, kind, cmd=None, path=None):
        match = lambda e: e["kind"] == kind and (cmd is None or e.get("cmd") == cmd) and (path is None or e.get("path") == path)
        dbg = os.environ.get("REPLAY_DEBUG")
        for i in range(self.cursor, len(self.ex)):
            e = self.ex[i]
            # a command issued before a reboot cannot be the recording's exchange after the next recorded reboot: the
            # forward search stops there (a file written with CRLF on a Windows checkout and restored with LF at the
            # end of the run matched the restore's write and skipped three templates' boots, 2026-11-18)
            if kind != "reboot" and e["kind"] == "reboot" and not self.used[i]:
                break
            if not self.used[i] and match(e):
                if dbg: sys.stderr.write("take %d %s %s\n" % (i, kind, (cmd or "")[:50].replace("\n", "|")))
                self.used[i] = True; self.cursor = i + 1; return e
        for i, e in enumerate(self.ex):
            if not self.used[i] and match(e):
                if dbg: sys.stderr.write("take-back %d %s %s (cursor %d)\n" % (i, kind, (cmd or "")[:50].replace("\n", "|"), self.cursor))
                self.used[i] = True; return e
        if dbg: sys.stderr.write("miss %s %s\n" % (kind, (cmd or "")[:50].replace("\n", "|")))
        return None
    # The bytes of the files hw_smoke writes (foxlib, code.py, defaults, fox.json) change with every firmware or
    # catalog release, and so do the size/crc replies that verify them. A recording is about the script's commands
    # and the board's replies, not those bytes: the replay keeps a tiny file store, answers an unrecorded
    # f.write(...) with the silence every real one gave, and answers the verify command from what was written.
    _open_re = re.compile(r"^f=open\((?P<p>'[^']*'|\"[^\"]*\"),'wb'\)$")
    _verify_re = re.compile(r"print\(os\.stat\((?P<p>'[^']*'|\"[^\"]*\")\)\[6\], c\)")

    def exec(self, code):
        text = code.decode()
        m = self._open_re.match(text.strip())
        if m:
            self._writing = ast.literal_eval(m.group("p")); self._buf = bytearray()
        elif text.startswith("f.write(") and getattr(self, "_writing", None) is not None:
            try: self._buf += ast.literal_eval(text[len("f.write("):].rstrip().rstrip(")"))
            except Exception: pass
        elif text.strip() == "f.close()" and getattr(self, "_writing", None) is not None:
            self.files = getattr(self, "files", {}); self.files[self._writing] = bytes(self._buf); self._writing = None
        v = self._verify_re.search(text)
        if v and ast.literal_eval(v.group("p")) in getattr(self, "files", {}):
            # the verify of a file this replay wrote: answered from the bytes written, whatever the recording said
            data = self.files[ast.literal_eval(v.group("p"))]
            self._take("exec", text)                 # the recorded one, if the command text matches; never a later one
            self.content_writes = getattr(self, "content_writes", 0) + 1
            return ("%d %d\n" % (len(data), zlib.crc32(data))).encode(), b""
        if m:
            e = self._take("exec", text)
            if e is None:                                    # format 2: the file's one recorded line, by path
                w = self._take("write", path=ast.literal_eval(m.group("p")))
                if w is not None:
                    self.recorded_writes = getattr(self, "recorded_writes", 0) + 1
                    self._unrecorded_file = True             # its chunks and close are answered from the store, not the recording
                    return b"", b""
            self._unrecorded_file = e is None               # a file the recording never saw: its writes and close are content too
            if e is None:
                self.content_writes = getattr(self, "content_writes", 0) + 1
                return b"", b""
            return e["out"].encode(), e["err"].encode()
        if getattr(self, "_unrecorded_file", False) and (text.startswith("f.write(") or text.strip() == "f.close()"):
            if text.strip() == "f.close()": self._unrecorded_file = False
            self.content_writes = getattr(self, "content_writes", 0) + 1
            return b"", b""
        e = self._take("exec", text)
        if e is None and (text.startswith("f.write(") or text.strip() == "f.close()"):
            # a write, or the open/close of a file the recording never saw (a foxlib module added since): content, not a
            # miss. Nothing recorded is consumed for it -- taking "the nearest write" would move the cursor past a later
            # template's reboot when the chunking differs -- so the use count can fall short of the total; that is fine
            self.content_writes = getattr(self, "content_writes", 0) + 1
            return b"", b""
        if e is None and re.match(r"import os\nos\.remove\('foxlib/[\w.]+'\)\s*$", text):
            # hw_smoke removing a foxlib file the template does not use (page 0.18.12: files per template). A recording
            # made when every file was written has no such exchange; the board would have answered nothing
            return b"", b""
        if e is None and text.startswith("try:\n import storage\n ro = storage.getmount('/').readonly"):
            # hw_smoke's "can the board write its files?" (page 0.18.4). A recording made before that asked nothing and
            # wrote: the board it was made on would have answered 'rw', so a replay of it does
            return b"rw\n", b""
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
    ap.add_argument("--console", metavar="TARGET", help="a foxlib-c console instead of a CircuitPython REPL: a small fake fox for TARGET (esp32c3-foxlibc, picofox-foxlibc, …) that answers the console protocol, for tools/hw_smoke.py --board TARGET")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    flash = a.flash or tempfile.mkdtemp(prefix="pty-flash-")
    import json as _json
    rec = _json.load(open(a.replay)) if a.replay else {}
    if rec.get("transport") == "console": b = ConsoleBoard(Replay(a.replay), a.quiet, rec.get("board_id", "esp32c3-foxlibc"))
    elif a.console: b = ConsoleBoard(None, a.quiet, a.console)
    else: b = Board(flash, a.running, a.quiet, a.replay)
    print(b.port, flush=True)
    def write_replay_report(*_):
        if b.replay and a.replay_report:
            import json
            r = b.replay
            json.dump({"misses": r.misses, "used": sum(r.used), "total": len(r.ex), "content_writes": getattr(r, "content_writes", 0),
                       "recorded_writes": getattr(r, "recorded_writes", 0), "unused": [i for i, u in enumerate(r.used) if not u]}, open(a.replay_report, "w"), indent=1)
    import signal
    signal.signal(signal.SIGTERM, lambda *_: (write_replay_report(), sys.exit(0)))
    try: b.serve()
    finally: write_replay_report()


if __name__ == "__main__":
    main()
