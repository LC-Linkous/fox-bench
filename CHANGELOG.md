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

### Page 0.9.2 · foxlib 1.2.1 · foxlib-c 0.1.10

- Bench finding 2026-10-26: flashing a second board while the page was
  still connected to the first left the Flash button disabled, its reason
  only in a tooltip. With a REPL / console / listen session open the button
  now reads **Disconnect and flash** and does exactly that — closes the
  session (console line), then asks for the port to flash. Same on the
  Batch flashing card and the kitsune image card. A drive session is left
  alone (another path). Other reasons (no image, no Web Serial) are shown
  as a visible warning beside the button.

### Page 0.9.1 · foxlib 1.2.1 · foxlib-c 0.1.10

Two bench findings from 2026-10-25 (XIAO ESP32-C3 + SA868 after a PicoFox
session), both fixed:

- **A form carried from the PicoFox onto the XIAO kept the PicoFox's radio
  section** (`radio.family: si5351fm`), and the XIAO booted
  `cfg=fatal(hardware(ValueError: radio.family 'si5351fm' has no driver))`,
  silent. Switching targets across firmware families now resets module,
  radio, pins, battery and limits to the new board's defaults (plan, ID,
  payload, schedule and fleet notes carry), with a console line; and the
  page refuses to deploy a `radio.family` that is not the selected module's
  (blocking error on the Deploy tab).
- **`payload.images_file` always fell back to the default on the board**
  (`cfg: payload.images_file -> default`): the check was a regex with a
  counted repetition (`{0,31}`), which CircuitPython's `re` does not
  support, so it never matched. Written out as a plain check. foxlib 1.2.1.
- Console wording when a board runs a `code.py` that is not a fox-bench
  template: says so, and that Deploy replaces it.

### Page 0.9.0 · foxlib 1.2.0 · foxlib-c 0.1.10

**The board picker regrouped around what a fox is**, not its firmware
family, and the bare boards listed by chip:

- **CircuitPython board + radio module** — the combinations, config after
  selection (the XIAO ESP32-C3 + SA868, as before; it no longer offers the
  network templates).
- **Drive-configured fox** — both PicoFox lines, vendor firmware first,
  fox-bench firmware second (the "native firmware (UF2)" group is gone).
- **CircuitPython board** — bare boards whose own Wi-Fi / BLE is the
  transmitter, **by chip**: `esp32c3`, `esp32c6`, `esp32c5`, `esp32s3`,
  `nrf52840`. Each chip target lists its physical boards as **variants**
  (XIAO C3; XIAO C6; XIAO C5 + FireBeetle 2 C5; XIAO S3 + Waveshare
  S3-Nano; Nano 33 BLE / Rev2). The Radio tab's wiring card — same shape as
  the FM family's — shows a **Board** dropdown when a chip has more than
  one, and the two pins a network fox uses (`led`, `batt_sense`) with the
  variant's defaults, editable, with reset. The variant sets the
  CircuitPython build to flash; a connected board's reported id picks it,
  and two variants sharing one build (the two C5s run the DevKitC-1 build)
  keep whichever is selected, with a console line. New hardware: Seeed
  XIAO ESP32S3 (own build). The 0.8.x per-board targets fold into the chip
  targets (unreleased, so no migration).
- **Compiled-in configuration (kitsune)** — unchanged, by board. The
  FireBeetle 2 ESP32-C5 kitsune stand-in is removed: the XIAO ESP32C5 is on
  the bench and is the board kitsune builds for.
- `fox.json` (`net` contract): `board` is the chip target, new `variant`
  and `pins` (`led`, `batt_sense`; CONFIG.md); the firmware takes the LED
  from `pins.led` (null = no LED, as on the bare XIAO C3) and reports a
  name the board lacks as `partial(pins.led)`. foxlib 1.2.0. Simulator:
  LED edges checked per variant; per-chip defaults; `check_catalog`: chip
  targets, variants, one radio set per chip, shared builds only within a
  chip when both declare `shared_build`, net defaults' pins match the
  default variant. `tools/hw_smoke.py --board <chip> --variant <hardware>`.
