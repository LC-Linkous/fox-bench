# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netradio.py -- the SoC's own radios as fox "transmitters": a Wi-Fi access point, a Wi-Fi station that probes
# for a network, a BLE iBeacon advertiser. Selected by net.kind. Each has up() / down() / status / scan(), and that is
# all the runner and the bench need. CircuitPython's wifi and _bleio modules; the simulator mocks both.
#
# What the firmware cannot do, said in status rather than silently ignored: a hidden SSID (CircuitPython's start_ap
# has no hidden flag -> status "ok(hidden_unsupported)"), a BLE radio on a board without one ("noble").
#
# The MAC address, as CircuitPython's ports take it (ports/espressif/common-hal/wifi/Radio.c, _bleio/Adapter.c):
#   Wi-Fi  mac_address_ap / mac_address raise "Interface must be started" unless that interface's mode is on, and the
#          new address is used from the interface's next start. So: radio disabled, mode on (start_ap / start_station
#          configure it without sending anything), address set, radio enabled. Nothing goes out under the old address.
#   BLE    _bleio.Address takes the bytes little-endian (last octet of the written form first), and a static random
#          address must have its two top bits set: they are set here, and note() says so when that changed the MAC.
# mac() reads the address back from the radio; a set that did not take is in mac_error and said by the runner.

NRF_POWER_DBM = (-40, -20, -16, -12, -8, -4, 0, 2, 3, 4, 5, 6, 7, 8)     # what the nRF52840 SoftDevice accepts


def _mac_bytes(s):
    return bytes(int(p, 16) for p in s.split(":"))


class Base:
    kind = "base"

    def __init__(self, cfg, name):
        self.cfg = cfg          # the net section
        self.name = name        # SSID / BLE name on the air (callsign or the configured one)
        self.status = "skipped"
        self.up_count = 0
        self.is_up = False
        self.mac_error = None   # why the configured MAC is not the one on the air (an exception name), once known
        self.notes = []         # said once by the runner: what this radio did differently from the config

    def set_mac(self, mac):
        """A new MAC from the next up() on (stealth rotation, the shell game)."""
        self.cfg["mac"] = mac.upper().replace("-", ":")
        self.mac_error = None
        return True

    def wanted_mac(self):
        """The address this radio should be on the air with (None: whatever the chip has)."""
        m = self.cfg.get("mac")
        return m.upper() if m else None

    def take_notes(self):
        out, self.notes = self.notes, []
        return out

    def setup(self):
        return True

    def up(self):
        self.up_count += 1
        self.is_up = True

    def down(self):
        self.is_up = False

    def scan(self):
        return []

    def deinit(self):
        if self.is_up:
            self.down()


class WifiAp(Base):
    kind = "wifi-ap"

    def setup(self):
        try:
            import wifi
        except ImportError:
            self.status = "nowifi"
            return False
        self.wifi = wifi
        try:
            wifi.radio.enabled = True
            _wifi_power(wifi, self.cfg)
            self.status = "ok(hidden_unsupported)" if self.cfg.get("hidden") else "ok"
            return True
        except Exception as e:
            self.status = "wifi(%s)" % e.__class__.__name__
            return False

    def _start(self):
        c = self.cfg
        kw = {"channel": c["channel"], "max_connections": c["max_clients"]}
        if c["psk"]:
            self.wifi.radio.start_ap(self.name, c["psk"], **kw)
        else:
            self.wifi.radio.start_ap(self.name, "", authmode=[self.wifi.AuthMode.OPEN], **kw)

    def up(self):
        Base.up(self)
        r = self.wifi.radio
        want = self.cfg.get("mac")
        if want and not self.mac_error and self.mac() != want.upper():
            try:
                r.enabled = False               # stopped: start_ap below only configures, nothing is sent
                self._start()
                r.mac_address_ap = _mac_bytes(want)
            except Exception as e:
                self.mac_error = e.__class__.__name__
            r.enabled = True                    # the access point starts here, under the new address
            _wifi_power(self.wifi, self.cfg)    # enabling resets the power to the build's default
        self._start()

    def down(self):
        if not self.is_up:
            return
        Base.down(self)
        try:
            self.wifi.radio.stop_ap()
        except Exception:
            pass

    def scan(self):
        """Nearby networks, strongest first: the bench's 'rssi' for a Wi-Fi fox."""
        out = []
        try:
            for n in self.wifi.radio.start_scanning_networks():
                out.append((n.rssi, n.ssid, n.channel))
            self.wifi.radio.stop_scanning_networks()
        except Exception:
            pass
        out.sort(reverse=True)
        return out[:8]

    def mac(self):
        try:
            return ":".join("%02X" % b for b in self.wifi.radio.mac_address_ap)
        except Exception:
            return "?"


