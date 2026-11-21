# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netsense.py -- the fox that listens (the `sense` section, phase E/E' of docs/network-fox-payloads-plan.md).
#
#   tags      BLE scan before each wake: every advertiser whose name starts with `match` and is at least `rssi_min`
#             strong is logged (near.csv kind=tag) -- hunter tags handed out at registration, HUNT-<team>
#   relay     Wi-Fi scan before each wake for the network `wait_for`: then=up stays silent until it has been heard once
#             (a chain hunt), then=down is silent for any wake it is heard (hot/cold, inverted), then=toggle flips between
#             on the air and silent each time it is heard again after a wake without it
#   honeypot  wifi-ap: every station that joins (wifi.radio.stations_ap) -> near.csv kind=join; with `probes` and a
#             build that has wifi.Monitor, a short listen before each wake on the AP's channel logs probe requests for
#             our own names -> kind=probe, and counts the rest in one line. No Monitor: said once, joins still logged
#   crowd     the same BLE scan counts distinct advertisers above rssi_min; more than `max` and the fox is silent for
#             quiet_s (LED 'armed'), so a swarm following one team gets nothing
#
# near.csv: fox_uid,template,cycle,ms_since_boot,kind,rssi,name -- the finds.csv columns with kind/rssi/name, up to
# MAX_NEAR lines; the Bench tab's "Who is near" reads it. A tag or a prober is written at most once per NEAR_EVERY_S
# (every sighting is still on the console); each join is written. A fox with nothing to scan for does no scan.
# No addresses: the devices a fox hears in a park are not its to record (foxlib 1.11). An address is used in RAM only,
# to rate-limit the rows and to count joins within a wake; it is never written and never printed. `name` is always one
# of ours: the tag name the organisers gave out, the SSID a station probed for (only our own are logged), the fox's.
import time
from .netcheckpoint import FindLog, text_of

MAX_NEAR = 500
NEAR_EVERY_S = 300                       # a tag or prober seen again within this is on the console, not written again
NEAR_MEMORY = 200                        # (kind, mac) pairs remembered for that; forgotten all at once past this
NEAR_FILE = "near.csv"
NEAR_HEADER = "fox_uid,template,cycle,ms_since_boot,kind,rssi,name\n"
PROBE_REQ = (0, 4)                       # 802.11 (type, subtype)


def adv_name(entry):
    """The complete (0x09) or shortened (0x08) local name in a _bleio ScanEntry's advertisement or scan response."""
    for attr in ("advertisement_bytes",):
        data = getattr(entry, attr, None)
        if not data:
            continue
        i = 0
        while i + 1 < len(data):
            ln = data[i]
            if ln == 0 or i + 1 + ln > len(data):
                break
            if data[i + 1] in (0x08, 0x09):
                return text_of(data[i + 2:i + 1 + ln])      # a name with stray bytes must not lose the whole scan
            i += 1 + ln
    return ""


def addr_text(a):
    try:
        b = a.address_bytes
        return ":".join("%02X" % x for x in reversed(b))
    except Exception:
        return str(a)


def parse_probe_request(raw):
    """(mac, ssid) for a probe-request frame, else None (the same parser as tools/sniffer)."""
    if len(raw) < 24:
        return None
    fc = raw[0]
    if ((fc >> 2) & 3, (fc >> 4) & 0xF) != PROBE_REQ:
        return None
    mac = ":".join("%02X" % b for b in raw[10:16])
    ssid = ""
    i = 24
    while i + 2 <= len(raw):
        tag, ln = raw[i], raw[i + 1]
        if i + 2 + ln > len(raw):
            break
        if tag == 0:
            try:
                ssid = bytes(raw[i + 2:i + 2 + ln]).decode("utf-8")
            except Exception:
                ssid = ""
            break
        i += 2 + ln
    return mac, ssid


