# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: puzzle-beacon -- a BLE fox whose advertisement is the puzzle: an iBeacon code, an Eddystone URL,
# telemetry, a name that changes each cycle (the payload section). Same runner as ble-beacon; the section does the rest.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY; see firmware/LICENSE.

from foxlib.netfox import NetFox

fox = NetFox("fox.json", defaults="defaults.json", version="1.0.0")
for tx in fox.cycles():
    tx.beacon()
