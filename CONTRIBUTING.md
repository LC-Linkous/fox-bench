# Contributing

fox-bench is one person's workbench that other people are welcome to use
and extend. This page is the short version of how changes get in; the
long versions are the Adding a target section below (new hardware, firmware or
templates), `tests/README.md` (what the tests cover) and
the Releasing section below (tags).

## Reading the code

Where to start depends on what you came to do. Each path is three to five
files, in reading order; the first function named is the one to open.

**A fox, end to end (what the firmware does).** `firmware/foxlib/__init__.py`
(`Fox.cycles()`: load `fox.json` over `defaults.json`, print the banner,
key and sleep) for an FM fox; `firmware/foxlib/netfox.py` (`NetFox.cycles()`
and `Tx.beacon()`) for a network fox. `firmware/foxlib/guard.py` is the
watchdog both run under; `firmware/safemode.py` what happens after a crash.
The config contract they read is `CONFIG.md`.

**Add a template.** `firmware/templates/wifi-beacon/` as the model
(`template.json` = what the form offers, `defaults/<target>.json` = the
numbers for a board, `code.py` = three lines); then the Adding a target
section below; then `tools/check_catalog.py` (run it: it names what is
missing) and `firmware/sim/scenarios.json` (one scenario per claim the
template makes). `tools/foxlib_deps.py --write` records which foxlib
modules the template imports. `DESIGN.md` §5 is the long version.

**Add a board.** `hardware/seeed_xiao_esp32s3.json` (the physical board:
pins, radios, CircuitPython ids) and `boards/esp32s3.json` (a target: a
board plus a family plus a status), then the Adding a target section and
`DESIGN.md` §4. A board's first bench session is `docs/bench-runbook.md`.

**Understand a Deploy (what the page writes to a board).** `js/ui/deploy.js`
(`plan()`: what differs between the board and the catalog; `deploy()`: the
writes, in order), then `js/device/repl-device.js` (`ReplDevice`: the REPL
snippets, from `PROTOCOL.md`) and `js/device/repl-link.js` (`ReplLink`: raw
mode, one exchange at a time). `docs/build-and-flash.md` is the diagram of
the whole pipeline. `js/main.js` holds the one `app` object every tab
reads and `app.changed()` that re-renders them.

**How the page validates a `fox.json`.** `js/model/schema.js` and
`js/model/netschema.js`, which mirror `firmware/foxlib/cfg.py` and
`netcfg.py` rule for rule; `firmware/sim/schema_parity.py` is the CI step
that holds them together, `firmware/sim/schema_corpus.json` its cases.

**A bench session, or why a bench finding is a test.** `tools/hw_smoke.py`
(the docstring, then `class Run` — its docstring lists the phases in order —
and the `Repl` class); a run with `--record`
becomes a file in `tests/fixtures/bench/`, which `firmware/sim/pty_board.py
--replay` plays back against the same script in CI (`tools/replay_check.py`).
`tools/session_close.py` turns a run into a hardware-log row;
`tools/bench_queue.py` says what the log still lacks.

