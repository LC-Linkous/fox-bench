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

--sniffer PORT is a second board running tools/sniffer/code.py. For
wifi-probe (the one template a phone cannot verify) the script reads the
sniffer while the fox runs and counts probe requests from the fox's MAC
carrying its SSID; the template passes only if it saw at least one.

--record FILE writes every REPL exchange of the run (each command and the
board's reply, each soft reboot and its boot text, each listen window) to
a JSON file. firmware/sim/pty_board.py --replay FILE then answers from it,
so the same run can be repeated in CI without the board: a bench finding
becomes a regression test. See docs/bench-runbook.md.

--payload and --checkpoint make this computer the hunter's phone, through
NetworkManager (nmcli, Linux) or netsh wlan (Windows). --payload scans while each Wi-Fi fox runs
and requires its name on the air (BSSID, signal and channel go into the
report; BLE is left to nRF Connect). --checkpoint joins a checkpoint fox's
network, asks its captive DNS, GETs the sign-in page, hands in --find-call,
leaves, and once the fox is stopped reads finds.csv back and requires the
row (a finds.csv that was not there before is removed again). The computer
has no internet while it is on the fox. On a machine with neither (macOS),
join the network by hand and run --portal-only.

It transmits (briefly) unless --key-seconds 0, and every template keys
the module within seconds of its reboot: connect an antenna or a dummy
load, and pass --yes-antenna to say you did.

SPDX-License-Identifier: GPL-2.0-only
"""
import argparse, glob, json, os, re, sys, time, zlib
from datetime import datetime

try:
    import serial, serial.tools.list_ports
except ImportError:
    sys.exit("pip install pyserial")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECORD_CALL = "W1ABC FOX DE W1ABC"     # what a recording carries instead of the run's callsign (tests/fixtures are public)
_SCAN_ITEM = re.compile(r"^(-\d+) (\S.*)$")   # one radio.scan() entry: "-38 name" / "-42 AA:BB:CC:DD:EE:FF"; a line is " | "-joined


def scrub_recording(exchanges, args, call):
    """A recording is committed to a public repo: the run's callsign becomes RECORD_CALL everywhere (commands, replies,
    args), and every scan line -- the networks and BLE addresses around the bench -- keeps its signal levels but names
    its neighbours neighbour-1, neighbour-2 ... (a line is a scan line when every " | " item is "-<dBm> <name>").
    Returns a short note of what was done."""
    n_call = n_scan = 0
    if call and "N0CALL" in call:
        call = None      # the placeholder is nobody's callsign; replacing it would make the replay expect id=set from a run that recorded id=unset

    def scrub_line(line):
        nonlocal n_scan
        items = line.strip().split(" | ")
        ms = [_SCAN_ITEM.match(i) for i in items]
        if not items or not all(ms):
            return line
        n_scan += len(items)
        return " | ".join("%s neighbour-%d" % (m.group(1), k + 1) for k, m in enumerate(ms))

    def scrub_text(t):
        nonlocal n_call
        if call and call != RECORD_CALL and call in t:
            n_call += t.count(call)
            t = t.replace(call, RECORD_CALL)
        return "\n".join(scrub_line(l) for l in t.split("\n"))

    for e in exchanges:
        for k in ("cmd", "out", "err"):
            if isinstance(e.get(k), str):
                e[k] = scrub_text(e[k])
    if call and args.get("call") and args["call"] != RECORD_CALL:
        args["call"] = RECORD_CALL
    return "%d callsign mention(s) replaced, %d scan neighbour(s) renamed" % (n_call, n_scan)


TRACE_MARK = "# fox-bench: trace the boot"        # the settings.toml the page's Deploy writes too (js/ui/deploy.js)
TRACE_TOML = TRACE_MARK + " (foxlib/netfox.py prints every init step before the banner). Remove this file, or untick \"Trace the boot\" on Deploy, to stop it.\nFOX_TRACE = 1\n"

ANSI = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]")


# ---------------------------------------------------------------- raw REPL (mirrors js/device/repl-link.js, PROTOCOL.md)
class Repl:
    def __init__(self, port, verbose=False, record=None):
        self.s = serial.Serial(port, 115200, timeout=0.05)
        self.verbose = verbose
        self.in_raw = False
        self.buf = b""
        self.record = record   # list the exchanges are appended to, or None
        self.t0 = time.monotonic()

    def _rec(self, kind, **kw):
        if self.record is not None and not getattr(self, "_rec_paused", False):
            self.record.append({"t": round(time.monotonic() - self.t0, 3), "kind": kind, **kw})

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
        self._rec("exec", cmd=code, out=out.replace("\r\n", "\n"), err=err.replace("\r\n", "\n"))   # bare newlines in the file; the replayer puts \r\n back
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
        text = ANSI.sub(b"", buf).replace(b"\r", b"").decode(errors="replace")
        self._rec("reboot", out=text)
        return text

    def listen(self, seconds):
        buf = self.buf; self.buf = b""; t0 = time.monotonic()
        while time.monotonic() - t0 < seconds:
            buf += self.s.read(1024)
        text = ANSI.sub(b"", buf).replace(b"\r", b"").decode(errors="replace")
        self._rec("listen", seconds=seconds, out=text)
        return text

    # ---- files
    def read_file(self, path):
        out = self.exec("try:\n f=open(%r,'rb')\nexcept OSError:\n print('__MISSING__')\nelse:\n while True:\n  b=f.read(512)\n  if not b: break\n  print(''.join('%%02x'%%c for c in b), end='')\n f.close()\n" % path, timeout=30)
        return None if out.startswith("__MISSING__") else bytes.fromhex(out.strip())

    def write_file(self, path, data):
        if isinstance(data, str): data = data.encode()
        # a Windows checkout (core.autocrlf) hands over CRLF source: the board gets LF, as the page deploys it, so a
        # recording made there replays against a Linux checkout (and the files on the board are the same bytes either way)
        if path.endswith((".py", ".json", ".txt")) and b"\r\n" in data: data = data.replace(b"\r\n", b"\n")
        # a recording keeps one line per file (recording format 2: path, size, crc), not the chunks of its bytes: those
        # change with every foxlib release and made a recording 70% dead weight; the replay answers them from what the
        # tool writes at replay time (firmware/sim/pty_board.py, Replay)
        self._rec_paused = True
        try:
            self.exec("f=open(%r,'wb')" % path)
            for i in range(0, len(data), 384):
                self.exec("f.write(%r)" % data[i:i + 384])
            self.exec("f.close()")
            out = self.exec("import os, binascii\nc=0\nf=open(%r,'rb')\nwhile True:\n b=f.read(512)\n if not b: break\n c=binascii.crc32(b,c)\nf.close()\nprint(os.stat(%r)[6], c)\n" % (path, path))
        finally:
            self._rec_paused = False
        size, crc = (int(x) for x in out.split())
        if size != len(data) or crc != zlib.crc32(data):
            raise RuntimeError("%s: verify failed (size %d/%d crc %x/%x)" % (path, size, len(data), crc, zlib.crc32(data)))
        self._rec("write", path=path, size=size, crc="%08x" % crc)

    def mkdir(self, path):
        self.exec("import os\ntry:\n os.mkdir(%r)\nexcept OSError:\n pass\n" % path)

    def listdir(self, path=""):
        out = self.exec("import os\nfor n in os.listdir(%r):\n try:\n  s=os.stat(%r+n); print(n, s[6], 'd' if s[0] & 0x4000 else 'f')\n except Exception:\n  print(n, -1, '?')\n" % (path or "/", path + "/" if path else ""))
        return {l.split()[0]: int(l.split()[1]) for l in out.strip().splitlines() if l.strip()}


class Sniffer:
    """Reads tools/sniffer/code.py's line-JSON from a port and counts probe requests."""
    def __init__(self, port):
        self.s = serial.Serial(port, 115200, timeout=0.05)
        self.buf = b""
        self.hello = None
        t0 = time.monotonic()
        while time.monotonic() - t0 < 3 and not self.hello:
            for o in self._lines():
                if o.get("t") == "hello": self.hello = o
        self.s.reset_input_buffer(); self.buf = b""

    def _lines(self):
        self.buf += self.s.read(4096)
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            try: yield json.loads(line.strip().decode(errors="replace"))
            except ValueError: pass

    def watch(self, seconds, mac, ssid):
        """Listen for `seconds`; returns {"from_fox": n, "with_ssid": n, "others": n, "sample": [...]}"""
        mac = mac.lower(); r = {"from_fox": 0, "with_ssid": 0, "others": 0, "sample": []}
        t0 = time.monotonic()
        while time.monotonic() - t0 < seconds:
            for o in self._lines():
                if o.get("t") != "probe": continue
                if o.get("mac", "").lower() == mac:
                    r["from_fox"] += 1
                    if o.get("ssid") == ssid: r["with_ssid"] += 1
                    if len(r["sample"]) < 3: r["sample"].append({k: o.get(k) for k in ("ssid", "rssi", "ch")})
                else:
                    r["others"] += 1
        return r


