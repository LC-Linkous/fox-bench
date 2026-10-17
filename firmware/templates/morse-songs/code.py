# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: morse-songs -- Morse ID, then one song per cycle.
#
# Behaviour only; everything shared lives in foxlib. Configuration is
# fox.json merged over defaults.json (the template's known-good config
# for this board, copied alongside at deploy time). See CONFIG.md.
#
# Lineage: the transmit sequence of this runner descends from earlier
# GPL-3.0 fox firmware (rot13labs fox via the 2024 CircuitPython port,
# building on YAFB by KN4CK). Distributed under GPL-3.0-or-later,
# WITHOUT ANY WARRANTY; see firmware/LICENSE.

import foxlib

fox = foxlib.Fox("fox.json", defaults="defaults.json", version="1.0.0")
for tx in fox.cycles():
    tx.morse(tx.id_message)
    if not (tx.low_battery and fox.cfg["payload"]["skip_on_low_battery"]):
        tx.play(fox.playlist.next_events())
