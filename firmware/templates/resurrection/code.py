# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: resurrection -- Resurrection (plays dead).
# Behaviour only; everything shared lives in foxlib. Configuration is
# fox.json merged over defaults.json (see CONFIG.md). Lineage: the
# transmit sequence descends from earlier GPL-3.0 fox firmware.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY.

import foxlib

fox = foxlib.Fox("fox.json", defaults="defaults.json", version="1.1.0")
for tx in fox.cycles():          # dead-phase wakes never reach this body
    tx.morse(tx.id_message)
    if not (tx.low_battery and fox.cfg["payload"]["skip_on_low_battery"]):
        tx.play(fox.playlist.next_events())
