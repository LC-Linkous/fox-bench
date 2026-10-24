# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netradio.py -- the SoC's own radios as fox "transmitters": a Wi-Fi access point, a Wi-Fi station that probes
# for a network, a BLE iBeacon advertiser. Selected by net.kind. Each has up() / down() / status / scan(), and that is
# all the runner and the bench need. CircuitPython's wifi and _bleio modules; the simulator mocks both.
#
# What the firmware cannot do, said in status rather than silently ignored: a hidden SSID (CircuitPython's start_ap
# has no hidden flag -> status "ok(hidden_unsupported)"), a BLE radio on a board without one ("noble").
import time


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
            if self.cfg.get("mac"):
                wifi.radio.mac_address_ap = _mac_bytes(self.cfg["mac"])
            try:
                wifi.radio.tx_power = float(self.cfg["tx_power_dbm"])
            except Exception:
                pass
            self.status = "ok(hidden_unsupported)" if self.cfg.get("hidden") else "ok"
            return True
        except Exception as e:
            self.status = "wifi(%s)" % e.__class__.__name__
            return False

    def up(self):
        Base.up(self)
        c = self.cfg
        kw = {"channel": c["channel"], "max_connections": c["max_clients"]}
        if c["psk"]:
            self.wifi.radio.start_ap(self.name, c["psk"], **kw)
        else:
            self.wifi.radio.start_ap(self.name, "", authmode=[self.wifi.AuthMode.OPEN], **kw)

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
            if self.cfg.get("mac"):
                wifi.radio.mac_address = _mac_bytes(self.cfg["mac"])
            try:
                wifi.radio.tx_power = float(self.cfg["tx_power_dbm"])
            except Exception:
                pass
            self.status = "ok"
            return True
        except Exception as e:
            self.status = "wifi(%s)" % e.__class__.__name__
            return False

    def up(self):
        Base.up(self)
        try:
            self.wifi.radio.connect(self.name, "fox-bench-probe-no-such-network", timeout=2)
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
    """iBeacon: a manufacturer-data advertisement (Apple 0x004C, type 0x02, length 0x15, UUID, major, minor, power)."""
    kind = "ble"

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
            if self.cfg.get("mac"):
                try:
                    self.adapter.address = _bleio.Address(_mac_bytes(self.cfg["mac"]), _bleio.Address.RANDOM_STATIC)
                except Exception:
                    pass        # not every port lets the address be set; the beacon still works
            try:
                self.adapter.name = self.name
            except Exception:
                pass
            self.status = "ok"
            return True
        except Exception as e:
            self.status = "ble(%s)" % e.__class__.__name__
            return False

    def frame(self):
        c = self.cfg
        uuid = bytes.fromhex(c["uuid"].replace("-", ""))
        body = bytes([0x4C, 0x00, 0x02, 0x15]) + uuid + c["major"].to_bytes(2, "big") + c["minor"].to_bytes(2, "big") + bytes([c["signal_power_dbm"] & 0xFF])
        return bytes([len(body) + 1, 0xFF]) + body          # one AD structure: length, type 0xFF (manufacturer data), payload

    def up(self):
        Base.up(self)
        c = self.cfg
        name = self.name.encode("utf-8")[:29]
        scan_resp = bytes([len(name) + 1, 0x09]) + name       # complete local name in the scan response
        try:
            self.adapter.start_advertising(self.frame(), scan_response=scan_resp, connectable=False,
                                           interval=c["adv_min"] / 1000.0, tx_power=c["tx_power_dbm"])
        except TypeError:
            self.adapter.start_advertising(self.frame(), scan_response=scan_resp, connectable=False, interval=c["adv_min"] / 1000.0)

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
            for e in self.adapter.start_scan(timeout=2, minimum_rssi=-100):
                out.append((e.rssi, str(e.address), e.complete_name or ""))
            self.adapter.stop_scan()
        except Exception:
            pass
        out.sort(reverse=True)
        return out[:8]

    def mac(self):
        try:
            return str(self.adapter.address).split(" ")[0].upper()
        except Exception:
            return "?"


DRIVERS = {WifiAp.kind: WifiAp, WifiProbe.kind: WifiProbe, BleBeacon.kind: BleBeacon}


def make(net_cfg, name):
    cls = DRIVERS.get(net_cfg.get("kind"))
    if cls is None:
        raise ValueError("net.kind %r has no driver" % net_cfg.get("kind"))
    return cls(net_cfg, name)