# ---------------------------------------------------------------- the computer as a hunter's phone (--payload, --checkpoint)
PORTAL_IP = "192.168.4.1"          # what CircuitPython's access point hands out; the DHCP gateway is used when the host reports one
SMOKE_CON = "fox-bench-smoke"      # the NetworkManager connection profile the join makes and removes again


class HostWifi:
    """The computer's Wi-Fi as a hunter's phone: scan for the fox, join its open network, leave. Two backends, picked by
    the platform: NetworkManager's nmcli (Linux) and netsh wlan (Windows); macOS has neither, so there the network is
    joined by hand and --portal-only runs the checks. Nothing here touches the board: the REPL on the serial port keeps
    running while the laptop is on the fox's AP (and off the internet: an open network without a gateway takes the
    default route for as long as it lasts)."""

    def __init__(self, iface=None, record=None):
        import shutil, platform
        if platform.system() == "Windows" and shutil.which("netsh"):
            self.be = _Netsh(iface)
        elif shutil.which("nmcli"):
            self.be = _Nmcli(iface)
        else:
            raise SystemExit("--payload/--checkpoint drive the computer's Wi-Fi with NetworkManager's nmcli (Linux) or netsh wlan (Windows); neither is here. Join the fox's network by hand and run the portal check alone: python3 tools/hw_smoke.py --portal-only")
        self.iface = self.be.iface
        self.joined = False
        self.record = record     # the run's recording: every host-side result goes in as a {"kind": "host", "op", "result"} line

    def _rec(self, op, result):
        if self.record is not None:
            self.record.append({"kind": "host", "op": op, "result": result})
        return result

    def dns(self, server):
        return self._rec("dns", dns_query("captive.apple.com", server))

    def portal(self, host, code, call):
        try:
            return self._rec("portal", portal_visit(host, code, call))
        except OSError as e:
            self._rec("portal", {"error": str(e)[-160:]}); raise

    def scan(self, seconds, ssid=None, bssid=None):
        """Rescans until `ssid` (or `bssid`) is seen or `seconds` pass. Returns {"seen": bool, "bssid", "signal", "chan",
        "networks": n, "scans": n}: the fox's entry when it was seen, and how many networks were around it."""
        t0 = time.monotonic(); r = {"seen": False, "bssid": None, "signal": None, "chan": None, "networks": 0, "scans": 0}
        while True:
            rows = self.be.scan_rows()                      # [(ssid, BSSID upper, signal, channel)]
            r["scans"] += 1
            r["networks"] = max(r["networks"], len(rows))
            for s, b, sig, ch in rows:
                if (ssid and s == ssid) or (bssid and b == bssid.upper()):
                    r.update(seen=True, bssid=b, signal=int(sig) if str(sig).isdigit() else sig, chan=ch); return self._rec("scan", r)
            if time.monotonic() - t0 > seconds: return self._rec("scan", r)
            time.sleep(1)

    def join(self, ssid, timeout=30):
        """Joins the open network `ssid`; returns the gateway the fox's DHCP handed out (the portal's address)."""
        try:
            self.be.connect(ssid, timeout)
        except RuntimeError as e:
            self._rec("join", {"error": str(e)[-160:]}); raise
        self.joined = True
        t0 = time.monotonic(); gw = ""
        while time.monotonic() - t0 < timeout and not gw:
            gw = self.be.gateway()
            if not gw: time.sleep(0.5)
        return self._rec("join", gw or PORTAL_IP)

    def leave(self):
        """Disconnect and forget the network, so the computer does not go back to the fox on its own tomorrow."""
        if not self.joined: return
        self.joined = False
        try: self.be.disconnect()
        except RuntimeError: pass