class NearLog(FindLog):
    """near.csv: the finds log's append-only, capped, read-only-tolerant file, with near's columns."""

    def __init__(self, fox):
        FindLog.__init__(self, fox)
        self.recent = {}

    def _count(self):
        n = 0
        try:
            with open(NEAR_FILE) as f:
                for line in f:
                    if line.strip():
                        n += 1
            n = max(0, n - 1)
        except OSError:
            n = -1
        return n

    def add_near(self, cycle, kind, mac, rssi, name):
        # one line per (kind, mac) per NEAR_EVERY_S: a tag beside the fox for an hour would otherwise fill the file.
        # mac is the key of that RAM table and nothing else: the row does not carry it
        now = time.monotonic_ns() // 1000000000
        key = (kind, mac)
        last = self.recent.get(key)
        if last is not None and now - last < NEAR_EVERY_S and kind != "join":
            return False
        if len(self.recent) >= NEAR_MEMORY:
            self.recent = {}
        self.recent[key] = now
        if self.count is None:
            self.count = self._count()
        if self.count >= MAX_NEAR:
            if not self.said_ro:
                self.said_ro = True
                self.fox.log("near log: full (%d lines)" % MAX_NEAR)
            return False
        row = "%s,%s,%d,%d,%s,%s,%s\n" % (self.fox.uid, self.fox.cfg.get("template", "?"), cycle, time.monotonic_ns() // 1000000,
                                          kind, "" if rssi is None else rssi, name.replace(",", " "))
        try:
            with open(NEAR_FILE, "a") as f:
                if self.count < 0:
                    f.write(NEAR_HEADER)
                    self.count = 0
                f.write(row)
            self.count += 1
            return True
        except OSError as e:
            self.ram.append(row)
            if not self.said_ro:
                self.said_ro = True
                self.fox.log("near log: cannot write %s (%s); keeping it in RAM" % (NEAR_FILE, e.__class__.__name__))
            return False


