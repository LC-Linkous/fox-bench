# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: ble-beacon -- an iBeacon advertisement (UUID / major / minor / power) with a name, on a duty cycle.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY; see firmware/LICENSE.

from foxlib.netfox import NetFox

fox = NetFox("fox.json", defaults="defaults.json", version="1.0.0")
for tx in fox.cycles():
    tx.beacon()
