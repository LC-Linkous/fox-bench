# Adding a board, a firmware, or a clone

What the Board tab lists is a **target**: a piece of hardware running a
particular firmware. Three files can be involved; usually you touch one.

| you have | add | notes |
|---|---|---|
| a new physical design | `hardware/<id>.json` + a row in `hardware/index.json`, then a target for each firmware it can run | pins with `pwm`/`adc`/`uart_*` flags, default `roles`, `flash`, `usb` IDs, `battery` |
| a clone of an existing design (same wiring, different name or USB IDs) | a target `boards/<id>.json` pointing at the existing `hardware` — override `name`, add `usb` if different | nothing else; templates' defaults resolve by target id, so copy or symlink the defaults file if the family is `foxlib` |
| another firmware for existing hardware | a target with its own `family` and `firmware` block, and a template that lists that family | the tag in the target `name` is how users tell firmwares apart: "(vendor firmware)", "(fox-bench firmware)" |
| a new radio module | `modules/<id>.json` + index row | `family` picks the foxlib driver (`dmo` = NiceRF AT dialect) |

Families:

- `foxlib` — CircuitPython on the board, fox-bench's foxlib and a template deployed over the REPL. Needs `hardware.circuitpython` and a full role map.
- `drive` — the vendor's firmware, left alone; the page writes the files it reads. Needs a `vendor` model in `js/model/vendor/<vendor>.js`, `module_fixed`, and `drive` (label, files, note); the hardware entry carries the firmware's quirk `notes`.
- `foxlib-c` — fox-bench's native firmware (`firmware/foxlib-c/`, a UF2 built by CI into the site). Needs `module_fixed`, `drive` (label + files), `firmware.image` (the site path CI writes) and `firmware.version_file`; `status: "planned"` until the firmware source directory exists. Templates that list `foxlib-c` need `defaults/<target>.json` with no `pins` and the `si5351fm` radio keys (CONFIG.md); the lint runs them through the C validator (`make -C firmware/foxlib-c/tests`).

Run `python3 tools/check_catalog.py` — it checks every reference, every
field the page reads, and that each template has defaults for every
target of the families it lists. Then add the target to
`docs/first-hardware-session.md`'s run and to `boards_tested` once it has
been on the air.
