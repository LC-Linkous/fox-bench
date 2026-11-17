# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netcheckpoint.py -- the fox as a server (the `checkpoint` section, phase D of
# docs/network-fox-payloads-plan.md).
#
#   portal   on a Wi-Fi access-point fox: one web page (title, text, the code, an optional callsign form) on port 80,
#            and a captive-DNS answerer on port 53 that resolves every name to the fox, so a phone that joins the
#            open network pops its "sign in" sheet by itself. No library: a GET and a POST are all it understands.
#   ble      a connectable service beside the beacon: a read-only characteristic with the code, a write
#            characteristic for a callsign. Raw _bleio, no adafruit_ble.
#   finds.csv  one line per callsign handed in, over the portal or BLE:
#            fox_uid, template, cycle, ms_since_boot, callsign, client_mac   (the fleet-wide format; MAX_FINDS lines)
#
# Hooks: before_up opens the sockets / adds the service, while_up serves whoever is there (the runner ticks every
# TICK_MS while a checkpoint is on), after_down closes everything. Everything is non-blocking and bounded: a slow
# client costs one tick, never the cycle. The simulator mocks socketpool and _bleio with a scripted phone.
import time
from . import netradio

TICK_MS = 50               # how often while_up runs while the radio is up (the runner's default is 1000)
MAX_FINDS = 200            # lines kept in finds.csv
MAX_CALLSIGN = 16
RECV_TIMEOUT_S = 0.3
PORTAL_IP = "192.168.4.1"  # what CircuitPython's access point hands out; read from wifi.radio when it can be
FINDS_FILE = "finds.csv"
FINDS_HEADER = "fox_uid,template,cycle,ms_since_boot,callsign,client_mac\n"

_HTML = ("<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
         "<title>%s</title><style>body{font:18px/1.4 system-ui,sans-serif;margin:24px;max-width:480px}"
         ".code{font:bold 48px/1.2 monospace;letter-spacing:.1em;margin:16px 0}input{font:inherit;padding:6px}"
         "button{font:inherit;padding:6px 14px}</style></head><body><h1>%s</h1>%s%s%s</body></html>")
_FORM = ("<form method=post action=/find><label>Your callsign<br><input name=callsign maxlength=%d autocapitalize=characters "
         "autocomplete=off required></label> <button>Log my find</button></form>")
_THANKS = "<p>Logged: <b>%s</b>. Good hunting.</p>"


def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _paras(text):
    return "".join("<p>%s</p>" % _esc(p.strip()) for p in text.replace("\r", "").split("\n\n") if p.strip())


def page_html(portal, thanks=None):
    """The one page. thanks = a callsign just logged (the form is replaced by the acknowledgement)."""
    title = _esc(portal["title"] or "Checkpoint")
    code = ("<div class=code>%s</div>" % _esc(portal["code"])) if portal["code"] else ""
    tail = (_THANKS % _esc(thanks)) if thanks else ((_FORM % MAX_CALLSIGN) if portal["ask_callsign"] else "")
    return _HTML % (title, title, _paras(portal["body"]), code, tail)


def http_response(body, status="200 OK", ctype="text/html; charset=utf-8"):
    b = body.encode("utf-8") if isinstance(body, str) else body
    head = "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n" % (status, ctype, len(b))
    return head.encode() + b


def parse_request(raw):
    """(method, path, body) from the bytes a client sent; None when it is not HTTP."""
    try:
        head, _, body = raw.partition(b"\r\n\r\n")
        line = head.split(b"\r\n", 1)[0].decode()
        method, path, _ = line.split(" ", 2)
        return method.upper(), path, body
    except Exception:
        return None


def form_value(body, name):
    """One field of an application/x-www-form-urlencoded body, decoded; '' when absent."""
    for part in body.split(b"&"):
        k, _, v = part.partition(b"=")
        if k == name.encode():
            return _unquote(v.replace(b"+", b" "))
    return ""


def _unquote(b):
    out = bytearray()
    i = 0
    while i < len(b):
        if b[i] == 0x25 and i + 2 < len(b):          # %XX
            try:
                out.append(int(b[i + 1:i + 3], 16))
                i += 3
                continue
            except Exception:
                pass
        out.append(b[i])
        i += 1
    try:
        return out.decode("utf-8")
    except Exception:
        return "".join(chr(c) for c in out if c < 128)


