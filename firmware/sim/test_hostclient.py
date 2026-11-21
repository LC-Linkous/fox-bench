#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""tools/hw_smoke.py's host side (--checkpoint, --portal-only) against the fox's own portal code: the page, the form
handling and the captive DNS from foxlib/netcheckpoint.py are served on 127.0.0.1 by this script, and hw_smoke's
portal_visit / dns_query / finds_rows / parse_banner are run against them. No board, no Wi-Fi: what a bench run adds
is the join. Run: python3 firmware/sim/test_hostclient.py"""
import importlib.util, os, socket, sys, threading
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run as simrun                                   # loads foxlib through the simulator's package shim
simrun.load_fw("netradio")
nc = simrun.load_fw("netcheckpoint")
spec = importlib.util.spec_from_file_location("hw_smoke", os.path.join(HERE, "..", "..", "tools", "hw_smoke.py"))
hw = importlib.util.module_from_spec(spec); spec.loader.exec_module(hw)

fails = 0
def check(name, got, want):
    global fails
    ok = got == want
    fails += 0 if ok else 1
    print("%s %s%s" % ("ok  " if ok else "FAIL", name, "" if ok else " — got %r want %r" % (got, want)))


PORTAL = {"enabled": True, "title": "Checkpoint", "body": "You found it.\n\nWrite the code down.", "code": "4471", "ask_callsign": True, "captive_dns": True, "log": True}
handed = []


def serve_http(sock):
    """The fox's Portal._client, as netcheckpoint does it, request by request."""
    while True:
        try:
            conn, _ = sock.accept()
        except OSError:
            return
        raw = conn.recv(2048)
        req = nc.parse_request(raw)
        if req and req[0] == "POST":                       # the body may come in a second segment; the fox reads on for it too
            want, body, tries = nc._content_length(raw), req[2], 0
            while len(body) < want and tries < 3:
                body += conn.recv(2048); tries += 1
            req = (req[0], req[1], body)
        thanks = None
        if req and req[0] == "POST":
            call = nc.clean_callsign(nc.form_value(req[2], "callsign"))
            if call:
                thanks = call; handed.append(call)
        conn.sendall(nc.http_response(nc.page_html(PORTAL, thanks))); conn.close()


def serve_dns(sock, ip4):
    while True:
        try:
            q, addr = sock.recvfrom(512)
        except OSError:
            return
        ans = nc.dns_answer(q, ip4)
        if ans: sock.sendto(ans, addr)


# the servers: any free port for HTTP (hw_smoke talks to port 80, so the test points it at a port via a tiny shim)
http = socket.socket(); http.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); http.bind(("127.0.0.1", 0)); http.listen(4)
dns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); dns.bind(("127.0.0.1", 0))
threading.Thread(target=serve_http, args=(http,), daemon=True).start()
threading.Thread(target=serve_dns, args=(dns, bytes([192, 168, 4, 1])), daemon=True).start()
hport, dport = http.getsockname()[1], dns.getsockname()[1]

# portal_visit opens HTTPConnection(host, 80): route it to the test port
import http.client as hc
_orig = hc.HTTPConnection.__init__
def _init(self, host, port=None, *a, **k): _orig(self, host, hport, *a, **k)
hc.HTTPConnection.__init__ = _init

v = hw.portal_visit("127.0.0.1", "4471", "w1xyz/p")
check("GET 200", v["get"], 200)
check("code on the page", v["code_seen"], True)
check("form on the page", v["form_seen"], True)
check("POST 200", v["post"], 200)
check("callsign acknowledged (cleaned, upper-cased)", v["logged"], True)
check("the fox saw the callsign", handed, ["W1XYZ/P"])
v = hw.portal_visit("127.0.0.1", "9999", "W1XYZ")
check("another code is not 'seen'", v["code_seen"], False)
PORTAL["ask_callsign"] = False
v = hw.portal_visit("127.0.0.1", "4471", "W1XYZ")
check("no form: no POST", (v["form_seen"], v["post"], v["logged"]), (False, None, False))
PORTAL["ask_callsign"] = True

# captive DNS: hw_smoke asks port 53; the test asks the same question of the test port
_orig_dq = hw.dns_query
def dq(name, server, timeout=3):
    import struct, random
    q = struct.pack(">HHHHHH", random.randint(1, 0xFFFF), 0x0100, 1, 0, 0, 0)
    for part in name.split("."): q += bytes([len(part)]) + part.encode()
    q += b"\x00" + struct.pack(">HH", 1, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(timeout); s.sendto(q, (server, dport)); ans, _ = s.recvfrom(512); s.close()
    return hw._dns_parse(q, ans)
check("captive DNS answers the fox for any name", dq("captive.apple.com", "127.0.0.1"), "192.168.4.1")
check("captive DNS answers the fox for connectivitycheck", dq("connectivitycheck.gstatic.com", "127.0.0.1"), "192.168.4.1")
check("a non-answer parses to None", hw._dns_parse(b"\x12\x34" + b"\x00" * 10, b"\x12\x34\x81\x83" + b"\x00" * 8), None)

# finds.csv read back
csv = nc.FINDS_HEADER + "8248580b63c5,checkpoint,0,41250,W1ABC,DA:11:22:33:44:55\n8248580b63c5,checkpoint,2,318900,W1XYZ,3E:7A:00:12:9B:C4\n"
rows = hw.finds_rows(csv, "w1xyz")
check("finds_rows: the row for the callsign", [r["ms_since_boot"] for r in rows], ["318900"])
check("finds_rows: columns named", rows[0]["client_mac"], "3E:7A:00:12:9B:C4")
check("finds_rows: empty file", hw.finds_rows("", "W1XYZ"), [])

# the banner with a quoted name
b = hw.parse_banner('x\nFOX template=checkpoint/1.0.0 foxlib=1.10.12 board=esp32s3 uid=1 cfg=ok radio=ok id=set freq=none net=wifi-ap name="W1ABC FOX DE W1ABC" mac=F2:B0:00:00:00:C0 clock=unset mem=120000\n')
check("banner: quoted name is one value", b["name"], "W1ABC FOX DE W1ABC")
check("banner: the field after it still parses", (b["mac"], b["mem"]), ("F2:B0:00:00:00:C0", "120000"))
check("banner: unquoted name", hw.parse_banner("FOX net=wifi-ap name=FOX mac=1")["name"], "FOX")

http.close(); dns.close()
print("%d check(s) failed" % fails if fails else "hostclient: all checks passed")
sys.exit(1 if fails else 0)