- `docs/network-fox-bench.md`: the per-board bench list; hardware-log table
  of the seven boards and the build each runs; `docs/adding-a-target.md`
  on combos vs chips vs variants.

### Page 0.8.2 · foxlib 1.1.1 · foxlib-c 0.1.10

- Board picker: the module-less Wi-Fi / BLE boards (XIAO ESP32-C6,
  Waveshare ESP32-S3-Nano, FireBeetle 2 ESP32-C5, Nano 33 BLE) have their
  own group, **CircuitPython board (Wi-Fi / BLE fox, no module)**;
  **CircuitPython board + radio module** keeps the combined units. The
  split follows the hardware's role map (empty = no module), not a new
  descriptor field.

### Page 0.8.1 · foxlib 1.1.1 · foxlib-c 0.1.10

- **Listen only reconnects by itself.** When the port goes away during a
  listen-only session (deep sleep, `bootsel`, a reset, a power cycle) the
  page waits for the same device — Chrome keeps the grant — and listens
  again when it is back, without the port chooser; the status line says
  so, the top button becomes **Stop waiting**, and the wait gives up after
  10 minutes. A REPL or console session still reconnects by hand (the
  board lost that state). Smoke-tested through the fake Web Serial port
  (drop, replug, stop).
- **CircuitPython board ids checked** against circuitpython.org: the
  Waveshare ESP32-S3-Nano has no build of its own and runs as
  `arduino_nano_esp32s3`; the FireBeetle 2 ESP32-C5 runs as
  `espressif_esp32c5_devkitc_1_n8r8`; the Nano 33 BLE Rev2 reports
  `arduino_nano_33_ble_rev2`. `hardware.circuitpython.board_ids` lists what
  a target may report, the page maps a connected board or a banner back to
  its target (`app.targetForBoardId`; Board tab says "runs this build"),
  the flash card accepts an image for any listed id, and the firmware
  (foxlib 1.1.1: `cfg.py`, `netcfg.py`, JS twins unchanged on the parity
  corpus) accepts a `fox.json` naming the same target as the `defaults.json`
  deployed with it. The lint refuses two hardware entries claiming one id.
- Following a banner while the port drops no longer throws.

### Page 0.8.0 · foxlib 1.1.0 · foxlib-c 0.1.10

**Network foxes.** The CircuitPython firmware gains a second contract:
foxes whose transmitter is the SoC's own Wi-Fi or BLE, on boards with no
radio module. Three templates — `wifi-beacon` (an access point),
`wifi-probe` (a station probing for a network: the SSID and spoofed MAC in
its probe requests), `ble-beacon` (an iBeacon) — on a duty cycle, as the
same deploy over the REPL. Experimental until a phone has found one
(`docs/hardware-log.md`).

- `firmware/foxlib/netcfg.py` (validator), `netradio.py` (the radios),
  `netfox.py` (the runner: banner with `freq=none net= name= mac=`, duty
  cycle, `schedule.sleep` **off** = radio off with USB alive or **deep** =
  `alarm` deep sleep and reboot, bench `key_for`/`rssi`). foxlib 1.1.0.
- `CONFIG.md` "The `net` contract": `net.*` per kind, `id.callmessage` +
  **`id.use_callsign_as_name`** (a ham fox hunt puts the callsign on the
  air; a contest wants its own SSID / name), `schedule.duty`, `led`.
  A hidden SSID is accepted and reported — CircuitPython cannot hide an AP,
  the fox's banner and the page both say so.
- Page: `js/model/netschema.js` (twin of `netcfg.py`, parity-tested on a
  shared corpus), `js/ui/net.js` forms on the Radio (SSID / PSK / channel
  incl. 5 GHz where the hardware has it / power / MAC with **Random**;
  BLE UUID / major / minor / interval / power), ID and Schedule tabs; Plan
  and Payload tabs hidden; Deploy shows the duty card; Bench offers
  **Radio up** and **Scan**; the demo board boots a network fox.
  Switching between network templates resets the radio section to the new
  kind's defaults; the callsign carries across every switch.