def clean_callsign(s):
    s = "".join(c for c in s.upper() if c.isalpha() or c.isdigit() or c in "/-")
    return s[:MAX_CALLSIGN]


def dns_answer(query, ip4):
    """A DNS response saying 'that name is ip4' for any query with one question; None for anything else."""
    try:
        if len(query) < 12 or (query[2] & 0x80):
            return None
        qd = (query[4] << 8) | query[5]
        if qd != 1:
            return None
        i = 12
        while query[i] != 0:            # skip the name labels
            i += query[i] + 1
        qend = i + 5                    # the zero, qtype, qclass
        qtype = (query[i + 1] << 8) | query[i + 2]
        head = bytes([query[0], query[1], 0x81, 0x80, 0, 1, 0, 1 if qtype in (1, 255) else 0, 0, 0, 0, 0])
        ans = b""
        if qtype in (1, 255):
            ans = b"\xC0\x0C" + bytes([0, 1, 0, 1, 0, 0, 0, 60, 0, 4]) + ip4
        return head + bytes(query[12:qend]) + ans
    except Exception:
        return None


def _ip_bytes(wifi):
    try:
        ip = wifi.radio.ipv4_address_ap
        if hasattr(ip, "packed"):
            return bytes(ip.packed), str(ip)
        s = str(ip)
        return bytes(int(p) for p in s.split(".")), s
    except Exception:
        return bytes(int(p) for p in PORTAL_IP.split(".")), PORTAL_IP


