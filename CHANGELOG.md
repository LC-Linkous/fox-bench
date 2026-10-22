# Changelog

Three version lines live in this repository and move independently:

| component | version file | shown as |
|---|---|---|
| the page | `js/main.js` `VERSION` | About tab |
| foxlib (CircuitPython firmware library) | `firmware/foxlib/VERSION` | banner `foxlib=<v>` |
| foxlib-c (C firmware for the PicoFox) | `firmware/foxlib-c/VERSION` | banner `foxlib=c-<v>`, `board.json` |

Template versions are in each `firmware/templates/<id>/template.json`. A git
tag `vX.Y.Z` names a page version; the release attaches the foxlib-c UF2 and
its fingerprint (`foxbench-picofox.json`) that CI built from that commit.

## Unreleased

### Page 0.6.2 · foxlib 1.0.3 · foxlib-c 0.1.7

The October 2026 audit (`docs/project-audit-2026-10.md`) and what followed it.

**foxlib-c 0.1.5–0.1.7 — stability**
- Off the air on every exit path: `reboot`, `bootsel` and the 1200-baud touch
  unkey first; `si5351_init` disables the outputs before anything else, even
  when the chip does not answer; the I²C bus is cleared before init; AEN is
  driven high before the pin becomes an output.
- Flash writes park the FM loop between two samples so the lockout never
  lands inside an I²C transfer; a write that times out anyway is followed by
  a controller abort (or bus clear) and a full PLL-register rewrite
  (`status`: `i2c_errors=`). Verified on hardware: 112 host writes during a
  keyed cycle, zero errors.
- Wall-clock keydown guard on core 0; timeouts on core 1 with the amplifier
  forced off and `radio=core1_dead`; 8 s hardware watchdog.
- `freq` on the console applies the same 20 kHz band-edge margin as the cycle.
- `board.json` on the drive (`board`, `uid`, `foxlib`) so deploys over the
  drive carry the chip UID.
- File buffer 24 KB; `cfg=default(too_large)` when a `fox.json` exceeds it or
  the parser's value pool, with the reason on the console.
- `status` shows `uptime=` and `reset=` (power_on / software / watchdog
  timeout); builds are stamped with the commit date, so one commit is one
  binary.

**Page 0.6.1–0.6.2**
- A deploy goes out only over its family's transport: switching board family
  while connected disconnects first; the Deploy tab refuses a REPL with a
  PicoFox selected, a drive with the XIAO selected, the console, or a
  listen-only session.
- The C firmware's limits (songs, notes, frequencies, ranges, JSON values,
  file size) are page checks for the PicoFox; `fox.json` is written compactly.
- The saved working form is restored through the validator; a stale shape
  can no longer wedge the page.
- Firmware/page compatibility badge for the PicoFox; a feature the fox's
  firmware predates blocks the deploy and names the version it needs.
- Fleet tab **Audit**: the connected fox compared with its last deploy in the
  fleet log (by UID, or by board when the deploy was logged without one).
- `id.telemetry` `"chg"`: the word CHG in the ID while the charger is active
  (PicoFox with fox-bench firmware).
- Firmware images are checked before a copy: UF2 structure, RP2040 family
  id, and sha256/size against the site's fingerprint (ours) or the
  descriptor's pin (the vendor's, fetched at a fixed commit).
- Listen only follows the banner's board and swaps the device to that
  family's protocol.

**Process**
- One CI workflow; the Pages deploy needs every test job and ships the UF2
  they built. Pinned Arm toolchain (xPack GCC 15.2.1-1.1 by sha256) and
  pico-sdk by commit; `tools/build_info.py` fingerprint and a 220 KB RAM budget.
- `tools/check_catalog.py --since` covers foxlib-c and page version bumps,
  README's version, vendor-image pins, `boards_tested` for stable targets;
  `tools/check_docs.py` keeps file names in the documents honest.

## 0.6.0 — 2026-10-19 · foxlib 1.0.2 · foxlib-c 0.1.0

- Third device family, **foxlib-c**: fox-bench's own C firmware for the AI6YM
  PicoFox (Pico SDK, GPL-3.0-or-later) — the `fox.json` contract and the same
  templates as the CircuitPython foxes, FM at 8 kHz with pre-emphasis, Morse,
  songs, QRSS, popcorn/resurrection schedules, SSTV (Robot 36 grayscale), a
  serial console with the banner, log and bench commands, flashed as a UF2
  from the Board tab and swappable with the vendor firmware both ways
  (1200-baud touch; BOOTSEL is inside the case). On the air on a rev 3 board
  from 2026-10-21 (0.1.1–0.1.4: a cross-core hang fixed, charger wording,
  `board.json`).
- Catalog split into hardware descriptors and targets (hardware + firmware +
  family); `picofox-vendor` and `picofox-foxlibc` are two targets on one board.
- Licensing map (`LICENSES.md`): page GPL-2.0-only, firmware
  GPL-3.0-or-later, flasher Apache-2.0.

## 0.5 — 2026-10-18/19 · foxlib 1.0.2

- Second device family, **drive**: the AI6YM PicoFox with its vendor
  firmware, configured by the files on its USB drive (settings, rendered
  audio and Morse-ID WAVs, byte-sum marker); pre-emphasis and a bright tone
  shape after the first on-air test; the vendor's firmware fetched from its
  GitHub, never hosted.
- Rail reorganised: Board (picker, connect, flash), Radio & pins, Behavior.

## 0.4 — 2026-10-18 · foxlib 1.0.2

- Flash CircuitPython from the page (esptool-js, Board tab) and in batches
  (Fleet tab); the flasher carved out as its own Apache-2.0 component.
- Bench: a new Fox releases the previous one (foxlib 1.0.2).

## 0.3.0 — 2026-10-18 · foxlib 1.0.1

- Test harness: page smoke test in headless Chromium, REPL protocol tests
  against a fake board, the simulator booting exported deploy sets, catalog
  lint, Python↔JS schema parity (foxlib 1.0.1), hardware smoke script with a
  pty-simulated board, diagnostics dump, first-hardware-session checklist.
- Listen only; serialised board operations; CRC32 write verification.

## 0.2.0 — 2026-10-17 · foxlib 1.0.0

- About tab, song libraries (`songs/`, load from file, export), spectrum
  estimate under the preview, whole-rotation preview, zip export of the
  deploy set; firmware milestone alongside: foxlib, radio drivers by family,
  simulator with 92 scenarios, Python/JS parity, CI.

## 0.1.0 — 2026-10-17

- Page milestone from the first port: tabs, REPL device layer, demo board,
  validation, previews, timeline, profiles.