class WifiProbe(Base):
    """A station that keeps trying to join the configured SSID: probe requests carry the SSID and the spoofed MAC,
    which is what a hunter's sniffer sees. It never connects to anything real (the PSK is nonsense on purpose)."""
    kind = "wifi-probe"

    def setup(self):
        try:
            import wifi
        except ImportError:
            self.status = "nowifi"
            return False
        self.wifi = wifi
        try:
            wifi.radio.enabled = True
            _wifi_power(wifi, self.cfg)
            self.status = "ok"
            return True
        except Exception as e:
            self.status = "wifi(%s)" % e.__class__.__name__
            return False

    def up(self):
        Base.up(self)
        r = self.wifi.radio
        want = self.cfg.get("mac")
        if want and not self.mac_error and self.mac() != want.upper():
            try:
                r.enabled = False               # stopped: the station mode is on but nothing is sent
                r.start_station()
                r.mac_address = _mac_bytes(want)
            except Exception as e:
                self.mac_error = e.__class__.__name__
            r.enabled = True
            _wifi_power(self.wifi, self.cfg)
        self.keep()

    def keep(self, seconds=2):
        """One round of probe requests: a join attempt that cannot succeed. CircuitPython's connect() scans for the
        network until its timeout and then stops, so a station that 'keeps looking' is this, again and again: the
        runner calls keep() for as long as the radio is up."""
        try:
            self.wifi.radio.connect(self.name, "fox-bench-probe-no-such-network", timeout=seconds)
        except Exception:
            pass        # ConnectionError is the expected outcome; the probes went out

    def down(self):
        if not self.is_up:
            return
        Base.down(self)
        try:
            self.wifi.radio.stop_station()
        except Exception:
            pass

    def scan(self):
        return WifiAp.scan(self)

    def mac(self):
        try:
            return ":".join("%02X" % b for b in self.wifi.radio.mac_address)
        except Exception:
            return "?"


