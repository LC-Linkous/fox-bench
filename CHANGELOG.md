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

### Page 0.7.9 · foxlib 1.0.4 · foxlib-c 0.1.9

Regroup before kitsune hardware (the 2026-10-22 test and documentation
reviews). Code:

- **Merged-image offset.** `tools/build_kitsune.py` merged images padded
  from address 0, and the page wrote them at the chip's bootloader offset
  (0x1000 on the ATOM Lite, 0x2000 on the C5): every piece would have landed
  one offset too high on the first real board; only the C3 (0x0) was safe by
  coincidence. Now stated once: a merged image is a whole-flash image, built
  with `--target-offset 0x0`, written at 0x0, manifest `offset` 0x0;
  `check_catalog.py --manifest` enforces it, the simulated esptool records
  the write address and the tests read it. Build tools pinned (PlatformIO
  6.1.18, esptool 4.8.1) and recorded in the manifest;
  `build_kitsune.py --selftest`.
- `ReplLink.interrupt()` from raw mode sends Ctrl-B first instead of a 4.5 s
  Ctrl-C dance — every XIAO Bench action after a read paid it. Timeouts are
  injectable; the unit suite dropped from 49 s to 11 s.
- A refused deploy no longer leaves the button at "Writing…" (the blocker
  is checked before `busy`); the listen-only device swap is awaited.
- A simulated flash (test mode) says so in the log.

Documentation, from the same review:

- One sentence about kitsune everywhere it is described (README, About,
  Board tab, Deploy tab, descriptors, `adding-a-target.md`, DESIGN §10):
  the page flashes a merged image after the chip check, unverified on real
  kitsune hardware; hosts nothing today and nothing without agreement
  (`LICENSES.md` now says what would change and when).
- `adding-a-target.md`: a `compiled`-family section written from the
  lint's rules — hardware/target/defaults fields, and that a new compiled
  template is a code change (`vendor/kitsune.js` `TEMPLATES`).
- The contracts say what the code does: the band check is a confirmable
  warning (DESIGN §4, CONFIG `plan`, About → Honest limits); foxlib-c's
  10-minute hard keydown cap (CONFIG `limits`, the Deploy tab warns when the
  worst case exceeds it); the attenuator word is written on every reload and
  its format is unverified (firmware README, `picofox-hardware.md`,
  hardware log).
- `releasing.md` rewritten around what CI does: three ways to start a
  release, what to check, and "re-run the failed job, do not delete the
  tag".
- `project-audit-2026-10.md` has a status block (fixed / open by id);
  CHANGELOG gained the missing 0.7.0–0.7.4 section; DESIGN §1/§2 and the
  About tab (families, transports, tested, next) brought up to date.

Tests: the smoke now runs the page's real transports through a fake Web
Serial port (`tests/page/fake-serial.mjs`) — REPL connect and deploy, listen
only with banner-follow and the device swap across the PicoFox targets,
port drop, the 1200-baud touch (matched and wrong port), a hand-loaded UF2
with and without the version tag, and the UF2 copy onto a fake RPI-RP2 drive
and onto the fox's own drive. These paths had run only on the bench.

CI guards (each for a slip that happened): `tools/check_ci.py` parses the
workflow strictly and checks the job graph; `build_info.py` fails when the
UF2's `FOXLIBC-VERSION:` tag differs from `VERSION`; the page version-bump
lint counts `hardware/` and `boards/`; the fox-bench USB ids are compared with
`usb_descriptors.c`; the kitsune build tools are pinned.

### Page 0.7.8 · foxlib 1.0.4 · foxlib-c 0.1.9

The 2026-10-22 bench session on foxlib-c 0.1.9 (`docs/hardware-log.md`):
flash from the site, deploy while running, power cycle, eject/replug while
keyed, Explorer browsing, the target switch both ways — all clean. What it
turned up, fixed here:

- The vendor target on a drive that holds `board.json`/`fox.json` says the
  board is running fox-bench's firmware and that `settings.txt` there is a
  leftover (the mirror of the existing "still running the vendor firmware"
  line).
- Listen only survives a switch between the two PicoFox targets (same serial
  port; the device swaps, the port stays open), as the drive already did.
- The touch names the matched USB id briefly ("vendor firmware") instead of
  quoting the descriptor's note; "serial port dropped" also mentions a board
  switched off or unplugged.