def _run(argv, timeout=40):
    import subprocess
    p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, errors="replace")
    if p.returncode:
        raise RuntimeError("%s: %s" % (" ".join(argv[:4]), (p.stderr or p.stdout).strip()[-200:]))
    return p.stdout


class _Nmcli:
    """NetworkManager (Linux)."""

    def __init__(self, iface):
        if iface is None:
            for line in _run(["nmcli", "-t", "-f", "DEVICE,TYPE", "dev"]).splitlines():
                dev, _, kind = line.partition(":")
                if kind == "wifi":
                    iface = dev; break
        if not iface:
            raise SystemExit("no Wi-Fi device in `nmcli dev`; pass --wifi IFACE")
        self.iface = iface

    def scan_rows(self):
        try:
            out = _run(["nmcli", "-t", "-f", "SSID,BSSID,SIGNAL,CHAN", "dev", "wifi", "list", "ifname", self.iface, "--rescan", "yes"])
        except RuntimeError as e:
            if "running" not in str(e) and "busy" not in str(e).lower(): raise
            out = ""
        return parse_nmcli_list(out)

    def connect(self, ssid, timeout):
        _run(["nmcli", "dev", "wifi", "connect", ssid, "ifname", self.iface, "name", SMOKE_CON], timeout=timeout + 10)

    def gateway(self):
        gw = ""
        for line in _run(["nmcli", "-t", "-f", "IP4.GATEWAY", "dev", "show", self.iface]).splitlines():
            gw = line.partition(":")[2].strip() or gw
        return gw

    def disconnect(self):
        for args in (("con", "down", SMOKE_CON), ("con", "delete", SMOKE_CON)):
            try: _run(["nmcli"] + list(args), timeout=15)
            except RuntimeError: pass


def parse_nmcli_list(out):
    """`nmcli -t -f SSID,BSSID,SIGNAL,CHAN dev wifi list` -> [(ssid, BSSID, signal, chan)]. nmcli escapes the colons in a
    BSSID as "\\:"; the SSID may hold anything but a bare ":"."""
    rows = []
    for line in out.splitlines():
        parts = re.split(r"(?<!\\):", line)
        if len(parts) < 4: continue
        rows.append((parts[0].replace("\\:", ":"), parts[1].replace("\\:", ":").upper(), parts[2], parts[3]))
    return rows


class _Netsh:
    """netsh wlan (Windows). Joining an open network needs a profile: a temporary one named SMOKE_CON is added, used and
    deleted again. netsh shows the adapter's last scan, which Windows refreshes every few seconds on its own; the scan
    loop in HostWifi.scan() asks again until the fox shows up."""

    def __init__(self, iface):
        if iface is None:
            m = re.search(r"^\s*Name\s*:\s*(.+?)\s*$", _run(["netsh", "wlan", "show", "interfaces"]), re.M)
            iface = m.group(1) if m else None
        if not iface:
            raise SystemExit("no Wi-Fi interface in `netsh wlan show interfaces`; pass --wifi NAME")
        self.iface = iface

    def scan_rows(self):
        return parse_netsh_networks(_run(["netsh", "wlan", "show", "networks", "mode=bssid", "interface=" + self.iface]))

    def connect(self, ssid, timeout):
        import tempfile
        xml = netsh_open_profile(SMOKE_CON, ssid)
        with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False, encoding="utf-8") as f:
            f.write(xml); path = f.name
        try:
            _run(["netsh", "wlan", "add", "profile", "filename=" + path, "interface=" + self.iface, "user=current"])
        finally:
            try: os.remove(path)
            except OSError: pass
        _run(["netsh", "wlan", "connect", "name=" + SMOKE_CON, "ssid=" + ssid, "interface=" + self.iface])
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            st = _run(["netsh", "wlan", "show", "interfaces"])
            if re.search(r"^\s*State\s*:\s*connected", st, re.M | re.I) and ssid in st:
                return
            time.sleep(1)
        raise RuntimeError("netsh wlan connect %r: not connected after %d s" % (ssid, timeout))

    def gateway(self):
        m = re.search(r"Default Gateway\s*:\s*([0-9.]+)", _run(["netsh", "interface", "ip", "show", "config", "name=" + self.iface]))
        return m.group(1) if m else ""

    def disconnect(self):
        for args in (["netsh", "wlan", "disconnect", "interface=" + self.iface], ["netsh", "wlan", "delete", "profile", "name=" + SMOKE_CON, "interface=" + self.iface]):
            try: _run(args, timeout=15)
            except RuntimeError: pass


def parse_netsh_networks(out):
    """`netsh wlan show networks mode=bssid` -> [(ssid, BSSID, signal %, channel)], one row per BSSID."""
    rows, ssid, bssid, sig = [], None, None, None
    for line in out.splitlines():
        m = re.match(r"^\s*SSID \d+\s*:\s*(.*?)\s*$", line)
        if m:
            ssid = m.group(1); continue
        m = re.match(r"^\s*BSSID \d+\s*:\s*([0-9a-fA-F:]{17})", line)
        if m:
            bssid = m.group(1).upper(); sig = None; continue
        m = re.match(r"^\s*Signal\s*:\s*(\d+)%", line)
        if m:
            sig = m.group(1); continue
        m = re.match(r"^\s*Channel\s*:\s*(\d+)", line)
        if m and ssid is not None and bssid:
            rows.append((ssid, bssid, sig or "", m.group(1))); bssid = None
    return rows