class BleBeacon(Base):
    """iBeacon: a manufacturer-data advertisement (Apple 0x004C, type 0x02, length 0x15, UUID, major, minor, power).
    A checkpoint service (netcheckpoint) sets connectable and service_uuid: the advertisement becomes connectable and
    the scan response carries the 128-bit service UUID before the name (the name is then cut to 11 bytes)."""
    kind = "ble"
    connectable = False
    _mac_said = _power_said = _refused_said = None
    service_uuid = None     # netpayload may replace frame() per instance with a callable; restart() calls whichever is there

    def setup(self):
        try:
            import _bleio
        except ImportError:
            self.status = "noble"
            return False
        self._bleio = _bleio
        try:
            self.adapter = _bleio.adapter
            self.adapter.enabled = True
            self._apply_mac()
            try:
                self.adapter.name = self.name
            except Exception:
                pass
            self.status = "ok"
            return True
        except Exception as e:
            self.status = "ble(%s)" % e.__class__.__name__
            return False

    def _apply_mac(self):
        """The configured MAC as the adapter's static random address (not while advertising): the configured one with
        its two top bits set, as a static random address must have."""
        text = self.wanted_mac()
        if not text or self.mac_error:
            return
        want = self.cfg["mac"].upper()
        if text != want and self._mac_said != want:
            self._mac_said = want
            self.notes.append("a BLE address has its two top bits set: MAC %s is on the air as %s" % (want, text))
        if self.mac() == text:
            return
        try:
            le = bytes(reversed(_mac_bytes(text)))          # _bleio.Address: little-endian
            self.adapter.address = self._bleio.Address(le, self._bleio.Address.RANDOM_STATIC)
        except Exception as e:
            self.mac_error = e.__class__.__name__      # not every port lets the address be set; the beacon still works

    def wanted_mac(self):
        m = self.cfg.get("mac")
        if not m:
            return None
        b = _mac_bytes(m)
        return ":".join("%02X" % x for x in ([b[0] | 0xC0] + list(b[1:])))

    def frame(self):
        c = self.cfg
        uuid = bytes.fromhex(c["uuid"].replace("-", ""))
        body = bytes([0x4C, 0x00, 0x02, 0x15]) + uuid + c["major"].to_bytes(2, "big") + c["minor"].to_bytes(2, "big") + bytes([c["signal_power_dbm"] & 0xFF])
        return bytes([len(body) + 1, 0xFF]) + body          # one AD structure: length, type 0xFF (manufacturer data), payload

    def scan_response(self):
        if self.service_uuid:
            svc = bytes([17, 0x07]) + bytes(reversed(self.service_uuid))      # complete list of 128-bit service UUIDs, little-endian
            name = self.name.encode("utf-8")[:31 - len(svc) - 2]
            return svc + bytes([len(name) + 1, 0x09]) + name
        name = self.name.encode("utf-8")[:29]
        return bytes([len(name) + 1, 0x09]) + name           # complete local name in the scan response

    def up(self):
        Base.up(self)
        self.restart()

    def restart(self):
        """(Re)start advertising: after up(), after a central disconnected (a connection stops advertising), and to apply
        a new tx power (netvary). _bleio refuses start_advertising while already advertising, so stop first."""
        c = self.cfg
        try:
            if getattr(self.adapter, "advertising", False):
                self.adapter.stop_advertising()
        except Exception:
            pass
        self._apply_mac()
        kw = {"scan_response": self.scan_response(), "connectable": self.connectable, "interval": c["adv_min"] / 1000.0}
        dbm = c["tx_power_dbm"]
        try:
            self.adapter.start_advertising(self.frame(), tx_power=dbm, **kw)
            return
        except TypeError:
            self.adapter.start_advertising(self.frame(), **kw)
            return
        except Exception as e:
            first = e
        if _nordic():
            # the nRF SoftDevice takes only its own power steps and refuses the rest (the ESP32 takes any): the
            # nearest one, said once per value. Anything else that failed fails again here and is the caller's.
            near = min(NRF_POWER_DBM, key=lambda s: (abs(s - dbm), s))
            try:
                self.adapter.stop_advertising()
            except Exception:
                pass
            self.adapter.start_advertising(self.frame(), tx_power=near, **kw)
            if near != dbm and self._power_said != dbm:
                self._power_said = dbm
                self.notes.append("this chip has no %d dBm BLE step; advertising at %d dBm" % (dbm, near))
            return
        # The ESP32 stack refused to start (XIAO ESP32S3, CircuitPython 10.3.2: "Unknown system firmware error: 530",
        # HCI invalid parameters, after a scan from the same adapter). Two tries: stopped and started again, then the
        # adapter off and on with the address and name put back. The one that worked is said once; neither = the
        # caller's error, with the first refusal's text.
        for step in ("restart", "reset"):
            try:
                self.adapter.stop_advertising()
            except Exception:
                pass
            if step == "reset":
                try:
                    self.adapter.enabled = False
                    self.adapter.enabled = True
                except Exception:
                    pass
                self.mac_error = None
                self._apply_mac()
                try:
                    self.adapter.name = self.name
                except Exception:
                    pass
            try:
                self.adapter.start_advertising(self.frame(), tx_power=dbm, **kw)
            except Exception as e:
                last = e
                continue
            if self._refused_said != step:
                self._refused_said = step
                self.notes.append("BLE start refused (%s: %s); %s" % (first.__class__.__name__, str(first)[:50],
                                                                      "started on the second try" if step == "restart" else "adapter reset and started"))
            return
        raise first

    def down(self):
        if not self.is_up:
            return
        Base.down(self)
        try:
            self.adapter.stop_advertising()
        except Exception:
            pass

    def scan(self):
        out = []
        try:
            from .netsense import adv_name, addr_text
            seen = {}                         # a device's advertisement and its scan response are two entries
            for e in self.adapter.start_scan(timeout=2, minimum_rssi=-100):
                mac, name = addr_text(e.address), adv_name(e)   # _bleio entries carry bytes, not complete_name
                old = seen.get(mac)
                if old is None:
                    seen[mac] = [e.rssi, mac, name]
                else:
                    old[0] = max(old[0], e.rssi)
                    old[2] = old[2] or name
            self.adapter.stop_scan()
            out = [(v[0], (v[2] + " " + v[1]) if v[2] else v[1]) for v in seen.values()]     # "-60 HUNT-RED C0:…"
        except Exception:
            pass
        out.sort(reverse=True)
        return out[:8]

    def mac(self):
        try:
            return ":".join("%02X" % x for x in reversed(self.adapter.address.address_bytes))
        except Exception:
            return "?"


def _nordic():
    """The nRF52840 port: its SoftDevice is the one with fixed power steps (sys.platform 'nRF52840')."""
    try:
        import sys
        return "nrf" in sys.platform.lower()
    except Exception:
        return False


def _wifi_power(wifi, cfg):
    try:
        wifi.radio.tx_power = float(cfg["tx_power_dbm"])
    except Exception:
        pass


DRIVERS = {WifiAp.kind: WifiAp, WifiProbe.kind: WifiProbe, BleBeacon.kind: BleBeacon}


def make(net_cfg, name):
    cls = DRIVERS.get(net_cfg.get("kind"))
    if cls is None:
        raise ValueError("net.kind %r has no driver" % net_cfg.get("kind"))
    return cls(net_cfg, name)
