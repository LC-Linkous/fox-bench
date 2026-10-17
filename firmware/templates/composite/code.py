# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench template: composite -- EXPERIMENTAL.
# Payload, schedule and frequency plan all come from fox.json; foxlib
# already implements each axis, so this runner only dispatches on
# payload.kind. Schedule and plan are handled entirely inside
# fox.cycles(). Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY.

import foxlib

fox = foxlib.Fox("fox.json", defaults="defaults.json")
p = fox.cfg["payload"]

for tx in fox.cycles():
    if p["kind"] == "none":
        tx.morse(p["message"] or tx.id_message, dit_s=p["dit_s"])
        continue
    tx.morse(tx.id_message)
    if tx.low_battery and p["skip_on_low_battery"]:
        continue
    if p["kind"] == "songs":
        tx.play(fox.playlist.next_events())
    elif p["kind"] == "sstv":
        tx.play(fox.images.next_events())