def netsh_open_profile(name, ssid):
    """A WLAN profile for an open network, as `netsh wlan add profile` takes it (manual connection: never joined on its own)."""
    from xml.sax.saxutils import escape
    return ('<?xml version="1.0"?>\n<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">'
            "<name>%s</name><SSIDConfig><SSID><hex>%s</hex><name>%s</name></SSID><nonBroadcast>false</nonBroadcast></SSIDConfig>"
            "<connectionType>ESS</connectionType><connectionMode>manual</connectionMode>"
            "<MSM><security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security></MSM>"
            "</WLANProfile>\n") % (escape(name), ssid.encode("utf-8").hex().upper(), escape(ssid))


class ReplayHost:
    """The host side of a recorded run (--host-from): scan, join, DNS and portal results come from the recording's
    "host" lines, in order, so a --payload/--checkpoint recording replays in CI without a Wi-Fi adapter
    (tools/replay_check.py passes this). The REPL side is the pty board's replay as usual."""
    def __init__(self, path):
        self.ex = [e for e in json.load(open(path))["exchanges"] if e.get("kind") == "host"]
        self.iface = "replay"; self.joined = False

    def _take(self, op):
        for i, e in enumerate(self.ex):
            if e["op"] == op:
                del self.ex[i]; return e["result"]
        raise RuntimeError("host %s: not in the recording (the run that made it did not do this)" % op)

    def scan(self, seconds, ssid=None, bssid=None):
        return self._take("scan")

    def join(self, ssid, timeout=30):
        r = self._take("join")
        if isinstance(r, dict) and r.get("error"): raise RuntimeError(r["error"])
        self.joined = True; return r

    def leave(self):
        self.joined = False

    def dns(self, server):
        return self._take("dns")

    def portal(self, host, code, call):
        r = self._take("portal")
        if r.get("error"): raise OSError(r["error"])
        return r


