# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: checkpoint -- a Wi-Fi fox whose sign-in page is the checkpoint: a code to write down, a callsign
# box that feeds finds.csv on the fox (the checkpoint section). Same runner as wifi-beacon; the section does the rest.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY; see firmware/LICENSE.

from foxlib.netfox import NetFox

fox = NetFox("fox.json", defaults="defaults.json", version="1.0.1")
for tx in fox.cycles():
    tx.beacon()