**The simulator.** `firmware/sim/run.py` (`check()`: one scenario against
the real foxlib under `firmware/sim/mocks.py`'s CircuitPython); the
PicoFox's C firmware runs the same scenarios through
`firmware/foxlib-c/tests/`.

Conventions worth knowing before reading: a comment that ends in
`(page 0.18.20)` or `(foxlib 1.11)` names the version a behaviour landed
in, and `CHANGELOG.md` has the why; `W1ABC`, `W1XYZ` and `N0CALL` are
placeholders, never real callsigns; nothing with a device address is
written to a fox's flash.

## Branches

- `main` is what the live page is built from, and what the hardware log
  vouches for. Every push to `main` runs CI and, when every job is green,
  deploys the page and the firmware it built.
- Work that is not yet verified on hardware is on `main` but gated: its
  target is `status: experimental`, which keeps it off the Board picker
  until "Show experimental targets" is ticked, and nothing about it is
  called stable in the docs until `docs/hardware-log.md` has a row.
  Branches run the tests but do not deploy.
- A change comes in as a pull request against the branch it belongs to,
  with the local sequence below green first.

## Before you push

Run the list in `tests/README.md` ("Everything CI runs") from the
repository root; it is the same set of commands CI runs, kept in one place.
`tools/check_catalog.py --since origin/main` is the version-bump lint: give
it the base of what you are about to push, not `HEAD`. It only sees
committed changes, so run it last — after every change is committed.
Run the whole list, including `make -C firmware/foxlib-c/tests check`: a
shared scenario added for CircuitPython is replayed by the C runner too.

## When to bump what

Three version lines move independently (the table at the top of
`CHANGELOG.md`). The lint refuses a push that changes one without bumping
it:

| you changed | bump |
|---|---|
| anything the browser loads — `js/`, `css/`, `index.html`, `flasher/`, `hardware/`, `boards/` | `const VERSION` in `js/main.js` |
| `firmware/foxlib/` | `firmware/foxlib/VERSION` |
| a template's `code.py` or `defaults/` | that template's `version` in its `template.json` |
| `firmware/foxlib-c/core` or `picofox`, or `firmware/templates/morse-songs/defaults/picofox-foxlibc.json` (compiled into the UF2) | `firmware/foxlib-c/VERSION` |
| only docs, tests or tools | nothing |

Add a line under `## Unreleased` in `CHANGELOG.md` for anything a user of
the page or the firmware would notice.

## When to add a hardware-log row

Whenever a board was on the bench for a change: a row in
`docs/hardware-log.md` with the date, board and revision, firmware version
**and the build's commit or sha256**, page version, what was checked, how
(instrument, distance), and the result. That row is the evidence behind a
target's `status: stable` and a template's `boards_tested`; the lint ties
the two together. A target stays `experimental` — and off the Board picker
unless "Show experimental targets" is ticked — until it has one.

## What not to put in the repository

- The vendor PicoFox firmware or anything from its hardware files
  (CC BY-NC-SA 4.0); the page fetches the firmware from the vendor's GitHub
  at a pinned commit and never hosts it.
- An event's real fox configuration — SSIDs, keys, MACs, frequencies. The
  bench values are labelled as such (`FOXBENCH …`, `F2:B0:…`); keep it
  that way.
- Secrets of any kind. CI has none; the deploy uses GitHub's own token.

## Licences

Page and tools GPL-2.0-only, `firmware/` GPL-3.0-or-later, `flasher/`
Apache-2.0 (`LICENSES.md`). Every source file carries an
`SPDX-License-Identifier` line; a new file gets the licence of the
directory it lives in. By contributing you agree your change is under that
licence.

## Reporting

Bugs: the issue template asks for the diagnostics block from the Board tab
(copies the catalog versions, the device state and the last console
lines). Hardware results: the hardware-report template, or a row in the
hardware log in a PR. Security: `SECURITY.md`.

## Adding a target

What the Board tab lists is a **target**: a piece of hardware running a
particular firmware. Three files can be involved; usually you touch one.

| you have | add | notes |
|---|---|---|
| a new physical design | `hardware/<id>.json` + a row in `hardware/index.json`, then a target for each firmware it can run | pins with `pwm`/`adc`/`uart_*` flags, default `roles`, `flash`, `usb` IDs, `battery` |
| a clone of an existing design (same wiring, different name or USB IDs) | a target `boards/<id>.json` pointing at the existing `hardware` — override `name`, add `usb` if different | nothing else; templates' defaults resolve by target id, so copy or symlink the defaults file if the family is `foxlib` |
| another firmware for existing hardware | a target with its own `family` and `firmware` block, and a template that lists that family | the tag in the target `name` is how users tell firmwares apart: "(vendor firmware)", "(fox-bench firmware)" |
| a new radio module | `modules/<id>.json` + index row | `family` picks the foxlib driver (`dmo` = NiceRF AT dialect) |

Families:

- `foxlib` — CircuitPython on the board, fox-bench's foxlib and a template deployed over the REPL. Two kinds of target, which the picker groups apart:
  - **board + module** (picker group "CircuitPython board + radio module"): one physical board wired to a radio module, e.g. `seeed_xiao_esp32c3` (XIAO ESP32-C3 + SA868). Needs `hardware.circuitpython` and a full role map (`roles`: every FM role, `null` when not wired). Runs the FM templates. A new combination (a XIAO ESP32S3 + SA868, say) is a new target with its own id and name, even when the bare board already exists as a variant below.
  - **chip** (picker group "CircuitPython board"): a bare board whose own Wi-Fi / BLE is the transmitter, listed by chip — `boards/esp32s3.json` with `"variants": ["seeed_xiao_esp32s3", "waveshare_esp32s3_nano"]` (hardware ids; `hardware` names the default). Runs the network templates (`contract: net`), whose defaults are per chip (`firmware/templates/wifi-beacon/defaults/esp32c5.json` and so on; `variant` = the default hardware, `pins` = its LED / battery roles). Each variant's hardware needs `circuitpython` (`board_id`, `download`; `board_ids` for every id it may report; `shared_build: true` when two variants of one chip run the same build — the two C5s run the DevKitC-1 build, and the page then keeps whichever is selected), `radios` (one set per chip), `pins` (names as the CircuitPython build spells them, aliases allowed) and the two network roles in `roles` — or in `net` when the hardware also carries FM roles (the XIAO C3: `net: {led: null, …}`, no LED on the bare board). The Radio tab's wiring card shows a Board dropdown when a chip has more than one variant, and the pin table always. To add a board of an existing chip: its `hardware/<id>.json` + index row, its id in the chip target's `variants`, nothing else. To add a chip: the target file, defaults for the four network templates, and the smoke's expected group list.
- `drive` — the vendor's firmware, left alone; the page writes the files it reads. Needs a `vendor` model in `js/model/vendor/<vendor>.js`, `module_fixed`, and `drive` (label, files, note); the hardware entry carries the firmware's quirk `notes`.
- `foxlib-c` — fox-bench's native firmware (`firmware/foxlib-c/`, a UF2 built by CI into the site). Needs `module_fixed`, `drive` (label + files), `firmware.image` (the site path CI writes) and `firmware.version_file`; `status: "planned"` until the firmware source directory exists. Templates that list `foxlib-c` need `defaults/<target>.json` with no `pins` and the `si5351fm` radio keys (CONFIG.md); the lint runs them through the C validator (`make -C firmware/foxlib-c/tests`).

Run `python3 tools/check_catalog.py` — it checks every reference, every
field the page reads, and that each template has defaults for every
target of the families it lists. Then run `docs/bench-runbook.md` (first session)
against the board, record the session in `docs/hardware-log.md`, and add
the target to the templates' `boards_tested` once it has been on the air.
Status convention: `planned` (listed, greyed out) → `experimental` (works
in the page, no row in the hardware log; listed only when "Show
experimental targets" is ticked on the Board tab) → `stable` (the lint
requires a template to list it in `boards_tested`).

### From another repository: a catalog pack

A board, target or template that belongs to another project can live in
that project's repository as a *catalog pack* and be loaded by this page
with `?pack=<url to the directory>` (or saved on the Board tab). Lay it out
like this repository with a `pack.json` naming the entries; a pack can also
supply defaults for its targets for the built-in templates. Lint it with
`python3 tools/check_catalog.py --pack <dir>`. `tests/fixtures/pack/README.md`
shows the layout. Packs carry data only — a target may use one of this
page's vendor models, but the page never loads code from a pack.

## Releasing

> **Cache.** GitHub Pages serves `css/*.css` and `js/main.js` with long
> lifetimes under unchanging names; the deploy and release jobs run
> `tools/stamp_assets.py` on the staged site so those links carry
> `?v=<VERSION>` — a new version is a new URL to the browser, and the
> ES-module imports behind `main.js` follow it. So **bump `VERSION` in
> `js/main.js` on any change the user should get on next load**; a deploy
> at an unchanged version can still be served next to a cached `main.js`
> for a few minutes. The checkout's `index.html` keeps plain links.
>
> **Pinned tooling.** Three things are pinned on purpose and bumped by a
> deliberate commit, never by drift: the Arm toolchain and Pico SDK (by hash
> and commit, `ci.yml`), esptool-js (`flasher/vendor/esptool-js/VERSION`,
> `flasher/README.md`), and Playwright (`tests/package.json`, 1.65.0 since
> 2026-11-07, with Node 20 — the smoke's fake Web Serial port relies on
> Chromium's `navigator.serial` shape; test a bump with `npm run unit` and
> `npm run smoke` before committing it, and check `npm view playwright
> engines` still allows the Node pinned in `ci.yml`).

A release is a git tag `vX.Y.Z` where `X.Y.Z` is the page version in
`js/main.js`. The `release` job in `.github/workflows/ci.yml` creates a
GitHub Release titled `fox-bench vX.Y.Z` carrying:

- `foxbench-picofox-<fw>.uf2` — the foxlib-c firmware built from that commit
  with the pinned toolchain (the same bytes the site serves; `<fw>` is
  `firmware/foxlib-c/VERSION`);
- `foxbench-picofox-<fw>.json` — its fingerprint (commit, SDK, GCC, sha256,
  size, RAM, the `FOXLIBC-VERSION:` tag read out of the image);
- `fox-bench-site-vX.Y.Z.zip` — the page as deployed (serve it over http to
  run offline or to go back to this version);
- `SHA256SUMS` over the three, and notes taken from `CHANGELOG.md`
  (`tools/release_notes.py`: the `## X.Y.Z` section if there is one, else
  `## Unreleased`, prefixed with the three version numbers).

### Prerequisites

1. Hardware has run the firmware this tag ships, and `docs/hardware-log.md`
   has the row: Deploy while keyed → `status` shows `i2c_errors=0 core1=ok`;
   `bootsel` while keyed goes silent before RPI-RP2 appears; power cycles
   show `reset=power_on`, never `watchdog`.
2. The live site's Board tab says **matches this site** for a fox flashed
   with the site's UF2 (the fingerprint chain works end to end), and a
   pre-current UF2 loaded by hand is flagged as older.
3. `CHANGELOG.md`: rename `## Unreleased` to
   `## X.Y.Z — date · foxlib a.b.c · foxlib-c d.e.f` and start a new empty
   `## Unreleased` above it. A changelog-only commit needs no version bump.
4. The push that bumped `js/main.js` VERSION was green: CI ran
   `check_catalog.py --since <base>` on it (the version-bump lint), so
   README's `v0.x`, the page version and the firmware version agree. Locally
   the same check is `python3 tools/check_catalog.py --since origin/main`.

### What CI does on a tag

A tag push is a push: the three test jobs (`page`, `sim`, `foxlib-c`) run
again from scratch on that commit — the UF2 the release carries is the one
*this* run built, not the one the site deployed earlier (same commit date,
same toolchain → same bytes; the fingerprint's sha256 is the proof). The
`deploy` job does not run for a tag (it is `main` only). The `release` job
needs the three test jobs, checks that `vX.Y.Z` equals the page version,
stages the files, cuts the notes, and then **either creates the release or
fills one that already exists** for that tag.

### Three ways to start one

1. **Tag from the command line** (the usual way):
   ```
   git tag -a v0.7.9 -m "fox-bench 0.7.9"
   git push origin v0.7.9
   ```
2. **GitHub → Releases → "Draft a new release"**, choosing a new tag name:
   GitHub creates the tag, the tag push runs CI, and the job fills the
   release you drafted (title, notes and assets are overwritten with CI's).
3. **Actions → CI → "Run workflow"** on `main` with the **release** box
   ticked: the job tags `main` at the page version itself and releases. It
   refuses if that tag already exists at another commit ("bump VERSION in
   js/main.js first").

### What to check on the release page

- Title `fox-bench vX.Y.Z`; notes begin with `page X.Y.Z · foxlib … ·
  foxlib-c …`.
- Four assets: `foxbench-picofox-<fw>.uf2`, `.json`, `fox-bench-site-vX.Y.Z.zip`,
  `SHA256SUMS`.
- The `.json`'s `sha256` equals the sha the live site's Board tab shows for
  its hosted image (same commit → same bytes). If it does not, the site is
  serving an older deploy: check the `deploy` job of the commit.

### If the release job fails

- **Re-run it.** Actions → the tag's run → "Re-run failed jobs". The tag and
  the commit are unchanged, so the job builds the same bytes; if a release
  already exists for the tag (route 2, or a previous partial run), the job
  fills it rather than failing on "already exists". Do **not** delete the
  tag to retry a failed job.
- **No run at all** after a push means the workflow file did not parse
  (GitHub shows "Invalid workflow file" under Actions, and nothing else). A
  duplicate key is the usual cause; `python3 tools/check_ci.py` catches it
  locally and in the `sim` job once the file parses at all.
- **"tag vX.Y.Z but js/main.js VERSION is …"**: the tag names the wrong
  commit or the version was not bumped. Delete the tag (`git push origin
  :refs/tags/vX.Y.Z` and locally), fix, and tag again — this is the one case
  where a tag moves, and it is fine because nothing was released under it.
- A release that went out and is wrong is not moved: fix forward and tag the
  next number. Firmware fingerprints name commits; a moved tag would name
  two.

### After

Tell the Behavior tab's `boards_tested` and `docs/hardware-log.md` what
this release was verified on, in the next commit, not by editing the
release. Then start the next `## Unreleased`.

## Open items carried from the October 2026 audit

The audit itself (three independent reads at page 0.6.0) is in the
history (`git log -- CONTRIBUTING.md`); everything it found
was fixed or recorded by 0.9.3 except:

- F10 — the PicoFox attenuator's word format and dB per step need a
  meter: `tools/atten_sweep.py` is the tool, the numbers go into
  `docs/picofox.md`.
- F11 — I²C at 1 MHz without readback: zero errors across every session
  so far; left as is.
- The FatFs/MSC path of foxlib-c has no host test.
- `LICENSES.md` calls the flasher import an aggregation; a deliberate
  decision (relicense the page GPL-3.0-or-later, or write down why
  aggregation) is still owed.