- The PicoFox vendor target and its template are marked **stable**: on the
  air since 2026-10-21, every page path exercised on a rev 3 board.
- Known and left alone: `(player late on N samples)` after a long `status`
  reply — the console printing on core 0 delays one FM sample on core 1, a
  sub-millisecond glitch the counter reports honestly.

### Page 0.7.7 · foxlib 1.0.4 · foxlib-c 0.1.9

- 0.7.7: switching between the two PicoFox targets while the drive is open
  keeps it open and reads it as the other firmware's files (both live on the
  same USB drive) instead of disconnecting; a drive still holding the
  vendor's files says so once, without a contradictory "no fox.json" line;
  the `.crswap` note is given once per drive, and a Windows drive root is
  named by its label in every message. Smoke test with a fake drive.
### Page 0.7.6 · foxlib 1.0.4 · foxlib-c 0.1.9

- 0.7.6: a command typed into the console drawer was shown twice (logged by the
  drawer and again by the device); the touch names which of the board's USB
  ids the picked port matched.

A bench session that swapped the PicoFox between the vendor firmware and
fox-bench's, both ways, and loaded an old UF2 by hand.

- foxlib-c 0.1.9 carries `FOXLIBC-VERSION:<v>` in its image; the Board tab
  reads it out of a loaded UF2 and flags an image older than the site's
  build (an old download cannot pass for the current one). CMake re-runs
  when `VERSION` changes.
- The vendor firmware's USB ids are `239a:cafe` (the Arduino RP2040 core's
  generic TinyUSB ids), not `2e8a:000a`; the descriptor and the touch's
  port check are corrected.
- `*.crswap` leftovers on the drive (an editor's temporaries) are named on
  the console with a one-call removal; a `board.json` that disagrees with
  the banner is called stale and the banner wins.
- The console drawer waits for a quiet line before sending, so a command
  typed while the fox is still printing is not lost.

### Page 0.7.3 · foxlib 1.0.4 · foxlib-c 0.1.8

foxlib 1.0.4: `payload.images_file` must be a plain file name (no paths,
never `code.py` / `fox.json` / `defaults.json` / `boot.py` / `board.json`),
in step with the page and the C firmware. The page's 0.7.x and foxlib-c's
0.1.8 are described under their own headings in the commit history; see
`docs/kitsune-integration-plan.md` for the `compiled` family.

### Page 0.7.0–0.7.4 · foxlib 1.0.3 · foxlib-c 0.1.7–0.1.8

The fourth device family, **compiled**, for foxes whose configuration is
compiled into their firmware — RF Hackers Sanctuary's kitsune
(`docs/kitsune-integration-plan.md`; kitsune belongs to its authors,
https://github.com/rfhs/kitsune, nothing of it hosted here).

- Five kitsune targets (M5Stack ATOM Lite, AtomS3 Lite, StampS3, Arduino
  Nano ESP32, Seeed XIAO ESP32-C5 — descriptors from public documentation,
  `experimental` until a board is on the bench) and five templates: Wi-Fi
  access point, Wi-Fi client, BLE iBeacon, Bluetooth Classic, Zigbee
  coordinator, each with the challenge/key-phrase fields their build reads.
- The page's forms check the configuration with kitsune's own constraints
  (`js/model/vendor/kitsune.js`: channels per band and region, MAC shape,
  power steps, intervals) and **export the conference header** their
  PlatformIO build compiles in; an exported header imports back into the
  form; a random locally-administered MAC per fox; a cycle preview.
- **Firmware card** for the compiled family: a merged image from the site's
  manifest (built in CI from a pinned kitsune commit, only when the
  repository variable `KITSUNE_BUILD` is set — nothing hosted without the
  project's agreement) or a local merged `.bin`; the flasher checks the
  port's chip against the target before erasing (`expectChip`); the fleet
  log keys the fox on its efuse MAC.
- **Catalog packs** (`?pack=<url>`): another repository's hardware, targets,
  templates and defaults loaded over this site's, data only, linted with
  `check_catalog.py --pack` — the mechanism for kitsune to publish its own
  descriptors later (`tests/fixtures/pack/`).
- 1200-baud touch: the picked port's USB ids are checked against the
  hardware descriptor; "port gone"/"still there" verdicts.
- foxlib-c 0.1.8: `correction_ppm` applied; `fox_drive_changed` by content;
  banner via `con_puts`; build date = commit author date.

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
