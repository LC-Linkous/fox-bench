# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/netvary.py -- what a network fox varies from wake to wake (phase G of docs/network-fox-payloads-plan.md):
#
#   net.channels            wifi-ap:    the channel drawn per wake from the list ([] = net.channel, fixed)
#   net.probe_ssids         wifi-probe: the network sought, one per wake from the list, or a new one every
#                                       net.probe_ssid_s seconds inside the wake ([] = net.ssid only)
#   stealth.variable_power  any kind:   tx power drawn between min_dbm and max_dbm from the kind's power steps,
#                                       per wake or re-drawn every slot_s inside the wake (null = net.tx_power_dbm)
#
# Draws seed from the chip uid and the cycle (netstealth.Rng), so a fleet does not move in lockstep and the simulator
# is deterministic. Each draw is logged once: "channel this cycle 6", "tx power this cycle 8 dBm", "probing for X".
import time
from . import netstealth
from .netcfg import WIFI_POWER_DBM, BLE_POWER_DBM


class Vary:
    def __init__(self, fox):
        self.fox = fox
        self.net = fox.cfg["net"]
        st = fox.cfg.get("stealth") or {}
        self.power = st.get("variable_power") if st.get("enabled") else None
        self.channels = list(self.net.get("channels") or [])
        self.ssids = list(self.net.get("probe_ssids") or [])
        self.ssid_s = int(self.net.get("probe_ssid_s") or 0)
        self.ssid_i = 0
        self.next_ssid = 0
        self.next_power = 0
        self.slot = 0
        self.base_name = fox.radio.name

    # -- hooks
    def before_up(self, fox, cycle):
        r = fox.radio
        if self.channels and r.kind == "wifi-ap":
            r.cfg["channel"] = self.channels[netstealth.Rng(cycle * 7877 + 11).below(len(self.channels))]
            fox.log("channel this cycle %d" % r.cfg["channel"])
        if self.ssids and r.kind == "wifi-probe":
            if self.ssid_s > 0:
                self.ssid_i = 0
                self.next_ssid = time.monotonic() + self.ssid_s
            else:
                self.ssid_i = netstealth.Rng(cycle * 6151 + 17).below(len(self.ssids))
            r.name = self.ssids[self.ssid_i]
            fox.log("probing for %s" % _q(r.name))
        if self.power:
            self.slot = 0
            self._draw_power(cycle, r)
            if self.power["per"] == "slot":
                self.next_power = time.monotonic() + self.power["slot_s"]

    def while_up(self, fox, cycle):
        r = fox.radio
        now = time.monotonic()
        if self.ssids and r.kind == "wifi-probe" and self.ssid_s > 0 and now >= self.next_ssid:
            self.next_ssid = now + self.ssid_s
            self.ssid_i = (self.ssid_i + 1) % len(self.ssids)
            r.name = self.ssids[self.ssid_i]
            try:
                r.up()                      # another round of probe requests, for the next network
            except Exception as e:
                fox.log("probe for %s failed (%s)" % (_q(r.name), e.__class__.__name__))
            fox.log("probing for %s" % _q(r.name))
        if self.power and self.power["per"] == "slot" and now >= self.next_power:
            self.next_power = now + self.power["slot_s"]
            self.slot += 1
            self._draw_power(cycle, r, live=True)

    def after_down(self, fox, cycle):
        if self.ssids:
            fox.radio.name = self.base_name

    # -- the draw
    def _draw_power(self, cycle, r, live=False):
        steps = BLE_POWER_DBM if r.kind == "ble" else WIFI_POWER_DBM
        p = self.power
        choices = [s for s in steps if p["min_dbm"] <= s <= p["max_dbm"]] or [r.cfg["tx_power_dbm"]]
        dbm = choices[netstealth.Rng(cycle * 4099 + self.slot * 131 + 23).below(len(choices))]
        r.cfg["tx_power_dbm"] = dbm
        try:
            if r.kind == "ble":
                if live and r.is_up:
                    r.restart()             # advertising carries the power; a new start applies it
            else:
                r.wifi.radio.tx_power = float(dbm)
        except Exception as e:
            self.fox.log("tx power %s dBm not applied (%s)" % (dbm, e.__class__.__name__))
            return
        self.fox.log("tx power %s %s dBm" % ("now" if live else "this cycle", dbm))


def wanted(cfg):
    n = cfg["net"]
    st = cfg.get("stealth") or {}
    return bool(n.get("channels") or n.get("probe_ssids") or (st.get("enabled") and st.get("variable_power")))


def attach(fox):
    v = Vary(fox)
    fox.hooks["before_up"].append(v.before_up)
    fox.hooks["while_up"].append(v.while_up)
    fox.hooks["after_down"].append(v.after_down)
    fox.vary = v
    return v


def _q(s):
    return '"' + s + '"' if " " in s else s