- Targets (experimental, `Show experimental targets`): `seeed_xiao_esp32c6`,
  `waveshare_esp32s3_nano`, `dfrobot_firebeetle2_esp32c5` and
  `arduino_nano_33_ble` (nRF52840, BLE only; CircuitPython goes on by hand).
  The XIAO ESP32-C3 lists its radios and offers all ten templates. A
  template is offered only where the hardware has its `radios` and (FM) its
  required pin roles.
- Simulator: `wifi`, `_bleio`, `alarm` mocked; deep sleep re-executes
  `code.py`; 12 network scenarios (`net_contains`, `net_events_min`).
  `check_catalog.py` validates network defaults with `netcfg`. Smoke: the
  three templates deploy on the demo; forms, Random MAC, callsign-as-name,
  deep-sleep note, net bench.

### Page 0.7.16 · foxlib 1.0.5 · foxlib-c 0.1.10

The page lows left from the October audit, in one pass:

- W6: following a banner no longer loses the form that was there —
  `window.foxbench.undoFollow()` brings it back (the console line says so).
- W11: a serial read stream that ends cleanly is a drop like an error is.
- W12: every UI handler wired through `h()` reports a rejected promise to
  the console instead of a button that silently does nothing.
- Two tabs of the page: each save of the working form carries the tab's
  id; a save seen from another tab makes this one stop overwriting until
  something is edited here, with a console line.
- Fleet CSV: a cell beginning with `= + - @` is prefixed with `'` (plain
  numbers excepted) — banner text and notes reach that file.
- The console's download buffer is capped (5 000 lines).
- `id.callmessage` is 1–64 **bytes of UTF-8** in the page, in foxlib and in
  foxlib-c alike (the page counted UTF-16 units, Python code points).
- `CONTRIBUTING.md` (branches, the local sequence, when to bump what, when
  to add a hardware-log row, what never goes in the repository) and
  `SECURITY.md`; `check_docs.py` now covers every Markdown file at the root.
- `tools/atten_sweep.py`: the F10 measurement — a sweep of attenuator codes
  with a timed carrier at each, readings typed in, a CSV and the dB-per-code
  slope out.

### Page 0.7.13 · foxlib 1.0.4 · foxlib-c 0.1.10

First kitsune build, for the boards on fox-bench's bench:

