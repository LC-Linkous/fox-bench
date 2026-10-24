# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: wifi-probe -- a Wi-Fi station that keeps looking for a network that is not there: its probe
# requests carry the SSID and the spoofed MAC, which is what a hunter's sniffer sees. Never joins anything.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY; see firmware/LICENSE.

from foxlib.netfox import NetFox

fox = NetFox("fox.json", defaults="defaults.json", version="1.0.0")
for tx in fox.cycles():
    tx.beacon()
