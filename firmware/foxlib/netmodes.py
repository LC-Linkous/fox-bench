# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netmodes.py -- mode rotation (the `stealth.modes` list, phase H of docs/network-fox-payloads-plan.md):
# the fox is an access point on one wake, a probing client on the next, a BLE beacon on the third. One radio object per
# kind is built at setup; before_up (first in the hook list, so every other feature sees the cycle's kind) swaps
# fox.radio. The kind's own settings come from the fox's `net` section where they apply (name, MAC, power) and from
# NET_FILL for what that section does not have (a BLE fox needs an iBeacon UUID to be an access point's name twin).
from . import netradio, netstealth

KINDS = ("wifi-ap", "wifi-probe", "ble")

NET_FILL = {
    "wifi-ap": {"psk": "", "channel": 6, "hidden": False, "max_clients": 2, "tx_power_dbm": 13, "channels": []},
    "wifi-probe": {"tx_power_dbm": 13, "probe_ssids": [], "probe_ssid_s": 0},
    "ble": {"uuid": "F0B0F0B0-0000-4000-8000-0000000000A0", "major": 0, "minor": 0, "signal_power_dbm": -59,
            "adv_min": 200, "adv_max": 400, "tx_power_dbm": 0},
}


def kind_cfg(net, kind):
    """A net section for `kind`, from this fox's own: same name on the air, same MAC, the rest filled in."""
    base = net.get("ssid") if net["kind"] != "ble" else net.get("name")
    out = dict(NET_FILL[kind])
    out["kind"] = kind
    out["mac"] = net.get("mac")
    if kind == "ble":
        out["name"] = base or "fox"
        if net["kind"] == "ble":
            for k in ("uuid", "major", "minor", "signal_power_dbm", "adv_min", "adv_max", "tx_power_dbm"):
                out[k] = net[k]
    else:
        out["ssid"] = base or "fox"
        if net["kind"] != "ble":
            out["tx_power_dbm"] = net["tx_power_dbm"]
        if kind == "wifi-ap" and net["kind"] == "wifi-ap":
            for k in ("psk", "channel", "hidden", "max_clients", "channels"):
                out[k] = net[k]
        if kind == "wifi-probe" and net["kind"] == "wifi-probe":
            for k in ("probe_ssids", "probe_ssid_s"):
                out[k] = net[k]
    return out


class Modes:
    def __init__(self, fox):
        self.fox = fox
        st = fox.cfg["stealth"]
        self.modes = list(st["modes"])
        self.random = bool(st.get("modes_random"))
        self.radios = {fox.radio.kind: fox.radio}
        self.kind = fox.radio.kind

    def setup(self):
        ok = []
        for kind in self.modes:
            if kind in self.radios:
                ok.append(kind)
                continue
            try:
                r = netradio.make(kind_cfg(self.fox.cfg["net"], kind), self.fox.name)
                if r.setup():
                    self.radios[kind] = r
                    ok.append(kind)
                else:
                    self.fox.log("modes: %s not available (%s); skipped" % (kind, r.status))
            except Exception as e:
                self.fox.log("modes: %s failed (%s); skipped" % (kind, e.__class__.__name__))
        self.modes = ok
        if len(self.modes) < 2:
            self.fox.log("modes: fewer than two kinds work here; staying %s" % self.fox.radio.kind)
            return False
        self.fox.log("modes: %s, %s" % (" / ".join(self.modes), "at random" if self.random else "in turn"))
        return True

    def before_up(self, fox, cycle):
        if self.random:
            kind = self.modes[netstealth.Rng(cycle * 2749 + 29).below(len(self.modes))]
        else:
            kind = self.modes[cycle % len(self.modes)]
        if kind != fox.radio.kind:
            name = fox.radio.name
            fox.radio = self.radios[kind]
            fox.radio.name = name            # the name on the air follows the fox, whatever the kind
        self.kind = kind
        fox.log("mode this cycle %s" % kind)


def attach(fox):
    m = Modes(fox)
    if not m.setup():
        return None
    fox.hooks["before_up"].insert(0, m.before_up)       # first: the other features look at fox.radio.kind
    fox.modes = m
    return m