- Three clone targets behind "Show experimental targets": DFRobot
  FireBeetle 2 ESP32-C5 (flashes kitsune's XIAO-C5 build), Waveshare
  ESP32-S3-Nano (kitsune's Arduino Nano ESP32 build, via the ROM's download
  mode) and Seeed XIAO ESP32C6 (fox-bench's own envs, `fb-` prefix, in
  `firmware/kitsune/extra/`). Serial over native USB confirmed on the C5
  and C6.
- `tools/build_kitsune.py --conf-dir` installs fox-bench's **bench
  conference** (`firmware/kitsune/bench/*.h`, generated by the page's
  exporter via `tools/kitsune_bench_conf.mjs`, FOXBENCH names and
  F2:B0:… MACs) as `current_conf.h` before building — an image fox-bench
  builds never carries an event's configuration; `--extra-ini-dir` adds the
  `fb-` envs with kitsune's `platformio.ini` merged in unchanged.
- CI: `KITSUNE_BUILD` builds images as a run artifact; a second switch
  `KITSUNE_HOST` is needed before anything is put into the site.
- Plan §10: the bench conference, fox-bench envs, the branch convention.
- The firmware card opens the CI artifact folder (**Open artifact
  folder…**): the same per-board buttons and sha256 checks as a hosted
  manifest, from the unzipped `kitsune-images` run artifact. Smoke-tested
  with the three stand-in targets (chip refusal, written at 0x0).
- `docs/kitsune-bench.md`: the first-flash checklist per board; the battery
  auto-off and serial-during-sleep notes from kitsune's README are on every
  kitsune hardware descriptor. `docs/kitsune-c6-proposal.md`: the PR text
  for the C6, kept with its evidence.

### Page 0.7.12 · foxlib 1.0.4 · foxlib-c 0.1.10

- The Board picker lists only targets verified on hardware. Targets with
  status `experimental` — the five kitsune boards, until one is on the
  bench — sit behind a **Show experimental targets** checkbox (remembered
  per browser; a selected target is always listed). Nothing is removed: a
  release of this page is what the hardware log vouches for, and the
  kitsune work continues behind the box.

### Page 0.7.11 · foxlib 1.0.4 · foxlib-c 0.1.10

Page 0.7.11 is a version bump so the release carries foxlib-c 0.1.10 under a
tag; no page change. The PicoFox is signed off on 0.1.10
(`docs/hardware-log.md`, 2026-10-23).

### Page 0.7.10 · foxlib 1.0.4 · foxlib-c 0.1.10

**foxlib-c 0.1.10** — the open firmware items of the October audit, each
with a host test that fails on the old code:

- F13: the scheduler was fed the 32-bit millisecond clock. After 49.7 days
  of uptime a resurrection fox's `until` became unreachable and it stayed
  dead. The scheduler now takes a 64-bit clock (`sim.py`
  `resurrection-across-the-32-bit-clock-wrap`).
- F14: a Si5351 that did not answer at boot (reference still ramping) was
  `radio=nosi5351` until a power cycle. The hold loop asks again every
  20 s and the fox comes up by itself; `status` says "si5351: answers now".
- F15: `key`/`tone`/`id` from the console obey the callsign gate the cycle
  obeys (`err: callsign unset`); `atten` stops what is on the air, applies,
  and restarts the cycle — core 1 refuses a register write mid-stream, and
  the console used to print `ok` while the value was dropped; a `reload`
  during a bench action answers it (`ok (stopped)`) so a waiting host is
  released.
- F12: `json.c` rejects a bad low surrogate and never emits a surrogate as
  UTF-8; `json_int` clamps instead of casting an out-of-range double
  (undefined behaviour). `tests/json_fuzz.c`: a deterministic mutational
  fuzzer over every template's defaults, parser + validator under
  ASan/UBSan, 20 000 iterations in `make check` (a million locally, clean).
- `(player late on N samples)` is printed only above 2: one or two late
  samples per transmission are the console's own printing.

Also in 0.1.10: `console.c` and `si5351.c` now build and run on the host. `console_test.py` feeds a command corpus to the real parser and to
the page's `FakeConsoleLink`; the fake had drifted (`help` text, `status`
without `uptime=`/`version=`/`i2c_errors=`/`core1=`/`correction_ppm=`, `batt`
without `note=`, `reload` not resetting a console `freq`, a second `ok` after
`bootsel`) and now follows the firmware. `si5351_ref.py` sweeps the 2 m band
through the real driver over a fake I²C controller and checks every register
against the datasheet's formulas, plus the timed-out-write recovery paths and
`correction_ppm`. `console.c` includes the SDK's time header itself instead of getting it
transitively.


Two bugs the new tests found, both on the kitsune side:

- **A page whose saved working form was a kitsune target did not boot**
  (blank page, `renderRadio … reading 'cfg'`): the Radio/Plan/Schedule tabs
  render at boot before the ID tab had initialised the kitsune UI module.
  Each tab now initialises it itself. The smoke reloads with a kitsune form
  saved on each of those tabs.
- **The flasher would have refused a real ATOM Lite.** `chipId()` turned
  esptool's "ESP32-PICO-D4" / "ESP32-D0WDQ6" into `esp32picod4` /
  `esp32d0wdq6`, not `esp32`, so the chip check would have reported "the
  port belongs to an ESP32-PICO-D4, but the selected board is an ESP32" and
  stopped. The classic ESP32's package variants now map to `esp32`; the old
  unit test had encoded the bug.
- `setTemplate` with carry no longer assumes a `payload` section (compiled
  configs have none).

Tests: the test server can play a deployed site (CI-written fingerprint,
kitsune manifest and image), so the hosted-image paths run in the smoke —
fingerprint shown, image accepted when it matches, refused with the
"mid-deploy" hint when it does not, the same for a kitsune image, and the
site's merged image flashed at 0x0. The simulated esptool can fail to
connect or to start its stub (unit-tested); `send()` has a unit test; three
smoke asserts that could not fail now can, and two sleeps are waits.

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
  template is a code change (`js/model/vendor/kitsune.js` `TEMPLATES`).
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
