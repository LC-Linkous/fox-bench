#!/usr/bin/env python3
"""hw_smoke.py — the regression test the simulator cannot give you: a real board.

    pip install pyserial
    python3 tools/hw_smoke.py --port /dev/ttyACM0 --call "W1ABC FOX DE W1ABC" --yes-antenna
    python3 tools/hw_smoke.py --templates morse-songs,popcorn --key-seconds 0     # no keying

For each template it deploys the same set the page would (foxlib once,
then code.py + defaults.json + fox.json built from the template defaults
with your callsign and frequency), soft-reboots, reads the FOX banner,
watches the fox run for a few seconds, then stops it and runs the bench
actions (import time and free memory, probe, RSSI, battery, a short key
test). It writes a JSON report and prints a table. Run it on a new board,
a new CircuitPython build, or before changing foxlib, and diff the reports.

What is on the board before (code.py, fox.json, defaults.json) is read
first and put back at the end unless --no-restore. foxlib stays updated.

It transmits (briefly) unless --key-seconds 0, and every template keys
the module within seconds of its reboot: connect an antenna or a dummy
load, and pass --yes-antenna to say you did.

SPDX-License-Identifier: GPL-2.0-only
"""
import argparse, json, os, re, sys, time, zlib
from datetime import datetime

try:
    import serial, serial.tools.list_ports
except ImportError:
    sys.exit("pip install pyserial")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANSI = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]")


# ---------------------------------------------------------------- raw REPL (mirrors js/device/repl-link.js, PROTOCOL.md)
class Repl:
    def __init__(self, port, verbose=False):
        self.s = serial.Serial(port, 115200, timeout=0.05)
        self.verbose = verbose
        self.in_raw = False
        self.buf = b""

    def _read_until(self, marker, timeout):
        """Returns the bytes before `marker`; what follows stays in self.buf for the next call."""
        t0 = time.monotonic()
        while True:
            i = self.buf.find(marker)
            if i >= 0:
                before, self.buf = self.buf[:i], self.buf[i + len(marker):]
                return before
            if time.monotonic() - t0 > timeout:
                raise TimeoutError("timeout waiting for %r; got %r" % (marker, self.buf[-120:]))
            self.buf += self.s.read(256)

    def _flush(self):
        self.buf = b""; self.s.reset_input_buffer()

    def interrupt(self):
        self._flush()
        for attempt in range(4):
            for seq in (b"\r\x03\x03", b"\r", b"\r\x02"):
                self.s.write(seq)
                try:
                    self._read_until(b">>> ", 2.5); self.in_raw = False; return
                except TimeoutError:
                    pass
            time.sleep(0.5)
        raise RuntimeError("no REPL prompt — is this a CircuitPython board? (replug without holding B)")

    def enter_raw(self):
        if self.in_raw: return
        self._flush(); self.s.write(b"\r\x01")
        self._read_until(b"raw REPL; CTRL-B to exit\r\n>", 3); self.in_raw = True

    def exit_raw(self):
        if not self.in_raw: return
        self.s.write(b"\r\x02")
        try: self._read_until(b">>> ", 2)
        except TimeoutError: pass
        self.in_raw = False

    def exec(self, code, timeout=10, soft=False):
        self.enter_raw()
        self._flush()
        data = code.encode()
        for i in range(0, len(data), 128):
            self.s.write(data[i:i + 128]); time.sleep(0.008)
        self.s.write(b"\x04")
        self._read_until(b"OK", 3)
        out = self._read_until(b"\x04", timeout)
        err = self._read_until(b"\x04", 3)
        try: self._read_until(b">", 2)
        except TimeoutError: pass
        out, err = out.decode(errors="replace"), err.decode(errors="replace")
        if self.verbose: print("    >", code.splitlines()[0][:70], "->", (out.strip() or err.strip())[:70])
        if err and not soft: raise RuntimeError(err.strip().splitlines()[-1] if err.strip() else err)
        return out

    def reboot_and_capture(self, until=rb"^FOX ", timeout=20):
        self.exit_raw(); self._flush(); self.s.write(b"\x04")
        buf = b""; t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            buf += self.s.read(1024)
            if re.search(until, buf, re.M):
                time.sleep(0.3); buf += self.s.read(4096); break
            if re.search(rb"Traceback|Error:", buf) and re.search(rb"Press any key|Code done running", buf): break
        return ANSI.sub(b"", buf).replace(b"\r", b"").decode(errors="replace")

    def listen(self, seconds):
        buf = self.buf; self.buf = b""; t0 = time.monotonic()
        while time.monotonic() - t0 < seconds:
            buf += self.s.read(1024)
        return ANSI.sub(b"", buf).replace(b"\r", b"").decode(errors="replace")

    # ---- files
    def read_file(self, path):
        out = self.exec("try:\n f=open(%r,'rb')\nexcept OSError:\n print('__MISSING__')\nelse:\n while True:\n  b=f.read(512)\n  if not b: break\n  print(''.join('%%02x'%%c for c in b), end='')\n f.close()\n" % path, timeout=30)
        return None if out.startswith("__MISSING__") else bytes.fromhex(out.strip())

    def write_file(self, path, data):
        if isinstance(data, str): data = data.encode()
        self.exec("f=open(%r,'wb')" % path)
        for i in range(0, len(data), 384):
            self.exec("f.write(%r)" % data[i:i + 384])
        self.exec("f.close()")
        out = self.exec("import os, binascii\nc=0\nf=open(%r,'rb')\nwhile True:\n b=f.read(512)\n if not b: break\n c=binascii.crc32(b,c)\nf.close()\nprint(os.stat(%r)[6], c)\n" % (path, path))
        size, crc = (int(x) for x in out.split())
        if size != len(data) or crc != zlib.crc32(data):
            raise RuntimeError("%s: verify failed (size %d/%d crc %x/%x)" % (path, size, len(data), crc, zlib.crc32(data)))

    def mkdir(self, path):
        self.exec("import os\ntry:\n os.mkdir(%r)\nexcept OSError:\n pass\n" % path)

    def listdir(self, path=""):
        out = self.exec("import os\nfor n in os.listdir(%r):\n try:\n  s=os.stat(%r+n); print(n, s[6], 'd' if s[0] & 0x4000 else 'f')\n except Exception:\n  print(n, -1, '?')\n" % (path or "/", path + "/" if path else ""))
        return {l.split()[0]: int(l.split()[1]) for l in out.strip().splitlines() if l.strip()}


