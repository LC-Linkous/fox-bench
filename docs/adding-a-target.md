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
- `compiled` — a fox whose configuration is compiled into its firmware (RFHS kitsune). Needs `vendor` (`js/model/vendor/<vendor>.js`), hardware with `radios` and an esptool `flash` block, `firmware.kind: "compiled"` with `source` linking to the project. Templates list `radios`; defaults exist only for targets whose hardware has them. The page prepares and exports the configuration and flashes a merged image from the Board tab (unverified on real kitsune hardware); there is no deploy transport (per-fox configuration is Phase 2). See "Adding a `compiled` target" below — a new compiled *template* is also a code change.
- `foxlib-c` — fox-bench's native firmware (`firmware/foxlib-c/`, a UF2 built by CI into the site). Needs `module_fixed`, `drive` (label + files), `firmware.image` (the site path CI writes) and `firmware.version_file`; `status: "planned"` until the firmware source directory exists. Templates that list `foxlib-c` need `defaults/<target>.json` with no `pins` and the `si5351fm` radio keys (CONFIG.md); the lint runs them through the C validator (`make -C firmware/foxlib-c/tests`).

Run `python3 tools/check_catalog.py` — it checks every reference, every
field the page reads, and that each template has defaults for every
target of the families it lists. Then run `docs/first-hardware-session.md`
against the board, record the session in `docs/hardware-log.md`, and add
the target to the templates' `boards_tested` once it has been on the air.
Status convention: `planned` (listed, greyed out) → `experimental` (works
in the page, no row in the hardware log) → `stable` (the lint requires a
template to list it in `boards_tested`).

## Adding a `compiled` target (kitsune-style firmware)

The source of truth for the field list is `tools/check_catalog.py` (search
for `fam == "compiled"` and `"compiled" in fams`); this section is that list
in words, plus what the page reads beyond the lint. Three files and, for a
new *template*, one code change.

**`hardware/<id>.json`** (+ a row in `hardware/index.json`), everything
below is checked or displayed:

- `id`, `name`, `mcu`, `has_usb_drive: false`, `pins` (may be `[]`),
  `roles` (`{}`), `battery` — required by the lint for every hardware file.
- `radios`: a non-empty list from `wifi24 wifi5 ble btclassic ieee802154`.
  Decides which compiled templates apply to this board (a template needs
  every radio it lists), and the Board tab shows it.
- `flash`: `method: "esptool"`, `chip` (esptool's name: `esp32`, `esp32s3`,
  `esp32c5`, …; the flasher refuses a port whose chip differs),
  `offset` (the chip's **bootloader** offset — informational for this
  family: a merged image is written at `0x0`), `flash_mb`,
  `bootloader_instructions` (shown on the firmware card), `note`.
- `usb`: `[{vid, pid, when}]` of the USB-serial bridge or native USB.
- Optional, displayed when present: `design.by` / `design.source`,
  `led.note`, `serial.notes` (e.g. "serial not working on this board per
  kitsune"), `notes` (list of strings).

**`boards/<id>-kitsune.json`** (the target):

- `id`, `name` (ending in "(kitsune firmware)" — the tag is how users tell
  firmwares apart), `hardware`, `family: "compiled"`, `vendor: "kitsune"`
  (there must be a `js/model/vendor/kitsune.js`), `status`.
- `firmware`: `kind: "compiled"`, `project`, `source` (an `http…` link to
  the project — attribution, shown on the firmware card), `note` (rendered
  on the Board tab: keep it to the agreed sentence about what the page does
  and does not do), `stage`, `manifest` (optional; path of the image
  manifest; the default is the manifest.json CI writes under the kitsune images directory, present only on a site whose CI built one), and `envs`: one entry
  per PlatformIO environment the project builds for this board —
  `{env, project, template, tier, mode?}` with `tier` in
  `easy|medium|hard` and `template` a listed template id.
  `tools/build_kitsune.py` builds exactly these envs in CI; the firmware
  card offers each as a button when a manifest is hosted.

**A clone** (same hardware, another name or USB ids): only a new target
file pointing at the existing `hardware`, **plus** a defaults file for every
compiled template that applies (next paragraph) — the lint requires them
per target, not per hardware. `tests/fixtures/pack/` is a worked clone.

**Defaults**: for every compiled template whose radios the hardware has,
`firmware/templates/<template>/defaults/<target-id>.json` with
`template`, `board`, `schedule.kind: "duty"`, a `challenge` section and a
`fleet` section (copy the ATOM Lite's and change `board`). The lint fails
on a missing one and on one for a board without the template's radio.

**A new compiled template** is a code change as well as a descriptor:

1. `firmware/templates/<id>/template.json` with `families: ["compiled"]`,
   `vendor: "kitsune"`, `radios: [...]`, `foxlib: ">=0.0.0"`, `sections`
   (the page's forms: `challenge`, the radio section such as `wifi.ap`,
   `schedule.duty`), `status`, `version`, `boards_tested`; a row in
   `firmware/index.json`; defaults for every target with the radio.
2. `js/model/vendor/kitsune.js` `TEMPLATES`: an entry
   `{ section, mode, radio, project }` — without it the Behavior tab, the
   checks, the cycle preview and the header exporter do nothing for the
   template. The validator for the section's fields lives in the same file;
   `tests/unit/kitsune.test.mjs` sweeps every template's defaults through
   it, so a new section needs a case there.
3. `CONFIG.md` "compiled family": the section's fields and limits (that
   table is the contract the header exporter follows).

Then `python3 tools/check_catalog.py`, `cd tests && npm run unit`, and
export a header from the page and build it in a kitsune checkout
(`pio run -e <env>`) before claiming the template works. A board's first
flash from the page goes in `docs/hardware-log.md` like any other session;
until one exists the target stays `experimental`.

## From another repository: a catalog pack

A board, target or template that belongs to another project can live in
that project's repository as a *catalog pack* and be loaded by this page
with `?pack=<url to the directory>` (or saved on the Board tab). Lay it out
like this repository with a `pack.json` naming the entries; a pack can also
supply defaults for its targets for the built-in templates. Lint it with
`python3 tools/check_catalog.py --pack <dir>`. `tests/fixtures/pack/README.md`
shows the layout. Packs carry data only — a target may use one of this
page's vendor models, but the page never loads code from a pack.