class FindLog:
    """finds.csv, append-only, MAX_FINDS lines; a read-only filesystem (a host holding the drive) is said once."""

    def __init__(self, fox):
        self.fox = fox
        self.count = None
        self.said_ro = False
        self.ram = []            # what could not be written, so the Bench can still read this session's finds

    def _count(self):
        n = 0
        try:
            with open(FINDS_FILE) as f:
                for line in f:
                    if line.strip():
                        n += 1
            n = max(0, n - 1)
        except OSError:
            n = -1               # no file yet: the header goes first
        return n

    def add(self, cycle, callsign, client):
        if self.count is None:
            self.count = self._count()
        row = "%s,%s,%d,%d,%s,%s\n" % (self.fox.uid, self.fox.cfg.get("template", "?"), cycle, time.monotonic_ns() // 1000000, callsign, client)
        if self.count >= MAX_FINDS:
            self.fox.log("find log: full (%d lines); %s not written" % (MAX_FINDS, callsign))
            return False
        try:
            with open(FINDS_FILE, "a") as f:
                if self.count < 0:
                    f.write(FINDS_HEADER)
                    self.count = 0
                f.write(row)
            self.count += 1
            return True
        except OSError as e:
            self.ram.append(row)
            if not self.said_ro:
                self.said_ro = True
                self.fox.log("find log: cannot write %s (%s: the host may hold the drive); keeping finds in RAM" % (FINDS_FILE, e.__class__.__name__))
            return False


class Portal:
    """The web page and the captive DNS, on the access point."""

    def __init__(self, fox, cp, finds):
        self.fox, self.cfg, self.finds = fox, cp["portal"], finds
        self.pool = None
        self.http = None
        self.dns = None
        self.buf = bytearray(1024)
        self.ip4 = bytes([192, 168, 4, 1])
        self.hits = 0
        self.cycle = 0

    def open(self, cycle):
        self.cycle = cycle
        wifi = self.fox.radio.wifi
        try:
            import socketpool
            if self.pool is None:
                self.pool = socketpool.SocketPool(wifi.radio)
            pool = self.pool
            self.ip4, ip = _ip_bytes(wifi)
            s = pool.socket(pool.AF_INET, pool.SOCK_STREAM)
            try:
                s.setsockopt(pool.SOL_SOCKET, pool.SO_REUSEADDR, 1)
            except Exception:
                pass
            s.bind(("0.0.0.0", 80))
            s.listen(2)
            s.setblocking(False)
            self.http = s
            if self.cfg["captive_dns"]:
                u = pool.socket(pool.AF_INET, pool.SOCK_DGRAM)
                u.bind(("0.0.0.0", 53))
                u.setblocking(False)
                self.dns = u
            self.fox.log("checkpoint: portal at http://%s/%s" % (ip, " with captive DNS" if self.dns else ""))
        except Exception as e:
            self.close()
            self.fox.log("checkpoint: portal failed (%s: %s)" % (e.__class__.__name__, str(e)[:40]))

    def close(self):
        for s in (self.http, self.dns):
            if s is not None:
                try:
                    s.close()
                except Exception:
                    pass
        self.http = self.dns = None

    def serve(self):
        """One tick: answer every pending DNS query and up to a few HTTP clients."""
        if self.dns is not None:
            for _ in range(4):
                try:
                    n, addr = self.dns.recvfrom_into(self.buf)
                except OSError:
                    break
                ans = dns_answer(self.buf[:n], self.ip4)
                if ans:
                    try:
                        self.dns.sendto(ans, addr)
                    except Exception:
                        pass
        if self.http is not None:
            for _ in range(2):
                try:
                    conn, addr = self.http.accept()
                except OSError:
                    break
                self._client(conn, addr)

    def _client(self, conn, addr):
        try:
            conn.settimeout(RECV_TIMEOUT_S)
            n = conn.recv_into(self.buf)
            raw = bytes(self.buf[:n])
            req = parse_request(raw)
            if req is None:
                return
            method, path, body = req
            # a POST whose body came in a second segment
            want = _content_length(raw)
            tries = 0
            while method == "POST" and len(body) < want and tries < 3:
                try:
                    m = conn.recv_into(self.buf)
                except OSError:
                    break
                body += bytes(self.buf[:m])
                tries += 1
            thanks = None
            if method == "POST" and self.cfg["ask_callsign"]:
                call = clean_callsign(form_value(body, "callsign"))
                if call:
                    thanks = call
                    client = self._client_mac(addr)
                    self.fox.log("checkpoint: find %s from %s" % (call, client))
                    if self.cfg["log"]:
                        self.finds.add(self.cycle, call, client)
            self.hits += 1
            conn.send(http_response(page_html(self.cfg, thanks)))
        except Exception as e:
            self.fox.log("checkpoint: client dropped (%s)" % e.__class__.__name__)
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _client_mac(self, addr):
        """The station's MAC when the port tells us (wifi.radio.stations_ap), else its IP."""
        ip = addr[0] if isinstance(addr, tuple) else str(addr)
        try:
            for st in self.fox.radio.wifi.radio.stations_ap:
                if str(getattr(st, "ipv4_address", "")) == ip:
                    return ":".join("%02X" % b for b in st.mac_address)
        except Exception:
            pass
        return ip


def _content_length(raw):
    for line in raw.split(b"\r\n\r\n", 1)[0].split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            try:
                return int(line.split(b":", 1)[1].strip())
            except Exception:
                return 0
    return 0


class BleService:
    """A connectable service on a BleBeacon: the code to read, a callsign to write."""
    CODE_UUID_TAIL = "C1"
    CALL_UUID_TAIL = "C2"

    def __init__(self, fox, cp, finds, beacon):
        self.fox, self.cfg, self.finds, self.beacon = fox, cp["ble"], finds, beacon
        self.service = None
        self.call_buf = None
        self.ready = False
        self.cycle = 0

    def setup(self):
        try:
            import _bleio
            base = self.cfg["service_uuid"]
            svc = _bleio.Service(_bleio.UUID(base))
            code = (self.cfg["code"] or "").encode("utf-8")[:MAX_CALLSIGN]
            _bleio.Characteristic.add_to_service(svc, _bleio.UUID(base[:-2] + self.CODE_UUID_TAIL), properties=_bleio.Characteristic.READ,
                                                 read_perm=_bleio.Attribute.OPEN, write_perm=_bleio.Attribute.NO_ACCESS,
                                                 max_length=max(1, len(code)), fixed_length=False, initial_value=code or b"-")
            call = _bleio.Characteristic.add_to_service(svc, _bleio.UUID(base[:-2] + self.CALL_UUID_TAIL),
                                                        properties=_bleio.Characteristic.WRITE | _bleio.Characteristic.WRITE_NO_RESPONSE,
                                                        read_perm=_bleio.Attribute.NO_ACCESS, write_perm=_bleio.Attribute.OPEN,
                                                        max_length=MAX_CALLSIGN, fixed_length=False)
            self.call_buf = _bleio.CharacteristicBuffer(call, timeout=0, buffer_size=64)
            self.service = svc
            self.beacon.connectable = True
            self.beacon.service_uuid = bytes.fromhex(base.replace("-", ""))
            self.ready = True
            self.fox.log("checkpoint: BLE service %s (code %s)" % (base, self.cfg["code"] or "-"))
        except Exception as e:
            self.fox.log("checkpoint: BLE service failed (%s: %s)" % (e.__class__.__name__, str(e)[:40]))
        return self.ready

    def serve(self):
        if not self.ready:
            return
        b = self.beacon
        try:
            # a central read the code and went away: advertise again (a connection stops advertising)
            if b.is_up and not b.adapter.connected and not getattr(b.adapter, "advertising", True):
                b.restart()
            buf = self.call_buf
            if buf is not None and buf.in_waiting:
                data = buf.read(buf.in_waiting)
                call = clean_callsign(data.decode("utf-8", "replace"))
                if call:
                    self.fox.log("checkpoint: find %s over BLE" % call)
                    if self.fox.cfg["checkpoint"]["portal"]["log"]:
                        self.finds.add(self.cycle, call, "ble")
        except Exception as e:
            self.fox.log("checkpoint: BLE tick failed (%s)" % e.__class__.__name__)


class Checkpoint:
    def __init__(self, fox):
        self.fox = fox
        self.cfg = fox.cfg["checkpoint"]
        self.finds = FindLog(fox)
        self.portal = None
        self.ble = None
        self.second = None       # a BLE beacon run beside a Wi-Fi fox for the service

    def before_up(self, fox, cycle):
        if self.portal is not None:
            self.portal.cycle = cycle
        if self.ble is not None:
            self.ble.cycle = cycle
        if self.second is not None:
            try:
                self.second.up()
            except Exception as e:
                fox.log("checkpoint: second radio failed (%s)" % e.__class__.__name__)

    def on_up(self, fox, cycle):
        if self.portal is not None and fox.radio.kind == "wifi-ap":      # a mode-rotating fox: the page only on AP wakes
            self.portal.open(cycle)

    def while_up(self, fox, cycle):
        if self.portal is not None and self.portal.http is not None:
            self.portal.serve()
        if self.ble is not None:
            self.ble.serve()

    def after_down(self, fox, cycle):
        if self.portal is not None:
            self.portal.close()
        if self.second is not None:
            self.second.down()


def attach(fox):
    cp = Checkpoint(fox)
    c = cp.cfg
    if c["portal"]["enabled"]:
        if fox.radio.kind == "wifi-ap":
            cp.portal = Portal(fox, c, cp.finds)
            fox.tick_ms = min(fox.tick_ms, TICK_MS)
        else:
            fox.log("checkpoint: the sign-in page needs an access point (net.kind=wifi-ap); not served")
    if c["ble"]["enabled"]:
        beacon = fox.radio if fox.radio.kind == "ble" else None
        if beacon is None and "ble" in fox.radios:
            beacon = netradio.make({"kind": "ble", "uuid": c["ble"]["service_uuid"], "major": 0, "minor": 0, "signal_power_dbm": -59,
                                    "adv_min": 200, "adv_max": 400, "tx_power_dbm": 0, "mac": fox.cfg["net"].get("mac")}, fox.name)
            if beacon.setup():
                cp.second = beacon
            else:
                fox.log("checkpoint: BLE service needs the BLE radio (%s); skipped" % beacon.status)
                beacon = None
        if beacon is not None:
            svc = BleService(fox, c, cp.finds, beacon)
            if svc.setup():
                cp.ble = svc
                fox.tick_ms = min(fox.tick_ms, TICK_MS)
    fox.hooks["before_up"].append(cp.before_up)
    fox.hooks["on_up"].append(cp.on_up)
    fox.hooks["while_up"].append(cp.while_up)
    fox.hooks["after_down"].append(cp.after_down)
    fox.checkpoint = cp
    return cp