def parse_banner(text):
    m = re.search(r"^FOX (.*)$", text, re.M)
    if not m: return None
    d = {"_raw": m.group(0)}
    for kv in re.findall(r"\S+=(?:\([^)]*\)|\S)*", m.group(1)):
        k, _, v = kv.partition("="); d[k] = v
    return d


def pick_port(explicit):
    if explicit: return explicit
    ports = [p.device for p in serial.tools.list_ports.comports() if "Bluetooth" not in (p.description or "")]
    if len(ports) == 1: return ports[0]
    sys.exit("pass --port; candidates: %s" % ", ".join(ports) or "none")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--port")
    ap.add_argument("--board", default="seeed_xiao_esp32c3")
    ap.add_argument("--templates", default="all", help="comma list or all")
    ap.add_argument("--call", default="N0CALL DECOY DECOY N0CALL", help="callmessage; with the placeholder the fox stays silent (id=unset)")
    ap.add_argument("--freq", type=float, help="frequency in MHz (default: the template default)")
    ap.add_argument("--module", help="radio module id from modules/ (e.g. sa868_dual); sets radio.family and ranges_mhz so --freq on the other band is allowed")
    ap.add_argument("--observe", type=float, default=8, help="seconds to watch each template run after its banner")
    ap.add_argument("--key-seconds", type=float, default=1, help="bench key test length; 0 skips keying")
    ap.add_argument("--yes-antenna", action="store_true", help="confirm an antenna or dummy load is connected")
    ap.add_argument("--no-restore", action="store_true", help="leave the last template on the board instead of restoring what was there")
    ap.add_argument("--report", help="JSON report path (default: hw_smoke-<uid>-<time>.json in the current directory)")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    if not a.yes_antenna:
        sys.exit("Every template keys the transmitter within seconds of booting. Connect an antenna or dummy load, then pass --yes-antenna.")

    idx = json.load(open(os.path.join(ROOT, "firmware/index.json")))
    templates = idx["templates"] if a.templates == "all" else a.templates.split(",")
    foxlib_version = open(os.path.join(ROOT, "firmware/foxlib/VERSION")).read().strip()

    r = Repl(pick_port(a.port), a.verbose)
    print("interrupting whatever runs …")
    r.interrupt()
    ident = r.exec("import board, microcontroller, os, sys\nprint(board.board_id)\nprint(''.join('%02x' % b for b in microcontroller.cpu.uid))\nprint(os.uname().release)\nprint(os.uname().version)\n").strip().splitlines()
    board_id, uid, cp_release, cp_version = (ident + ["", "", "", ""])[:4]
    print("board %s  uid %s  CircuitPython %s" % (board_id, uid, cp_release))
    if board_id != a.board:
        print("WARNING: board reports %s, deploying defaults for %s" % (board_id, a.board))
    report = {"generated": datetime.now().isoformat(timespec="seconds"), "board_id": board_id, "uid": uid, "circuitpython": cp_release, "cp_version": cp_version,
              "foxlib": foxlib_version, "call": a.call, "freq": a.freq, "module": a.module, "templates": {}}

    # what was there
    before = {p: r.read_file(p) for p in ("code.py", "fox.json", "defaults.json")}
    print("saved current code.py/fox.json/defaults.json (%s)" % ", ".join(k for k, v in before.items() if v is not None))

    # foxlib once, verified
    print("writing foxlib %s …" % foxlib_version, end="", flush=True)
    r.mkdir("foxlib")
    for name in idx["foxlib"]:
        r.write_file("foxlib/" + name, open(os.path.join(ROOT, "firmware/foxlib", name), "rb").read())
        print(".", end="", flush=True)
    stale = [n for n in r.listdir("foxlib") if n not in idx["foxlib"]]
    for n in stale:
        r.exec("import os\nos.remove('foxlib/%s')" % n)
    print(" ok" + (" (removed stale: %s)" % ", ".join(stale) if stale else ""))

    for tid in templates:
        print("\n== %s" % tid)
        res = report["templates"][tid] = {}
        try:
            tdir = os.path.join(ROOT, "firmware/templates", tid)
            manifest = json.load(open(os.path.join(tdir, "template.json")))
            dpath = os.path.join(tdir, "defaults", a.board + ".json")
            if not os.path.exists(dpath):
                res["ok"] = None; print("  no defaults for %s: not offered on this board, skipped" % a.board); continue
            defaults = json.load(open(dpath))
            net = manifest.get("contract") == "net"          # a network fox: no module, no plan, no payload
            fox = json.loads(json.dumps(defaults))
            fox["id"]["callmessage"] = a.call
            if net:
                fox["id"]["use_callsign_as_name"] = True        # what a hunter's phone shows is the callsign
            if a.module and not net:
                mod = json.load(open(os.path.join(ROOT, "modules", a.module + ".json")))
                fox["module"] = mod["id"]
                fox["radio"]["family"] = mod["family"]
                fox["radio"]["ranges_mhz"] = mod["ranges_mhz"]
            if a.freq and not net: fox["plan"]["frequencies_mhz"] = [a.freq]
            fox.setdefault("fleet", {})["notes"] = "hw_smoke"
            res["template_version"] = manifest["version"]
            r.interrupt()
            r.write_file("code.py", open(os.path.join(tdir, "code.py"), "rb").read())
            r.write_file("defaults.json", json.dumps(defaults))
            r.write_file("fox.json", json.dumps(fox, indent=1))
            if not net and fox["payload"]["kind"] == "sstv":
                r.write_file(fox["payload"]["images_file"], b"")      # firmware falls back to its built-in test card
            t0 = time.monotonic()
            boot = r.reboot_and_capture()
            res["boot_s"] = round(time.monotonic() - t0, 2)
            b = parse_banner(boot)
            res["banner"] = b["_raw"] if b else None
            res["boot_log"] = boot[-2000:]
            if not b:
                res["ok"] = False; print("  no FOX banner within 20 s:\n" + "\n".join("    " + l for l in boot.strip().splitlines()[-8:])); continue
            print("  %s (%.1f s to banner)" % (b["_raw"], res["boot_s"]))
            run = r.listen(a.observe)
            res["observed"] = run.strip()[-1500:]
            if run.strip(): print("  while running: " + " | ".join(run.strip().splitlines()[-3:])[:200])
            res["ok"] = b.get("cfg") == "ok" and b.get("radio") == "ok" and (b.get("id") == "set" or a.call.startswith("N0CALL"))
            if b.get("cfg") != "ok": print("  cfg=%s — the firmware disagreed with the defaults or fox.json" % b.get("cfg"))
            if b.get("radio") == "skipped": print("  radio=skipped — not attempted because the config was fatal; nothing was transmitted")
            elif b.get("radio") != "ok": print("  radio=%s — module not answering (wiring, PD pin, baud)" % b.get("radio"))

            # bench, on a fresh VM
            r.interrupt()
            m = r.exec("import gc, time\ngc.collect()\na=gc.mem_free()\nt=time.monotonic()\nimport foxlib\nprint(a, gc.mem_free(), time.monotonic()-t)\n", timeout=60).split()
            res["mem_free_before"], res["mem_free_after_import"], res["import_s"] = int(m[0]), int(m[1]), round(float(m[2]), 2)
            if net:
                pre = "import gc\ntry:\n fox.deinit()\nexcept Exception:\n pass\nfrom foxlib.netfox import NetFox\nfox = NetFox('fox.json', defaults='defaults.json', quiet=True)\nif fox.fatal: raise RuntimeError('fox not usable: ' + fox.fatal)\ngc.collect()\n"
                out = r.exec(pre + "print(gc.mem_free())\nprint(fox.radio.status)\nprint(fox.rssi())\nprint(fox.radio.mac())\n", timeout=60).strip().splitlines()
                res["mem_free_with_fox"], res["probe"], res["rssi"], res["batt_v"] = int(out[0]), out[1], out[2], None
                print("  import %.1fs · free %d → %d → %d B · radio %s · scan %s · mac %s" % (res["import_s"], res["mem_free_before"], res["mem_free_after_import"], res["mem_free_with_fox"], out[1], out[2][:120], out[3]))
                if a.key_seconds > 0:
                    res["key"] = r.exec(pre + "print(fox.key_for(%s))\n" % a.key_seconds, timeout=60 + a.key_seconds).strip()
                    print("  radio up %ss: %s" % (a.key_seconds, res["key"]))
            else:
                pre = "import foxlib, gc\ntry:\n fox.deinit()\nexcept Exception:\n pass\nfox = foxlib.Fox('fox.json', defaults='defaults.json', quiet=True)\nif fox.fatal: raise RuntimeError('fox not usable: ' + fox.fatal)\ngc.collect()\n"
                out = r.exec(pre + "print(gc.mem_free())\nprint(fox.radio.probe((146.5, 433.5)))\nprint(fox.radio.rssi())\nprint(fox.batt.read() if fox.batt else None)\n", timeout=60).strip().splitlines()
                res["mem_free_with_fox"], res["probe"], res["rssi"], res["batt_v"] = int(out[0]), out[1], out[2], out[3]
                print("  import %.1fs · free %d → %d → %d B · probe %s · rssi %s · batt %s" % (res["import_s"], res["mem_free_before"], res["mem_free_after_import"], res["mem_free_with_fox"], out[1], out[2], out[3]))
                if a.key_seconds > 0 and "keytest" in manifest.get("capabilities", []):
                    res["key"] = r.exec(pre + "print(fox.radio.key_for(%s))\n" % a.key_seconds, timeout=60 + a.key_seconds).strip()
                    print("  key test %ss: %s" % (a.key_seconds, res["key"]))
        except Exception as e:
            res["ok"] = False; res["error"] = str(e); print("  ERROR:", e)

    # restore
    if not a.no_restore:
        r.interrupt()
        for p, data in before.items():
            if data is not None: r.write_file(p, data)
            else: r.exec("import os\ntry:\n os.remove(%r)\nexcept OSError:\n pass\n" % p)
        boot = r.reboot_and_capture(timeout=10)
        b = parse_banner(boot)
        print("\nrestored what was on the board before%s" % (": " + b["_raw"] if b else ""))
    else:
        r.reboot_and_capture(timeout=10)
        print("\nleft %s running" % templates[-1])

    path = a.report or "hw_smoke-%s-%s.json" % (uid[-6:], datetime.now().strftime("%Y%m%d-%H%M%S"))
    json.dump(report, open(path, "w"), indent=1)
    print("\n%-14s %-5s %6s %7s %8s %6s %-8s" % ("template", "ok", "boot s", "import", "free B", "rssi", "key"))
    for tid, res in report["templates"].items():
        print("%-14s %-5s %6s %7s %8s %6s %-8s" % (tid, "skip" if res.get("ok") is None else "ok" if res.get("ok") else "FAIL", res.get("boot_s", ""), res.get("import_s", ""), res.get("mem_free_with_fox", ""), str(res.get("rssi", ""))[:6], res.get("key", res.get("error", "")[:30] if not res.get("ok") else "")))
    print("report: %s" % path)
    failed = [t for t, x in report["templates"].items() if x.get("ok") is False]
    if not failed:
        print("every template booted clean on %s — add %r to boards_tested in those template.json files if it is not there" % (board_id, board_id))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
