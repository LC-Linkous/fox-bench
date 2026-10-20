# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: morse-qrss -- QRSS (slow Morse for waterfall copy).
# Behaviour only; everything shared lives in foxlib. Configuration is
# fox.json merged over defaults.json (see CONFIG.md). Lineage: the
# transmit sequence descends from earlier GPL-3.0 fox firmware.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY.

import foxlib

fox = foxlib.Fox("fox.json", defaults="defaults.json", version="1.1.0")
p = fox.cfg["payload"]
for tx in fox.cycles():
    tx.morse(p["message"] or tx.id_message, dit_s=p["dit_s"])