def dns_query(name, server, timeout=3):
    """One A query for `name` straight at `server` (the fox's captive DNS), bypassing the host's resolver.
    Returns the dotted address in the first answer, or None."""
    import socket, struct, random
    q = struct.pack(">HHHHHH", random.randint(1, 0xFFFF), 0x0100, 1, 0, 0, 0)
    for part in name.strip(".").split("."):
        q += bytes([len(part)]) + part.encode()
    q += b"\x00" + struct.pack(">HH", 1, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(timeout)
    try:
        s.sendto(q, (server, 53)); ans, _ = s.recvfrom(512)
    except OSError:
        return None
    finally:
        s.close()
    return _dns_parse(q, ans)


def _dns_parse(q, ans):
    """The A record in the first answer of `ans` to query `q`, dotted; None when it is not one."""
    import struct
    if len(ans) < len(q) + 16 or ans[:2] != q[:2] or struct.unpack(">H", ans[6:8])[0] < 1: return None
    rr = ans[len(q):]                                   # the first RR: name (a pointer or labels), type, class, ttl, rdlength, rdata
    i = 0
    while i < len(rr) and rr[i] and not rr[i] & 0xC0: i += 1 + rr[i]
    i += 2 if i < len(rr) and rr[i] & 0xC0 else 1
    if len(rr) < i + 14 or struct.unpack(">H", rr[i:i + 2])[0] != 1: return None
    return ".".join(str(b) for b in rr[i + 10:i + 14])


def portal_visit(host, code, call, timeout=6):
    """What a phone does on the fox's network: GET the page, read the code, hand in a callsign. One connection per
    request (the fox closes each). Returns {"get": status, "code_seen", "form_seen", "post": status, "logged"}."""
    import http.client, urllib.parse
    r = {"get": None, "code_seen": False, "form_seen": False, "post": None, "logged": False}
    c = http.client.HTTPConnection(host, 80, timeout=timeout)
    c.request("GET", "/", headers={"Host": "captive.apple.com", "Connection": "close"})
    resp = c.getresponse(); body = resp.read().decode(errors="replace"); c.close()
    r["get"] = resp.status
    r["code_seen"] = bool(code) and (">%s<" % code) in body
    r["form_seen"] = "name=callsign" in body
    if not r["form_seen"]: return r
    data = urllib.parse.urlencode({"callsign": call})
    c = http.client.HTTPConnection(host, 80, timeout=timeout)
    c.request("POST", "/find", body=data, headers={"Host": host, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": str(len(data)), "Connection": "close"})
    resp = c.getresponse(); body = resp.read().decode(errors="replace"); c.close()
    r["post"] = resp.status
    r["logged"] = ("Logged: <b>%s</b>" % call.upper()) in body
    return r


def finds_rows(csv_text, call):
    """The finds.csv rows (dicts) whose callsign is `call`."""
    lines = [l for l in csv_text.replace("\r", "").split("\n") if l.strip()]
    if not lines: return []
    cols = lines[0].split(",")
    rows = [dict(zip(cols, l.split(","))) for l in lines[1:]]
    return [r for r in rows if r.get("callsign") == call.upper()]


def _num(x):
    """A number as it goes into a command: 1.0 -> 1, 0.5 -> 0.5. Keeps a recorded command's text equal to a replayed one."""
    return str(int(x)) if float(x) == int(x) else repr(float(x))


def parse_banner(text):
    m = re.search(r"^FOX (.*)$", text, re.M)
    if not m: return None
    d = {"_raw": m.group(0)}
    for kv in re.findall(r'\S+=(?:"[^"]*"|\([^)]*\)|\S)*', m.group(1)):   # name="W1ABC FOX DE W1ABC" is one value
        k, _, v = kv.partition("="); d[k] = v[1:-1] if len(v) > 1 and v[0] == v[-1] == '"' else v
    return d


def pick_port(explicit):
    if explicit: return explicit
    ports = [p.device for p in serial.tools.list_ports.comports() if "Bluetooth" not in (p.description or "")]
    if len(ports) == 1: return ports[0]
    sys.exit("pass --port; candidates: %s" % ", ".join(ports) or "none")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--port")
    ap.add_argument("--board", default="seeed_xiao_esp32c3", help="target id: the defaults file to use (seeed_xiao_esp32c3 for the C3 + SA868; esp32c3, esp32c6, esp32c5, esp32s3, nrf52840 for the bare boards)")
    ap.add_argument("--variant", help="network foxes: the physical board (hardware id, e.g. dfrobot_firebeetle2_esp32c5) when the chip target has several; sets fox.json variant and its LED pin")
    ap.add_argument("--templates", default="all", help="comma list or all")
    ap.add_argument("--call", default="N0CALL DECOY DECOY N0CALL", help="callmessage; with the placeholder the fox stays silent (id=unset)")
    ap.add_argument("--freq", type=float, help="frequency in MHz (default: the template default)")
    ap.add_argument("--module", help="radio module id from modules/ (e.g. sa868_dual); sets radio.family and ranges_mhz so --freq on the other band is allowed")
    ap.add_argument("--observe", type=float, default=8, help="seconds to watch each template run after its banner")
    ap.add_argument("--key-seconds", type=float, default=1, help="bench key test length; 0 skips keying")
    ap.add_argument("--yes-antenna", action="store_true", help="confirm an antenna or dummy load is connected")
    ap.add_argument("--no-restore", action="store_true", help="leave the last template on the board instead of restoring what was there")
    ap.add_argument("--report", help="JSON report path (default: hw_smoke-<uid>-<time>.json in the current directory)")
    ap.add_argument("--sniffer", help="port of a second board running tools/sniffer/code.py; verifies wifi-probe by what went over the air")
    ap.add_argument("--mpy", action="store_true", help="write foxlib precompiled (.mpy, firmware/mpy/<CircuitPython major>/, tools/build_mpy.py) instead of the sources; the sources on the board are removed as stale")
    ap.add_argument("--trace", action="store_true", help="network foxes: write settings.toml with FOX_TRACE = 1 so every init step is printed before the banner (a board that hangs on the way up shows where); removed again at the end unless --no-restore")
    ap.add_argument("--record", help="write every REPL exchange of this run to FILE (JSON) for firmware/sim/pty_board.py --replay")
    ap.add_argument("--payload", action="store_true", help="network foxes: scan with this computer's Wi-Fi (nmcli on Linux, netsh on Windows) while each Wi-Fi fox runs and require its name on the air (BSSID and signal go into the report); BLE is not checked from the host")
    ap.add_argument("--checkpoint", action="store_true", help="checkpoint foxes: join the fox's network with this computer's Wi-Fi (nmcli on Linux, netsh on Windows), ask its captive DNS, GET the sign-in page (the code must be on it), POST --find-call to /find, leave, then read finds.csv back over the REPL and require the row; the computer is off the internet while joined")
    ap.add_argument("--find-call", default="W1XYZ", help="the callsign --checkpoint hands in (a placeholder; it ends up in finds.csv on the board and in a recording)")
    ap.add_argument("--wifi", help="the computer's Wi-Fi interface for --payload/--checkpoint (default: the first one nmcli / netsh lists; on Windows the adapter's name, usually Wi-Fi)")
    ap.add_argument("--host-from", metavar="RECORDING", help="replay: take the host side of --payload/--checkpoint (scan, join, DNS, portal) from this recording's 'host' lines instead of the computer's Wi-Fi (tools/replay_check.py)")
    ap.add_argument("--portal-only", nargs="?", const=PORTAL_IP, metavar="HOST", help="no board: this computer is already on a checkpoint fox's network (joined by hand); run the DNS and portal checks against HOST (default %s) and exit. Needs neither nmcli nor netsh" % PORTAL_IP)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    if a.portal_only:
        host = a.portal_only
        dns = dns_query("captive.apple.com", host)
        print("captive DNS at %s: %s" % (host, ("captive.apple.com -> %s" % dns) if dns else "no answer (captive_dns off, or this is not the fox's network)"))
        try:
            v = portal_visit(host, None, a.find_call)
        except OSError as e:
            sys.exit("portal at http://%s/: %s (is this computer on the fox's network?)" % (host, e))
        print("portal: GET %s, form %s, POST %s, logged %s" % (v["get"], "seen" if v["form_seen"] else "absent (ask_callsign off?)", v["post"], v["logged"]))
        print("the find is in finds.csv on the fox: Collect finds on the Bench tab, or hw_smoke --checkpoint with the board on serial reads it back")
        sys.exit(0 if v["get"] == 200 and (v["logged"] or not v["form_seen"]) else 1)
    if not a.yes_antenna:
        sys.exit("Every template keys the transmitter within seconds of booting. Connect an antenna or dummy load, then pass --yes-antenna.")

    idx = json.load(open(os.path.join(ROOT, "firmware/index.json")))
    templates = idx["templates"] if a.templates == "all" else a.templates.split(",")
    foxlib_version = open(os.path.join(ROOT, "firmware/foxlib/VERSION")).read().strip()

    recording = [] if a.record else None
    sniffer = None
    if a.sniffer:
        sniffer = Sniffer(a.sniffer)
        print("sniffer on %s: %s" % (a.sniffer, "hello %s" % sniffer.hello if sniffer.hello else "no hello line in 3 s (is tools/sniffer/code.py running?)"))
    host = (ReplayHost(a.host_from) if a.host_from else HostWifi(a.wifi, recording)) if (a.payload or a.checkpoint) else None
    if host: print("host Wi-Fi: %s (%s)" % (host.iface, ", ".join(f for f, on in (("--payload", a.payload), ("--checkpoint", a.checkpoint)) if on)))
    r = Repl(pick_port(a.port), a.verbose, recording)
    print("interrupting whatever runs …")
    r.interrupt()
    ident = r.exec("import board, microcontroller, os, sys\nprint(board.board_id)\nprint(''.join('%02x' % b for b in microcontroller.cpu.uid))\nprint(os.uname().release)\nprint(os.uname().version)\n").strip().splitlines()
    board_id, uid, cp_release, cp_version = (ident + ["", "", "", ""])[:4]
    print("board %s  uid %s  CircuitPython %s" % (board_id, uid, cp_release))
    # the ids a catalog entry answers to: its own, its CircuitPython build's, and the builds it shares (board_ids)
    known = {a.board}
    for hw in glob.glob(os.path.join(ROOT, "hardware", "*.json")):
        try:
            h = json.load(open(hw))
        except Exception:
            continue
        if not isinstance(h, dict):
            continue
        if h.get("id") in (a.board, a.variant) or h.get("target") == a.board:
            cp = h.get("circuitpython") or {}
            known.add(cp.get("board_id")); known.update(cp.get("board_ids") or [])
    if board_id not in known:
        print("WARNING: board reports %s, deploying defaults for %s" % (board_id, a.board))
    report = {"generated": datetime.now().isoformat(timespec="seconds"), "board_id": board_id, "uid": uid, "circuitpython": cp_release, "cp_version": cp_version,
              "foxlib": foxlib_version, "call": a.call, "freq": a.freq, "module": a.module, "sniffer": a.sniffer or "not used", "templates": {}}

    # A board with a CIRCUITPY drive (ESP32-S3, nRF52840): its files are the computer's, read-only to the board's
    # code (which is what writes here), until firmware/boot.py gives them to the board. The remount works from the
    # REPL only once the drive is ejected on the computer.
    fs = r.exec("try:\n import storage\n ro = storage.getmount('/').readonly\nexcept Exception:\n ro = False\n"
                "if not ro:\n print('rw')\nelse:\n try:\n  storage.remount('/', False)\n  print('remounted')\n except Exception as e:\n  print('usb', e)\n").strip()
    if fs.startswith("usb"):
        sys.exit("\nThe board's files are read-only to the board: it shows up as a CIRCUITPY drive and the computer has it (%s).\n"
                 "Once per board, either:\n"
                 "  1. copy firmware/boot.py onto the CIRCUITPY drive, press the board's reset button, run this again; or\n"
                 "  2. eject the CIRCUITPY drive in the file manager (leave the cable in) and run this again.\n"
                 "After that the drive is read-only on the computer. To undo: import os; os.remove('boot.py') at the REPL, then reset." % fs[4:])
    if fs.startswith("remounted"):
        have = r.read_file("boot.py")
        if have is None or b"fox-bench boot.py" in have:
            r.write_file("boot.py", open(os.path.join(ROOT, "firmware/boot.py"), "rb").read())
            print("wrote boot.py: from the next reset the board's files belong to the board (the CIRCUITPY drive is read-only on the computer)")
        else:
            print("WARNING: the board has its own boot.py, left alone; without storage.remount('/', readonly=False) in it the next power-up is read-only again")

    # what was there
    before = {p: r.read_file(p) for p in ("code.py", "fox.json", "defaults.json")}
    print("saved current code.py/fox.json/defaults.json (%s)" % ", ".join(k for k, v in before.items() if v is not None))

    # foxlib once, verified: the files the templates of this run need (firmware/index.json's sets, from the import
    # graph; tools/foxlib_deps.py), the rest of foxlib on the board removed as stale -- as the page's Deploy does
    sets, tsets = idx.get("foxlib_sets") or {}, idx.get("template_sets") or {}
    wanted = {f for t in templates for f in sets.get(tsets.get(t, ""), idx["foxlib"])}
    need = [f for f in idx["foxlib"] if f in wanted]       # the index's order: VERSION last, as the page writes it (foxlib_deps.ordered)
    lib_dir = os.path.join(ROOT, "firmware/foxlib")
    if a.mpy:
        # the precompiled set for the board's CircuitPython major (tools/build_mpy.py); VERSION stays a source file
        major = cp_release.split(".")[0]
        mdir = os.path.join(ROOT, "firmware/mpy", major)
        if not os.path.exists(os.path.join(mdir, "manifest.json")):
            raise SystemExit("--mpy: no precompiled set for CircuitPython %s.x (python3 tools/build_mpy.py)" % major)
        man = json.load(open(os.path.join(mdir, "manifest.json")))
        if man["foxlib"] != foxlib_version:
            raise SystemExit("--mpy: firmware/mpy/%s is foxlib %s, the repo has %s (rebuild it)" % (major, man["foxlib"], foxlib_version))
        need = [n[:-3] + ".mpy" if n.endswith(".py") else n for n in need]
    print("writing foxlib %s (%d of %d files: %s%s) …" % (foxlib_version, len(need), len(idx["foxlib"]), "+".join(sorted({tsets.get(t, "all") for t in templates})), ", precompiled .mpy" if a.mpy else ""), end="", flush=True)
    r.mkdir("foxlib")
    for name in need:
        src = os.path.join(mdir, "foxlib", name) if a.mpy and name.endswith(".mpy") else os.path.join(lib_dir, name)
        r.write_file("foxlib/" + name, open(src, "rb").read())
    for name in idx.get("root", []):           # safemode.py, beside code.py
        r.write_file(name, open(os.path.join(ROOT, "firmware", name), "rb").read())
        print(".", end="", flush=True)
    stale = [n for n in r.listdir("foxlib") if n not in need]
    for n in stale:
        r.exec("import os\nos.remove('foxlib/%s')" % n)
    print(" ok" + (" (removed stale: %s)" % ", ".join(stale) if stale else ""))
    if a.trace:
        have = r.read_file("settings.toml")
        if have and TRACE_MARK.encode() not in have:
            print("WARNING: the board has its own settings.toml, left alone; add  FOX_TRACE = 1  to it for the boot trace")
        else:
            r.write_file("settings.toml", TRACE_TOML.encode())
            print("wrote settings.toml: FOX_TRACE = 1 (the boot trace; removed at the end unless --no-restore)")

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
                if a.variant:
                    vhw = json.load(open(os.path.join(ROOT, "hardware", a.variant + ".json")))
                    nr = vhw.get("net") or vhw.get("roles") or {}
                    fox["variant"] = a.variant
                    fox["pins"] = {"led": nr.get("led"), "batt_sense": nr.get("batt_sense")}
            if a.module and not net:
                mod = json.load(open(os.path.join(ROOT, "modules", a.module + ".json")))
                fox["module"] = mod["id"]
                fox["radio"]["family"] = mod["family"]
                fox["radio"]["ranges_mhz"] = mod["ranges_mhz"]
            if a.freq and not net: fox["plan"]["frequencies_mhz"] = [a.freq]
            fox.setdefault("fleet", {})["notes"] = "hw_smoke"
            res["template_version"] = manifest["version"]
            cp_cfg = fox.get("checkpoint") or {}
            portal = (cp_cfg.get("portal") or {}) if cp_cfg.get("enabled") else {}
            portal_on = bool(host and a.checkpoint and net and portal.get("enabled"))
            r.interrupt()
            finds_before = r.read_file("finds.csv") if portal_on else None     # the board is left as it was found
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
            if b and b.get("mem"): res["mem_free"] = int(b["mem"]) if b["mem"].isdigit() else b["mem"]   # a network fox's heap after init
            res["boot_log"] = boot[-2000:]
            if a.trace:
                for l in boot.splitlines():
                    if l.startswith("init: "): print("  " + l)
            if not b:
                res["ok"] = False; print("  no FOX banner within 20 s:\n" + "\n".join("    " + l for l in boot.strip().splitlines()[-8:])); continue
            print("  %s (%.1f s to banner)" % (b["_raw"], res["boot_s"]))
            if sniffer and manifest.get("contract") == "net" and (defaults.get("net") or {}).get("kind") == "wifi-probe":
                # the probes carry the MAC and the SSID the banner names: count what went over the air while the fox runs
                mac = b.get("mac", ""); ssid = a.call   # hw_smoke deploys with use_callsign_as_name, so the SSID the fox probes for is the callsign
                seen = sniffer.watch(a.observe, mac, ssid)
                run = r.listen(0.1)
                res["sniffer"] = seen
                print("  sniffer: %d probe(s) from %s, %d with SSID %r, %d from others%s" % (seen["from_fox"], mac, seen["with_ssid"], ssid, seen["others"], " · " + json.dumps(seen["sample"][0]) if seen["sample"] else ""))
            elif host and net and (fox["net"].get("kind") or "").startswith("wifi") and fox["net"].get("kind") != "wifi-probe":
                # the computer as a hunter's phone: is the fox's network on the air, and does its sign-in page work
                name, mac, hidden = b.get("name", ""), b.get("mac", ""), bool(fox["net"].get("hidden"))
                if a.payload:
                    seen = res["on_air"] = host.scan(max(a.observe, 20), ssid=None if hidden else name, bssid=mac if hidden else None)
                    if seen["seen"]:
                        print("  on the air: %r from %s, signal %s, channel %s (%d networks around, %d scan%s)%s" % (name, seen["bssid"], seen["signal"], seen["chan"], seen["networks"], seen["scans"], "" if seen["scans"] == 1 else "s",
                              "" if not mac or mac == "?" or seen["bssid"] == mac.upper() else " · NOTE: BSSID is not the %s fox.json asked for (bench-runbook Q12)" % mac.upper()))
                    else:
                        print("  NOT on the air: %r not in %d scan(s) of %d network(s) in %.0f s — the fox never started its AP, or the host adapter is on another band" % (name, seen["scans"], seen["networks"], max(a.observe, 20)))
                if portal_on:
                    pv = res["portal"] = {"joined": False}
                    try:
                        gw = host.join(name)
                        pv["joined"] = True; pv["host"] = gw
                        pv["dns"] = host.dns(gw) if portal.get("captive_dns") else None
                        pv.update(host.portal(gw, portal.get("code") or None, a.find_call))
                    except (RuntimeError, OSError) as e:
                        pv["error"] = str(e)[-160:]
                    finally:
                        host.leave()
                    if pv.get("error"):
                        print("  portal: %s%s" % ("joined %r, then " % name if pv["joined"] else "could not join %r: " % name, pv["error"]))
                    else:
                        print("  portal at http://%s/: GET %s, code %s, form %s, POST %s, %s · captive DNS %s" % (
                            pv["host"], pv["get"], "shown" if pv["code_seen"] else ("missing" if portal.get("code") else "none set"), "seen" if pv["form_seen"] else "absent",
                            pv["post"], ("logged %s" % a.find_call) if pv["logged"] else "not logged", ("captive.apple.com -> %s" % pv["dns"]) if pv["dns"] else ("no answer" if portal.get("captive_dns") else "off")))
                run = r.listen(2)
            else:
                run = r.listen(a.observe)
            res["observed"] = run.strip()[-1500:]
            if run.strip(): print("  while running: " + " | ".join(run.strip().splitlines()[-3:])[:200])
            res["ok"] = b.get("cfg") == "ok" and b.get("radio") == "ok" and (b.get("id") == "set" or a.call.startswith("N0CALL"))
            if res.get("sniffer") is not None and res["sniffer"]["with_ssid"] < 1:
                res["ok"] = False; print("  no probe request from the fox with its SSID reached the sniffer in %.1f s — nothing went over the air, or the sniffer is on the wrong channels" % a.observe)
            if b.get("cfg") != "ok": print("  cfg=%s — the firmware disagreed with the defaults or fox.json" % b.get("cfg"))
            if b.get("radio") == "skipped": print("  radio=skipped — not attempted because the config was fatal; nothing was transmitted")
            elif b.get("radio") != "ok": print("  radio=%s — module not answering (wiring, PD pin, baud)" % b.get("radio"))

            if res.get("on_air") is not None and not res["on_air"]["seen"]:
                res["ok"] = False
            # bench, on a fresh VM
            r.interrupt()
            if portal_on:
                pv = res["portal"]
                text = r.read_file("finds.csv") if pv["joined"] else None
                rows = finds_rows(text.decode(errors="replace"), a.find_call) if text else []
                pv["finds_rows"] = len(rows)
                if rows: pv["find"] = rows[-1]
                if finds_before is None and text is not None:
                    r.exec("import os\nos.remove('finds.csv')")
                want_log = bool(portal.get("log"))
                pv["ok"] = bool(pv["joined"] and pv.get("get") == 200 and (pv.get("code_seen") or not portal.get("code")) and pv.get("logged")
                                and (pv["finds_rows"] >= 1 or not want_log) and (pv.get("dns") == pv.get("host") or not portal.get("captive_dns")))
                print("  finds.csv: %s%s" % (("%d row(s) for %s" % (len(rows), a.find_call)) + (" (+%s ms, cycle %s, via %s)" % (rows[-1].get("ms_since_boot"), rows[-1].get("cycle"), rows[-1].get("via")) if rows else "") if text else "not on the board",
                                             "" if finds_before is not None or text is None else " · removed again (it was not there before)"))
                if not pv["ok"]:
                    res["ok"] = False
                    why = ("not joined" if not pv["joined"] else "GET %s" % pv.get("get") if pv.get("get") != 200 else "code not on the page" if portal.get("code") and not pv.get("code_seen")
                           else "callsign not acknowledged" if not pv.get("logged") else "no finds.csv row" if want_log and pv["finds_rows"] < 1 else "captive DNS did not answer with the fox (bench-runbook Q5)")
                    print("  checkpoint FAILED: %s" % why)
            m = r.exec("import gc, time\ngc.collect()\na=gc.mem_free()\nt=time.monotonic()\nimport foxlib\nprint(a, gc.mem_free(), time.monotonic()-t)\n", timeout=60).split()
            res["mem_free_before"], res["mem_free_after_import"], res["import_s"] = int(m[0]), int(m[1]), round(float(m[2]), 2)
            if net:
                pre = "import gc\ntry:\n fox.deinit()\nexcept Exception:\n pass\nfrom foxlib.netfox import NetFox\nfox = NetFox('fox.json', defaults='defaults.json', quiet=True)\nif fox.fatal: raise RuntimeError('fox not usable: ' + fox.fatal)\ngc.collect()\n"
                out = r.exec(pre + "print(gc.mem_free())\nprint(fox.radio.status)\nprint(fox.rssi())\nprint(fox.radio.mac())\n", timeout=60).strip().splitlines()
                res["mem_free_with_fox"], res["probe"], res["rssi"], res["batt_v"] = int(out[0]), out[1], out[2], None
                print("  import %.1fs · free %d → %d → %d B · radio %s · scan %s · mac before up %s" % (res["import_s"], res["mem_free_before"], res["mem_free_after_import"], res["mem_free_with_fox"], out[1], out[2][:120], out[3]))
                if a.key_seconds > 0:
                    res["key"] = r.exec(pre + "print(fox.key_for(%s))\n" % _num(a.key_seconds), timeout=60 + a.key_seconds).strip()
                    print("  radio up %ss: %s" % (a.key_seconds, res["key"]))
                    want = (fox.get("net") or {}).get("mac")
                    got = re.search(r"\(([0-9A-Fa-f:?]+)\) for [0-9.]+ s$", res["key"])
                    if want and got:
                        res["mac_on_air"] = got.group(1).upper()
                        if fox["net"].get("kind") == "ble":          # a static random address: the two top bits set
                            want = "%02X%s" % (int(want[:2], 16) | 0xC0, want[2:])
                        if res["mac_on_air"] != want.upper():
                            print("  NOTE: the radio reports %s, fox.json asked for %s (bench-runbook Q12)" % (res["mac_on_air"], want.upper()))
            else:
                pre = "import foxlib, gc\ntry:\n fox.deinit()\nexcept Exception:\n pass\nfox = foxlib.Fox('fox.json', defaults='defaults.json', quiet=True)\nif fox.fatal: raise RuntimeError('fox not usable: ' + fox.fatal)\ngc.collect()\n"
                out = r.exec(pre + "print(gc.mem_free())\nprint(fox.radio.probe((146.5, 433.5)))\nprint(fox.radio.rssi())\nprint(fox.batt.read() if fox.batt else None)\n", timeout=60).strip().splitlines()
                res["mem_free_with_fox"], res["probe"], res["rssi"], res["batt_v"] = int(out[0]), out[1], out[2], out[3]
                print("  import %.1fs · free %d → %d → %d B · probe %s · rssi %s · batt %s" % (res["import_s"], res["mem_free_before"], res["mem_free_after_import"], res["mem_free_with_fox"], out[1], out[2], out[3]))
                if a.key_seconds > 0 and "keytest" in manifest.get("capabilities", []):
                    res["key"] = r.exec(pre + "print(fox.radio.key_for(%s))\n" % _num(a.key_seconds), timeout=60 + a.key_seconds).strip()
                    print("  key test %ss: %s" % (a.key_seconds, res["key"]))
        except Exception as e:
            res["ok"] = False; res["error"] = str(e); print("  ERROR:", e)

    # restore
    if not a.no_restore:
        r.interrupt()
        if a.trace:
            have = r.read_file("settings.toml")
            if have and TRACE_MARK.encode() in have: r.exec("import os\nos.remove('settings.toml')")
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
    if a.record:
        args_rec = {k: (_num(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v) for k, v in vars(a).items() if k not in ("port", "record", "report")}
        scrubbed = scrub_recording(recording, args_rec, a.call)
        rec = {"format": "fox-bench-bench-recording/2", "generated": report["generated"], "board_id": board_id, "uid": uid,
               "circuitpython": cp_release, "foxlib": foxlib_version, "args": args_rec, "exchanges": recording,
               "_": "format 2: one 'write' line per file (path, size, crc) instead of its bytes; the callsign replaced by %s; scan results scrubbed (%s)" % (RECORD_CALL, scrubbed)}
        json.dump(rec, open(a.record, "w"), indent=0)
        print("recorded %d exchanges to %s (callsign -> %s; %s)" % (len(recording), a.record, RECORD_CALL, scrubbed))
        if any(x.get("ok") is False for x in report["templates"].values()):
            print("  (a template failed in this run: a recording replays its failure, so commit this file only from a run where every template passed)")
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
