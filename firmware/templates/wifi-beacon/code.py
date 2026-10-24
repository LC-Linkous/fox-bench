# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: wifi-beacon -- a Wi-Fi access point that comes and goes on a duty cycle.
#
# The SoC's own radio; no pins, no audio. Configuration is fox.json merged over defaults.json (CONFIG.md, "network
# foxes"). The SSID is net.ssid, or the callsign when id.use_callsign_as_name is set; the BSSID is net.mac.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY; see firmware/LICENSE.

from foxlib.netfox import NetFox

fox = NetFox("fox.json", defaults="defaults.json", version="1.0.0")
for tx in fox.cycles():
    tx.beacon()