class Sense:
    def __init__(self, fox):
        self.fox = fox
        self.cfg = fox.cfg["sense"]
        self.near = NearLog(fox)
        self.heard_once = False            # relay then=up: latched
        self.relay_on = True               # relay then=toggle
        self.relay_was_heard = False
        self.quiet_until = 0               # crowd: monotonic_ns
        self.joined = {}                   # honeypot: mac -> True while associated
        self.said_no_monitor = False
        self.ours = None

    # -- the scans
    def _ble_scan(self):
        """[(mac, rssi, name)] from one BLE scan of slot_ms, or None when the radio cannot scan."""
        try:
            import _bleio
            ad = _bleio.adapter
            if not ad.enabled:
                ad.enabled = True
            # an active scan reports a device twice: its advertisement, then its scan response as another entry --
            # and the name is often only in the second (a fox-bench beacon's is). One row per MAC: the strongest
            # reading, and the name from whichever entry has one.
            seen = {}
            for e in ad.start_scan(timeout=self.cfg["slot_ms"] / 1000.0, minimum_rssi=-100):
                mac = addr_text(e.address)
                name = adv_name(e)
                old = seen.get(mac)
                if old is None:
                    seen[mac] = [mac, e.rssi, name]
                else:
                    if e.rssi > old[1]:
                        old[1] = e.rssi
                    if name and not old[2]:
                        old[2] = name
            ad.stop_scan()
            return [tuple(v) for v in seen.values()]
        except Exception as e:
            self.fox.log("sense: BLE scan failed (%s)" % e.__class__.__name__)
            return None

    def _wifi_heard(self, ssid):
        try:
            import wifi
            r = wifi.radio
            if not r.enabled:
                r.enabled = True
            heard = None
            for n in r.start_scanning_networks():
                if n.ssid == ssid:
                    heard = n.rssi if heard is None else max(heard, n.rssi)
            r.stop_scanning_networks()
            return heard
        except Exception as e:
            self.fox.log("sense: Wi-Fi scan failed (%s)" % e.__class__.__name__)
            return None

    def _our_names(self):
        c = self.fox.cfg
        names = {self.fox.name, c["net"].get("ssid"), c["net"].get("name")}
        for n in c["net"].get("probe_ssids") or []:
            names.add(n)
        pl, st = c.get("payload") or {}, c.get("stealth") or {}
        for n in (pl.get("names") or []):
            names.add(n)
        for n in (st.get("decoys") or []):
            names.add(n)
        for i in ((st.get("shell_game") or {}).get("identities") or []):
            names.add(i["name"])
        names.discard(None)
        names.discard("")
        return names

    def _probe_listen(self, cycle):
        hp = self.cfg["honeypot"]
        try:
            import wifi
        except ImportError:
            return
        if not hasattr(wifi, "Monitor"):
            if not self.said_no_monitor:
                self.said_no_monitor = True
                self.fox.log("honeypot: this build has no wifi.Monitor; probe requests are not logged (joins still are)")
            return
        if self.ours is None:
            self.ours = self._our_names()
        ch = self.fox.radio.cfg.get("channel") or 6
        mine = others = 0
        mon = None
        try:
            mon = wifi.Monitor(channel=ch)
            end = time.monotonic_ns() + hp["window_s"] * 1000000000
            seen = set()
            while time.monotonic_ns() < end:
                p = mon.packet()
                if not p:
                    time.sleep(0.01)
                    continue
                r = parse_probe_request(p[wifi.Packet.RAW])
                if r is None:
                    continue
                mac, ssid = r
                if ssid in self.ours:
                    if (mac, ssid) not in seen:
                        seen.add((mac, ssid))
                        mine += 1
                        if hp["log"]:
                            self.near.add_near(cycle, "probe", mac, p[wifi.Packet.RSSI], ssid)
                else:
                    others += 1
        except Exception as e:
            self.fox.log("honeypot: monitor failed (%s)" % e.__class__.__name__)
        finally:
            if mon is not None:
                try:
                    mon.deinit()
                except Exception:
                    pass
        self.fox.log("honeypot: %d probe(s) for our names, %d other probe request(s) on ch %d" % (mine, others, ch))

    # -- hooks
    def before_up(self, fox, cycle):
        c = self.cfg
        if time.monotonic_ns() < self.quiet_until:
            fox.skip = "crowd: quiet for %d s more" % ((self.quiet_until - time.monotonic_ns()) // 1000000000)
            return
        # one BLE scan for tags and crowd
        if c["tags"]["enabled"] or c["crowd"]["enabled"]:
            seen = self._ble_scan()
            if seen is not None:
                if c["tags"]["enabled"]:
                    t = c["tags"]
                    tags = [s for s in seen if s[2].startswith(t["match"]) and s[1] >= t["rssi_min"]]
                    for mac, rssi, name in tags:
                        fox.log("sense: tag %s %d dBm" % (name, rssi))
                        if t["log"]:
                            self.near.add_near(cycle, "tag", mac, rssi, name)
                if c["crowd"]["enabled"]:
                    cr = c["crowd"]
                    n = len([s for s in seen if s[1] >= cr["rssi_min"]])
                    if n > cr["max"]:
                        self.quiet_until = time.monotonic_ns() + cr["quiet_s"] * 1000000000
                        fox.log("crowd: %d advertisers above %d dBm (max %d); quiet for %d s" % (n, cr["rssi_min"], cr["max"], cr["quiet_s"]))
                        fox.skip = "crowd"
                        return
        # the relay: is the other fox on the air?
        if c["relay"]["enabled"]:
            r = c["relay"]
            rssi = self._wifi_heard(r["wait_for"])
            heard = rssi is not None
            if heard:
                fox.log("relay: heard %s at %d dBm" % (_q(r["wait_for"]), rssi))
            if r["then"] == "up":
                if heard and not self.heard_once:
                    self.heard_once = True
                    fox.log("relay: on the air from now on")
                if not self.heard_once:
                    fox.skip = "relay: waiting for %s" % _q(r["wait_for"])
                    return
            elif r["then"] == "down":
                if heard:
                    fox.skip = "relay: %s is on the air" % _q(r["wait_for"])
                    return
            else:   # toggle
                if heard and not self.relay_was_heard:
                    self.relay_on = not self.relay_on
                    fox.log("relay: toggled %s" % ("on" if self.relay_on else "off"))
                self.relay_was_heard = heard
                if not self.relay_on:
                    fox.skip = "relay: toggled off"
                    return
        # the honeypot's listen comes last: only a fox that is going on the air listens for who is looking for it
        if c["honeypot"]["enabled"] and c["honeypot"]["probes"] and fox.radio.kind in ("wifi-ap", "wifi-probe"):
            self._probe_listen(cycle)

    def while_up(self, fox, cycle):
        hp = self.cfg["honeypot"]
        if not hp["enabled"] or fox.radio.kind != "wifi-ap":
            return
        try:
            stations = fox.radio.wifi.radio.stations_ap
        except Exception:
            return
        now = {}
        for st in stations or ():
            try:
                mac = ":".join("%02X" % b for b in st.mac_address)
            except Exception:
                continue
            now[mac] = getattr(st, "rssi", None)
            if mac not in self.joined:
                fox.log("honeypot: a station joined (%s dBm)" % now[mac])
                if hp["log"]:
                    self.near.add_near(cycle, "join", mac, now[mac], fox.radio.name)
        self.joined = now

    def after_down(self, fox, cycle):
        self.joined = {}


def attach(fox):
    s = Sense(fox)
    c = s.cfg
    fox.hooks["before_up"].append(s.before_up)
    if c["honeypot"]["enabled"]:
        fox.hooks["while_up"].append(s.while_up)
        fox.hooks["after_down"].append(s.after_down)
    fox.sense = s
    return s


def _q(s):
    return '"' + s + '"' if " " in s else s
