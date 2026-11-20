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

### Page 0.18.18 · foxlib 1.10.12 — one family fewer

The experimental family for foxes whose configuration is compiled into
their firmware is removed whole: its seven targets and four hardware
descriptors, five templates, vendor model and forms, image card, build
tool, CI job, plan and bench notes, test fixtures, and every mention in the
docs. Nothing of it had reached hardware, and a half-present integration
is worse than none. The catalog-pack mechanism stays, with its example
fixture rebuilt around a CircuitPython board clone. Three families remain:
foxlib, drive, foxlib-c.

- `check_catalog`: strings two sides copy must agree — `SAFE_REASONS` in the
  page against `AUTO_RESET` in `safemode.py` (nvm[1] indexes it), the trace
  `settings.toml` text in Deploy against `hw_smoke.py` (each removes only
  the one the other wrote), and the recording placeholder callsign must be
  a placeholder.
- Release job: the released site zip carries the precompiled foxlib set, as
  the live site does. `build_mpy.py` retries a dropped S3 connection three
  times before failing the run.
- `docs/build-and-flash.md`: the pipeline in diagrams — families, templates
  to files, the foxlib sets, source vs `.mpy`, what CI builds on every push
  (and that nothing is built at flash or deploy time), what is pinned where.

### Page 0.18.17 — the precompiled set is built by CI, not committed

0.18.13 put `firmware/mpy/` in git, which made every firmware patch a
two-step apply (rebuild, commit) with CI red in between. The repo already
had the right pattern — the PicoFox UF2 is built in CI and staged into the
site — and the `.mpy` set now follows it.

- The `sim` job builds the set with the pinned CircuitPython's `mpy-cross`
  and uploads it; the deploy job stages it at `firmware/mpy/` beside the
  UF2. `firmware/mpy/<major>/` and `index.json` are gitignored; `pins.json`
  is the only source. `--verify` is gone (nothing committed to verify).
- The hosted page always has the set. A checkout has it after
  `python3 tools/build_mpy.py`; until then Deploy's checkbox is disabled and
  says exactly that.

### Page 0.18.16 — bench recordings that stay tight, and say nothing about the neighbours

The two replay fixtures were using 247 of 434 and 223 of 685 exchanges:
almost all the rest were chunks of foxlib source bytes recorded at 1.2.1
and 1.10.5, dead the moment foxlib moved. One fixture also carried the
run's callsign and the SSIDs and BLE addresses around the bench.

- **`hw_smoke.py --record` writes recording format 2:** one `write` line
  per file (path, size, crc) instead of its bytes, and the recording is
  scrubbed before it is written — the callsign becomes `W1ABC FOX DE W1ABC`
  in commands, replies and args; every scan line keeps its dBm but names
  its neighbours `neighbour-N`. A format-2 fixture is ~80 exchanges instead
  of ~500 and replays 100% across firmware releases.
- **The replay answers a recorded write from the bytes written at replay
  time** (`pty_board.py`); format-1 fixtures still replay. `replay_check`
  prints the format and, for format 2, any recorded exchange no longer
  reached — the real drift signal.
- **`pty-c3-all-fm.json` is now `sim-esp32c3-fm.json`:** it was never a
  hardware recording (its `circuitpython` is a Linux kernel version — the
  pty board), so its name now says so; re-recorded in format 2, 83
  exchanges, all used. The S3 recording stays as it is until the next S3
  session re-records it.

### Page 0.18.15 · foxlib 1.10.11 — a memory number on every network banner

A second, critical audit (see the runbook's C3 section for the findings
that are not code). The one thing every bench row lacked was a memory
figure: the C3's margin was only visible with the trace on.

- **The network banner ends with `mem=<bytes>`**, the heap left after init
  (after a collect). Deploy shows it as a chip, amber under 20 kB — the
  threshold where a feature switched on later, or a longer payload, is the
  next `MemoryError`; `hw_smoke.py` reports it as `mem_free`. The FM banner
  is unchanged.
- Console: Interrupt is refused while a deploy or flash is writing — a
  Ctrl-C mid-write would corrupt the file in flight.

### Page 0.18.14 · foxlib 1.10.10 — an audit of 0138–0141

- **foxlib: the watchdog timeout covers a deep sleep.** A nordic watchdog
  in RESET mode cannot be stopped and keeps counting through System ON
  sleep, so a network fox with `schedule.sleep = deep` and a sleep longer
  than 90 s would have been reset mid-sleep (espressif's task watchdog does
  stop; `guard.disarm()` before the sleep is for it). With a deep sleep the
  timeout is the sleep plus stealth's jitter plus 60 s; the banner's
  `watchdog Ns` says which.
- **Page: a module that belongs to one board follows the form correctly**
  on the path where switching boards also switches the template (PicoFox →
  a bare board); it fell back only on the other path.

### Page 0.18.13 · foxlib 1.10.9 — foxlib precompiled (.mpy), a Deploy checkbox

The lever for the C3's `MemoryError`: a board compiles each `.py` on
import, and the compiler's peak heap is several times the source — more
than the C3 has left beside its Wi-Fi and BLE stacks. A `.mpy` is the
bytecode: no compile, about a third of the size on flash (70 kB for all of
foxlib against 180 kB of source).

- **Deploy: "Precompiled (.mpy)"** writes `foxlib/*.mpy` (the template's
  set, `VERSION` as it is) instead of the sources, and removes any `.py`
  beside them — CircuitPython imports the `.py` first when both exist.
  Unticked writes the sources and removes the `.mpy`, so a board can go
  back and forth and the boot trace's `free` numbers compared. The box is
  disabled, with the reason, when the site has no set for the board's
  CircuitPython major or the set is another foxlib version. Re-read board
  says "(precompiled .mpy)"; the export zip follows the box.
- **`tools/build_mpy.py`** builds `firmware/mpy/<major>/foxlib/*.mpy` with
  CircuitPython's own `mpy-cross` (MicroPython's on PyPI is another
  dialect), fetched for the tag pinned in `firmware/mpy/pins.json` from
  Adafruit's S3 as the library bundle is; `--check` (offline) fails CI when
  a pinned set is missing or older than the sources, `--verify` (online)
  rebuilds and compares bytes, since `mpy-cross` output is deterministic.
  **The set is not in this patch** — the sandbox cannot reach S3 — so
  `python3 tools/build_mpy.py` once after applying, and commit
  `firmware/mpy/`; CI is red until then.
- `hw_smoke.py --mpy` writes the precompiled set for the board's major.
- The simulator keeps running sources; the demo board boots from either.

### Page 0.18.12 · foxlib 1.10.8 — a board carries the files its template needs

With 1.10.7 the C3 stopped crashing and failed honestly instead:
`MemoryError` compiling `netcfg.py`. Fewer files on the board do not change
that (flash is not RAM; the `.mpy` set in the next release is what does),
but a board should look like what it is, and a deploy should not spend a
minute writing modules the fox never imports.

- **Deploy writes the foxlib files the selected template needs and removes
  the rest** of `foxlib/` from the board as stale ("removed stale: …", as a
  previous template's images are). An FM fox gets 14 files, a network fox
  16, instead of all 24. "foxlib on board" is complete when the board's own
  template has what it needs. Switching families on a board writes the
  other family's modules and removes this one's.
- **The sets come from the import graph, never from a list:**
  `tools/foxlib_deps.py --write` walks `from . import` in `foxlib/` from each
  template's `code.py` (the lazy FM imports in `__init__._fm()` count only
  for `foxlib.Fox`; `netfeatures.MODULES` names the feature modules) and
  writes `foxlib_sets` / `template_sets` into `firmware/index.json`;
  `check_catalog` fails when they are stale. A per-feature layer later is
  the same walk from `fox.json`'s enabled sections.
- **foxlib: `report.py`** holds what `cfg.py` and `netcfg.py` share (the
  validation report, the value helpers), so a network fox no longer carries
  `cfg.py`'s 17 kB for one class.
- `hw_smoke.py` writes the union of its templates' sets and removes the
  rest; a replay of an older recording treats those removals as
  housekeeping.

### Page 0.18.11 · foxlib 1.10.7 — the C3 crash found: the radio stack starved of RAM

The boot trace from 0.18.10 answered Q15 on the first try. The last line
before the board reset was `init: ble workflow switched off (free 46704)`:
the next step is `import wifi`, and 46 kB free at the *start* of `NetFox`
is the tell. CircuitPython's Python heap on the espressif ports grows into
the same RAM the Wi-Fi driver takes at `esp_wifi_init` (which `import
wifi` runs) and the BLE stack already holds; by then foxlib's imports had
grown the heap from 121 kB free to 46 kB, the init failed, and
`ESP_ERROR_CHECK` rebooted the chip — then `safemode.py` reset it back into
the same crash, fifty times, five seconds apart, with no way to connect.

- **foxlib: `foxlib/__init__.py` no longer imports the FM stack** (radio,
  tones, SSTV, melody, battery, schedule, cycle — some 40 kB of source
  compiled on the board) when the package is imported; the first `Fox`
  built imports it. A network fox, which reaches `netfox` through that
  file, no longer pays for it. `foxlib.Fox(...)` and every FM template are
  unchanged.
- **foxlib: `netfox` imports `wifi` and `_bleio` first**, before any of its
  own modules, so the radio stacks take their RAM while the heap is small;
  `gc.collect()` before init.
- **safemode.py: a crash in CircuitPython itself** (HARD_FAULT, NO_HEAP,
  STACK_OVERFLOW …) is reset at most 3 times in a row before the board is
  left in safe mode, where the bench can connect; brownouts and watchdog
  bites keep the 50. The last reason is kept in `nvm[1]`, and **Re-read
  board shows it** ("Safe mode: 3 resets in a row — last reason
  HARD_FAULT") with what to do. Host test `firmware/sim/test_safemode.py`.

### Page 0.18.10 · foxlib 1.10.6 — the network fox audited after the C3 hang

The bare XIAO ESP32-C3 (two boards, CircuitPython 10.2.1/10.3.1/10.3.2)
hangs hard before the banner on every network template, while morse-songs
on the same board runs, and `import wifi` / `start_ap` work at its REPL.
Nothing on the bench could say where; this release is what an audit of
`netfox.py`/`netradio.py` found and what the next attempt needs.

- **foxlib: a network fox arms the hardware watchdog** (90 s, the FM fox's
  field default) when its cycle loop starts, off before deep sleep. Until
  now only the FM fox had one: a network fox that hung stayed hung until
  someone power-cycled it.
- **foxlib: CircuitPython's own BLE advertising is switched off** while a
  network fox runs. Builds without native USB (every ESP32-C3/C6/C5 build)
  boot with the BLE workflow on and advertise `CIRCUITPYxxxx` — seen in
  nRF Connect beside the C3 — which gives the board away to any hunter's
  scanner and keeps the BLE stack up beside the fox's Wi-Fi. The banner
  notes it; it is back at the next reset.
- **foxlib: Wi-Fi power is set after the interface is started**, not at
  setup: ESP-IDF's `esp_wifi_set_max_tx_power` wants a started Wi-Fi, and
  CircuitPython passes the call through without checking.
- **foxlib: a boot trace.** `FOX_TRACE = 1` in `settings.toml` prints every
  init step with the free heap before the banner. Deploy has *Trace the
  boot* (writes and removes that file; another `settings.toml` is left
  alone) and `hw_smoke.py` has `--trace`. The next C3 deploy with it on
  shows the last step before the hang.
- **Console: an Interrupt button**, and Ctrl-C in the empty input box,
  send Ctrl-C straight to the board, outside the operation queue (Ctrl-D
  soft-reboots). A running fox stops at its prompt; a hung board shows
  nothing, and the console says what to do. Re-read board and Restart fox
  on a board that does not answer now say so ("the board is not answering
  Ctrl-C … press its reset button") instead of asking whether it runs
  CircuitPython.
- **Radio & pins: the module dropdown offers only the modules this board
  can carry.** The PicoFox's SI5351 (`fixed_to_board`) is no longer offered
  on the XIAO ESP32-C3 + SA868; a saved form carrying it to another board
  falls back to that board's default module.
- Simulator: `supervisor.runtime.ble_workflow`, `settings.toml` values
  (`env`), `gc.mem_free`; scenarios for the workflow switch, the trace and
  a build where the workflow is already off. CONFIG.md and the runbook
  (Q15, the C3 session) say what changed.

### Page 0.18.9 — recordings from a Windows checkout

- **Fix — CI's replay of the S3 recording failed with the code green.**
  The recording was made on a Windows checkout, where git had turned the
  firmware's line endings to CRLF: the replay could not match those
  writes, found the LF copy that `hw_smoke.py` wrote back at the end of
  the run, and jumped three templates ahead, so ble-beacon was judged by
  the wrong boot. The replay no longer searches past the next recorded
  reboot; `hw_smoke.py` writes LF to the board whatever the checkout; and
  `.gitattributes` keeps every text file LF on every platform (a Windows
  clone made before it: `git add --renormalize . && git commit`).
- `hw_smoke.py` says, when it writes a recording from a run with a failed
  template, that the file is not one to commit.

### Page 0.18.8 · foxlib 1.10.5 — from the second ESP32-S3 session

- **Fix — BLE advertising refused after a scan on the ESP32** (XIAO
  ESP32S3, CircuitPython 10.3.2: `_bleio.BluetoothError: Unknown system
  firmware error: 530`, HCI invalid parameters). Reproduced on the page:
  Radio up ok, Scan ok, Radio up refused; the plain fox never scans and
  never saw it, but a sense fox scans before every wake. `BleBeacon.restart()`
  now tries again after a stop, then with the adapter turned off and on
  (address and name put back), and says once which one worked; only when
  both fail is the first refusal the caller's error, which costs that
  wake and not the fox (`esp32-refuses-to-advertise-after-a-scan-*`,
  scenario `ble_refuse_after_scan`). Which retry clears it on hardware is
  runbook Q14.
- The nRF52840 power-step fallback applies on the nordic port only
  (`sys.platform`); on the ESP32 it hid the first error behind a second
  attempt's (`esp32-power-value-refused-is-the-callers-error`; scenarios
  carry `platform`).
- **Behavior card: "Seen with"** for a network fox — a phone's Wi-Fi list
  (wifi-ap), a sniffer only (wifi-probe: the fox asks for a network and
  answers to nobody), a BLE scanner app (ble; a phone's Bluetooth settings
  never list a beacon, iOS hides iBeacon frames). The first session spent
  an hour on a wifi-probe fox that nothing could see.
- `hw_smoke.py` accepts the catalog's alias build ids
  (`seeed_xiao_esp32_s3_sense` for the XIAO ESP32S3) without the "board
  reports …" warning.
- The author's callsign is out of the code, tests, docs and placeholders:
  the examples use `W1ABC` (and `W1XYZ` for a second hunter), the
  placeholder stays `N0CALL`.
- Runbook: the scanner note under step 9 (restart the phone first; the
  FOXTEST line as one line for the page console), Q14.

### Page 0.18.7 — the rail in working order

- **Tabs reordered:** Board → Callsign & ID → Behavior → Radio & pins →
  Frequency plan → Payload → Schedule → Deploy. The callsign is the one
  thing every fox needs before anything else, and on a network fox the
  template decides what Radio & pins shows, so it comes first now.
- The Callsign & ID card says where the name is set when the callsign is
  not used, with an Open Radio & pins button.
- **Fix — "Failed to execute 'open' on 'SerialPort': The port is already
  open" when flashing after a Listen session.** A Listen whose board went
  away keeps polling the granted ports and opens the first one with the
  same USB ids; a board plugged in with B held matched, and the waiter
  took the port a second before esptool. Starting a flash stops the
  waiter, and the waiter leaves the ports alone while a flash runs.

### Page 0.18.6 · foxlib 1.10.4 — from the first ESP32-S3 session

- **Flash card, step 2 for boards with a CIRCUITPY drive.** The moment to
  put `boot.py` on such a board is right after flashing, while the fresh
  drive is on the screen: the card now says so, with a Download button,
  and marks the step "now" after a flash. Deploy's check stays as the net.
- **The Eddystone URL is checked on the page.** The frame holds 17 bytes
  of encoded URL and only `.com/ .org/ .edu/ .net/ .info/ .biz/ .gov/`
  (and the same without the slash) compress to one byte; the firmware
  said `does not fit in 17 bytes; not sent` only on the board. The page
  now encodes the URL the same way (`eddystoneUrlBytes`) and says the
  byte count and the rule. A URL without `http://` or `https://` says
  that (a missing `:` was read as the 64-character rule).
- **Fix — the console broke fox output mid-word** (`c` / `ycle 1`): each
  USB chunk was rendered as a line. Whole lines only now; a partial line
  waits for its newline, or 400 ms for one that never gets one (a
  prompt). CircuitPython's title-bar sequence no longer shows as
  `]0;🐍Wi-Fi: …`.
- Runbook: the scanner note under step 9 (a phone's Bluetooth settings
  never list a beacon; iOS hides iBeacon frames from apps; what to try
  when the scanner shows nothing, with a plain-advertisement REPL test).

### Page 0.18.5 — the XIAO ESP32S3's CircuitPython build

- **Fix — the catalog named a CircuitPython build that does not exist.**
  CircuitPython has one build for the Seeed XIAO ESP32S3 and the Sense
  variant, `seeed_xiao_esp32_s3_sense`; both report that id. The catalog
  said `seeed_xiao_esp32s3`, so the only image there is was flagged as
  "for another board" and the connected board did not match its catalog
  entry. Corrected, with the download link; the catalog also lists the
  board's CircuitPython USB identity (2886:8056).
- **Flash: a port that is the board's running CircuitPython is said as
  such.** esptool needs the chip's download mode and cannot reset a
  native-USB ESP32-S3 into it from the REPL port, so picking that port
  ended in "Failed to connect with the device" after a timeout. The
  flasher now checks the port's USB identity first and says: nothing to
  flash if CircuitPython is already on the board (Connect and Deploy);
  to reflash, hold B while plugging in and pick the new port.

### Page 0.18.4 — boards with a CIRCUITPY drive; messages that carry their fix

From the first ESP32-S3 session on hardware.

- **Fix — Deploy failed with `OSError: [Errno 30] Read-only filesystem`
  on a board with a CIRCUITPY drive** (ESP32-S3, nRF52840).
  CircuitPython gives such a board's files to the computer: they are
  read-only to the board's own code — which is what writes when the page
  deploys over the serial port, and what writes `finds.csv` and
  `near.csv` on a fox — also with no computer attached. Deploy now asks
  first (`ReplDevice.makeWritable()`): a board without a drive, or one
  already set up, is written as before; a board whose drive has been
  ejected on the computer is remounted and gets `boot.py` (new,
  `firmware/boot.py`: `storage.remount("/", readonly=False)`), so every
  later power-up is the board's; a board whose drive the computer still
  has is not touched, and the Deploy card says what to do: copy the
  downloaded `boot.py` onto the drive and reset, or eject the drive and
  deploy again. A `boot.py` that is not fox-bench's is left alone and
  said. `tools/hw_smoke.py` does the same. The drive is then read-only
  on the computer; removing `boot.py`, or safe mode, gives it back.
  This also settles runbook Q7 (finds.csv with the drive mounted).
- The catalog said `has_usb_drive: false` for the ESP32-S3 boards and
  the Nano 33 BLE; they have one (XIAO ESP32-S3, Waveshare S3-Nano,
  Arduino Nano ESP32, M5Stack AtomS3 Lite and StampS3, Nano 33 BLE).
- **Checks carry their fix.** A message that sent the reader to another
  tab now has the way there on it, wherever it is shown: the three
  clock checks (`checkpoint.stop_at`, `stealth.start.at`,
  `stealth.shell_game`) have a **Set the board clock at deploy** button,
  the access-point check an **Open Board** button, and every line of
  Deploy's Checks card an **Open <tab>** button for the tab its key is
  edited on (`js/model/issuetab.js`, `js/ui/issues.js`).
- Flash CircuitPython: an image built for another board id no longer
  says only that it will not run right. Some boards share a build (a
  maker may ship one image for two variants) and that can change
  between releases; the message says to check that the image supports
  the board, and that the board will then report the image's id.

### Page 0.18.3 · foxlib 1.10.3 · foxlib-c 0.1.11 — the radios as CircuitPython has them

The last audit checked every call's names and argument shapes. This one
read what each call *requires and does* in the CircuitPython source
(the espressif port's wifi Radio.c, the espressif and nordic _bleio
Adapter.c, the shared _bleio Address.c), and made the
simulator's `wifi` and `_bleio` behave the same way. With those mocks the
firmware on `main` failed 186 of 227 scenario runs; none of this could
show before, because the mocks accepted what a board refuses.

- **Fix — every Wi-Fi fox was silent on a board.** `wifi.radio.mac_address_ap`
  (and `mac_address`) raise `RuntimeError: Interface must be started`
  unless that interface's mode is already on. The drivers set the MAC in
  `setup()`, before any `start_ap`, so `wifi-beacon`, `checkpoint` and
  `wifi-probe` came up `radio=wifi(RuntimeError)` and stayed silent
  (every default has a MAC). The MAC is now applied at `up()`: radio
  disabled, mode on (`start_ap` / `start_station` then only configure),
  address set, radio enabled — nothing is sent under the chip's own
  address — and re-applied whenever the address read back differs
  (rotation per cycle, the shell game). The power is set again after,
  since enabling resets it (`mac-set-before-anything-is-sent`).
- **Fix — the BLE address was never the configured one.** `_bleio.Address`
  takes its bytes little-endian; foxlib passed them as written, so
  `F2:B0:…:07` was offered as `07:…:B0:F2`, which is not a valid static
  random address, and the refusal was swallowed: BLE foxes advertised
  from the chip's address, and MAC rotation and shell-game MACs did
  nothing on BLE. The bytes are reversed now; a static random address
  must have its two top bits set, so they are set (`02:…` goes on the air
  as `C2:…`), which the console says once and the page warns about
  (`net.mac`); the event sheet lists the address as it is on the air. The
  log line read `ble up: NAME (<ADDRESS)`; it shows the address now
  (`ble-mac-is-the-one-on-the-air`, `ble-mac-top-bits-are-set-and-said`).
- **A MAC that did not take is said.** Every `… up:` line shows the
  address read back from the radio; when that is not the one asked for:
  `note: MAC F2:… was asked for, the radio reports 7C:… (reason)`, once
  (`mac-read-only-build-is-said-once`, scenario `mac_fixed`).
- **Fix — a probing station probed for two seconds per wake.**
  CircuitPython's `connect()` scans until its timeout and stops; the
  `wifi-probe` fox called it once per wake, so a 15 s wake was 2 s of
  probe requests and 13 s of nothing while the log said `up … for 15 s`.
  The runner now asks for round after round until the wake is over
  (`radio.keep()`); the probe list changes the network between rounds
  (`probes-for-the-whole-wake`, expectation `min_keyed_ms`).
- **Fix — hunter tags named in their scan response were never matched.**
  An active BLE scan reports a device's advertisement and its scan
  response as two entries; the sense scan kept the first per MAC, which
  for a fox-bench beacon (and most tags) is the one without the name.
  Entries are merged per MAC now: strongest reading, the name from
  whichever has one; the Bench Scan lists a device once
  (`sense-tags`, `sense-tag-named-in-the-advertisement`; the mock world's
  advertisers put the name in the scan response unless `name_in: "adv"`).
- **Fix — a BLE power the nRF52840 does not have ended the fox.** The
  SoftDevice accepts only its own steps and refuses the rest; −9, −6, −3
  and 9 dBm of foxlib's BLE steps are not among them, and the refusal
  was an uncaught exception in `code.py`. The nearest step is used and
  said once (`nrf-power-step-is-the-nearest`, scenario `ble_power_steps`).
- **A radio that will not start costs the wake, not the fox.** An
  exception from `radio.up()` ended `code.py` (a network fox has no
  watchdog to bring it back). It is logged — `wifi-ap did not start
  (RuntimeError: …); silent this wake` — and tried again at the next
  wake (`ap-that-fails-to-start-costs-one-wake`, scenario `ap_fail_at_s`).
- **Fix — the Bench Scan on a BLE fox listed addresses without names**
  (the 0.18 fix read the name but `rssi()` printed only the address):
  `-60 HUNT-RED C0:…` now. **Radio up** answers with the address read
  back while the radio was up — `ok wifi-ap NAME (MAC) for 3.0 s` — and
  `hw_smoke.py` records it as `mac_on_air` and says when it is not the
  one in `fox.json`.
- Simulator: `wifi.radio` tracks its AP/station modes and enabled state,
  has a factory MAC (`factory_mac`), and refuses what the port refuses;
  `_bleio.Address` is little-endian and prints as `<Address …>`, the
  adapter refuses an address that is not static random or is set while
  advertising; stopping what never started is not an unkey.
- Bench runbook: Q12 (is the configured MAC the one on the air, per
  kind), Q13 (BLE power steps on the nRF52840); the watchdog step no
  longer says foxlib disarms on Ctrl-C (CircuitPython does, since
  1.10.2).

### Page 0.18.2 · foxlib 1.10.2 · foxlib-c 0.1.11 — a deeper audit, and ESLint

The simulator runs foxlib on desktop Python. This round checked the
firmware against what CircuitPython 9.2 itself accepts — its grammar, its
string/bytes method tables and build flags, and the binding of every
`wifi`, `_bleio`, `socketpool`, `microcontroller`, `watchdog`,
`supervisor`, `alarm` and `rtc` call foxlib makes (argument names,
enum members, return shapes) — by reading the CircuitPython source.

- **Fix — no payload feature ever ran on a board.** `netpayload.py` built
  the split clue's radio settings with `{**a, "kind": k}`; CircuitPython's
  grammar has no `**` in a dict display, so the module was a SyntaxError
  on every board from foxlib 1.4 to 1.10: rotating names, codes,
  Eddystone, split clues, TLM data and the `puzzle-beacon` template all
  ran as a plain beacon, and the banner called payload "accepted but not
  built yet". Every simulator run passed.
- A feature that fails to load is now said loudly: `** payload failed to
  load on this board (SyntaxError): the fox runs without it **`; the
  Deploy result fails and names it, and the fleet row says
  `failed to load: …` (`feature-fails-to-load`, `break_module`).
- **Fix — one stray BLE name lost a whole scan.** CircuitPython ignores
  `decode`'s `errors` argument and raises on invalid UTF-8, so a nearby
  advertiser with junk in its name made `adv_name` raise and the wake's
  tags and crowd count were lost; a callsign written over BLE with a stray
  byte was dropped. `netcheckpoint.text_of()` never raises.
- **The watchdog is left to CircuitPython when `code.py` ends.**
  CircuitPython stops a RESET watchdog after Ctrl-C or a reload and keeps
  it running after an uncaught exception, so that the board resets. foxlib
  disarmed it on the way out, which turned that reset off: a template body
  that raised outside `tx` left the fox dead. Now it resets after
  `watchdog_s` and `safemode.py` brings it back
  (`body-raises-watchdog-stays`, `code_patch`, `watchdog_end`).
  `guard.disarm()` uses `mode = None` (9.0+; `deinit()` is gone in 10.0,
  which the C5 and XIAO S3 builds run).
- `safemode.py` no longer lists `HEAP_OVERWRITTEN`, which is not a
  `SafeModeReason` in 9.2 (it was skipped anyway).
- **`tools/check_firmware_py.py`** (new CI step): rejects `{**dict}`
  displays, the match statement, keyword arguments to string methods and
  `decode`/`encode` with an `errors` argument — each verified against
  the CircuitPython source. It found the three above and nothing else.
- **ESLint in CI** (`tests/eslint.config.mjs`, eslint 9.15.0 and
  `@eslint/js` / `globals` pinned in `tests/package.json`; `npm run lint`,
  first step of the page job): the recommended rules with `no-unused-vars`
  as an error, empty `catch {}` allowed, control characters in regexes
  allowed (the REPL protocol). The first run cleaned up dead code
  (unused imports and constants in `main.js`, `board.js`, `net.js`,
  `netschema.js`, `vendor/picofox.js`), redundant regex escapes, a duplicate key in
  the fake ESP32 ROM and dead lines in two tests.
- Checked and fine: every API name and keyword argument; `stations_ap`'s
  field is `mac_address` (its docstring says `mac`; the namedtuple says
  `mac_address`); `str.partition` and `bytes.decode` exist on full builds,
  which every board in the catalog runs.
- Runbook Q11: confirm the payload features on a board.

### Page 0.18.1 · foxlib 1.10.1 · foxlib-c 0.1.11 — audit of 0.13–0.18

A read of everything added since page 0.12 (foxlib 1.6–1.10) for what the
simulator could not see. Each firmware finding has a scenario that fails
without its fix.

- **Fix — a shell-game fox broke the page:** `checks()` read
  `opts.clockSet` where its parameter is `clockSet`; any network fox with
  `stealth.shell_game` threw on every change. Unit test; an
  undefined-identifier lint over `js/` found no other.
- **Fix — network foxes never cleared `safemode.py`'s count:** only the
  FM loop called `guard.healthy()`, so every brownout of a network fox
  added to `microcontroller.nvm[0]` for life, and after 50 across any
  number of days the board would stay in safe mode. `NetFox` now clears it
  after each completed wake and its banner notes resets since the last
  one (`safemode-count-cleared`).
- **Fix — variable power never changed live on a BLE fox:** the beacon
  restarted advertising without stopping it, which `_bleio` refuses; the
  error was logged as `not applied`. `BleBeacon.restart()` stops first;
  the advertising mock now refuses a second start as `_bleio` does
  (`variable-power-slot-ble`).
- **Fix — the honeypot listened on last wake's channel** when
  `net.channels` drew a new one: the channel draw now runs first in the
  wake (`honeypot-listens-on-this-wakes-channel`).
- **near.csv no longer fills in an hour:** a tag or prober is written at
  most once per 5 minutes per MAC (every sighting stays on the console;
  joins are always written) — `near-log-rate`, `file_lines`.
- Page check: a relay or honeypot on a BLE-only fox (their Wi-Fi scan
  would turn the Wi-Fi radio back on) is an error.
- Event sheet: an exported fox is keyed by its profile, so exporting it
  again replaces its line, and a later deploy of that profile to a board
  supersedes it (before, every export added a line). Handoff chain: two
  profiles with one fox number are flagged. `tests/unit/sheet.test.mjs`
  (new; the sheet had no unit tests) and a chain test.
- Docs: DESIGN's file tree and foxlib list name every module added since
  0.12 (`guard`, `safemode.py`, `netcheckpoint`, `netsense`, `netvary`,
  `netmodes`, `sheet`, `handoff`, `shellgame`), the tabs table the new
  cards, §8 the new mocks, and what the 1.6 recovery does and does not
  cover (an exception a template body raises outside `tx` still ends
  `code.py`). `tests/README.md`'s "Everything CI runs" now lists every
  step CI runs (it had half; the C runner was the missing one behind the
  0128 CI failure). README describes the contest features and counts
  `checkpoint`. The runbook opens with the ten open hardware
  questions (Q1–Q10). CONFIG's cross-section rules list the newer checks.

### Page 0.18.0 · foxlib 1.10.0 · foxlib-c 0.1.11 — phase E′: the fox that listens, and done for the day

- **`sense` built** (`netsense.py`; the Payload tab's last "arrives in
  phase" note is gone). Before each wake: one BLE scan for **hunter tags**
  (`tags`, near.csv kind=tag) and **crowd control** (`crowd`: more than
  `max` advertisers → silent for `quiet_s`); a Wi-Fi scan for the
  **relay** (`then: up | down | toggle` — `rotate` became `toggle`: each
  return of the other fox flips this one). While an AP is up the
  **honeypot** logs every station that joins (`stations_ap`, kind=join);
  with `honeypot.probes` and `wifi.Monitor` in the build, a listen before
  each wake logs probe requests for any of this fox's names (kind=probe)
  and counts the rest. No Monitor: said once, joins still logged. The
  Phase A placeholder `sense.probes` is replaced by `honeypot` and
  `crowd` (both twins; corpus +4).
- **Done for the day** — `checkpoint.stop_after_finds` and
  `checkpoint.stop_at`: radio off until power-cycled, LED `done` (a long
  slow blink). One state, two triggers, so later designs add a trigger.
  `stop_at` needs the board clock (page error; on the fox, said once).
- `NetFox` gains `skip` (a feature keeps one wake off the air; logged
  `silent this wake (…)`, LED `armed`) and `done`.
- **Bench → Who is near** reads `near.csv` (tags, joins, probes): shown,
  downloadable, clearable; not merged into the fleet log. The demo fox
  seeds three lines.
- Fix: the bench's BLE **Scan** on real hardware read `complete_name`,
  which `_bleio` scan entries do not have — the exception was swallowed
  and the list came back empty. Names now come from the advertisement
  bytes (`netsense.adv_name`), addresses from `address_bytes`.
- Fix (CI): the foxlib-c host runner replayed the shared CircuitPython
  recovery scenarios (watchdog, safe mode, re-tune, `soak-8h`) against
  PicoFox firmware that has none of it; those six now carry
  `families: ["foxlib"]` and the C runner skips them by name
  (`foxlib-only`). Broken since 0121.
- Simulator: world-driven mocks — `world.advertisers` (BLE scan entries
  with advertisement bytes), `world.ssids` (Wi-Fi scan), `world.stations`
  (`stations_ap` over time), `world.probes` (a `wifi.Monitor` with
  `Packet` fields; `no_monitor` removes it). Scenarios `sense-tags`,
  `relay-up / -down / -toggle`, `crowd-quiet`, `honeypot-joins /
  -probes / -no-monitor`; checkpoint `stop-after-finds`, `stop-at`,
  `stop-at-no-clock`. The event sheet's `on_air` lists what a fox listens
  for and when it stops.

### Page 0.17.0 · foxlib 1.9.0 · foxlib-c 0.1.11 — phase H: mode rotation and the shell game

- **Mode rotation** — `stealth.modes` (2–3 of `wifi-ap`, `wifi-probe`,
  `ble`; `modes_random`): the fox is a different kind of fox each wake,
  same name on the air. `netmodes.py` builds one radio per kind from the
  fox's own `net` section plus defaults for what it lacks, and swaps
  `fox.radio` first in the `before_up` hooks. Kinds the hardware refuses
  are dropped (`modes: ble not available`); the portal is served on AP
  wakes only. Stealth card: kind checkboxes and *in turn / at random*.
- **Shell game** — `stealth.shell_game {identities: [{name, mac}],
  period_s, index}`: a fleet trades identities on a schedule following the
  board clock, seat i showing identity (i + elapsed periods) mod n
  (`netstealth._shell_game`, `clock_seconds`). With the clock unset the fox
  keeps its seat's identity and says so once. Fleet tab **Shell game**
  card: pick saved network foxes, name the identities (MACs generated,
  locally administered), set the period, see the rotation table, apply
  to all at once (each gets its seat; MAC/name rotation turned off);
  the Stealth card shows the fox's seat and can leave the game.
  `js/model/shellgame.js` + unit tests prove no two seats share a name.
- Page checks: shell game without the clock set at deploy (err), beside
  MAC rotation / name rotation / payload names (err), with the callsign as
  the name (warn); mode rotation with a portal (warn) or a split clue
  (warn).
- Stealth RNG users unchanged; `_set_mac` accepts `-`-separated MACs.
- Simulator: ble-beacon `modes-in-turn`, `modes-random`,
  `modes-one-kind-rejected`; wifi-beacon `shell-game-seat-0` (clock set:
  three identities in turn), `shell-game-no-clock`, `shell-game-bad`.
  Schema corpus +6. The event sheet's `on_air` names modes and the seat.

### Page 0.16.0 · foxlib 1.8.1 · foxlib-c 0.1.11 — phase J: one fox leads to another

- `fleet.points_to` — the fox this one leads to, by fox number or profile
  name; a **Points to** select on the Deploy tab's Fleet record card that
  shows what the target offers. Text anywhere in the configuration may use
  `{{to.freq}}`, `{{to.name}}`, `{{to.code}}`, `{{to.number}}`,
  `{{to.callsign}}`; filled from the target profile before validation, so
  the filled text is what is checked and written, while the editor keeps
  the placeholders (`js/model/handoff.js`). Unresolved placeholders, an
  unknown key, or a `points_to` that is not a saved profile are blocking
  checks; a target nothing uses yet is an info line.
- Fleet tab: **Handoff chain** — the links across saved profiles, with
  loops, self-references and missing targets flagged; the event sheet's
  `on_air` already ends with `→ N`.
- Both fleets: an FM fox's Morse message can name a network fox, a portal
  body can name a frequency. No firmware behaviour changes; `netcfg` and
  its twin accept `fleet.points_to` (corpus `fleet-points-to`).
- Unit tests: `tests/unit/handoff.test.mjs` (resolution, missing values,
  chain problems).

### Page 0.15.0 · foxlib 1.8.0 · foxlib-c 0.1.11 — phase G: what varies per wake, and the event sheet

Second round of contest features (plan, "Second round"): against a fox
whose configuration is compiled in, the headroom is behaviour drawn at
deploy and changing over the day.

- **Channel per wake** — `net.channels`: a list (chips on the Radio tab,
  *1 / 6 / 11*, *any* for the region's channels, *fixed* to clear), one
  drawn per wake; `"any"` in a hand-written fox.json is 1–11.
- **Probe-client SSID lists** — `net.probe_ssids` + `net.probe_ssid_s`:
  several networks sought from one MAC, one per wake at random or the next
  every N s inside the wake (which also means a fresh probe burst each
  time, where the probe fox used to send one per wake).
- **Variable power** — `stealth.variable_power {min_dbm, max_dbm, per
  wake | slot, slot_s}`: tx power drawn from the kind's steps; Wi-Fi
  changes live, BLE restarts advertising. The Stealth card has it.
- **Data in TLM** — `payload.eddystone.tlm_data`: any of battery,
  temperature, count, uptime fixed to a number so the telemetry carries a
  clue; fields on the Payload card when telemetry is on.
- All draws seed from the chip uid and the cycle (`netvary.py`); the
  stealth RNG now uses its high bits (`Rng.below`), since an LCG's low bits
  barely move — per-cycle MAC and name draws are better spread too.
- **Event sheet** (Fleet tab): the latest deploy per chip uid, one line
  per fox, filtered by event, with *Export CSV* and a *Print view*. Built
  from the fleet log alone; each deploy row now carries `event` and an
  `on_air` summary (new fleet-log columns, also in `tools/check_fleet.py`).
  A **Fleet record** card on Deploy edits `fleet.number`, `event`,
  `owner` and `notes`; the fox number becomes the row's `#`.
- Folded in from 0124 (never pushed separately): **Operator** on a
  network fox's ID tab → `fleet.owner` and the fleet log's `owner` column;
  the N0CALL warning names the operator or points at the field. **Write
  safemode.py** switch on Deploy (a remembered browser setting; off
  removes the file from a board that has it; an FM fox with recovery off
  skips it regardless).
- Page checks: a probe list beside payload names or the callsign-as-name
  (warn), a one-channel list (info), BLE slot re-draws under 5 s (warn).
- Simulator: `channels-per-wake`, `channels-any`, `variable-power-wake /
  -slot / -bad`, `probe-list-per-wake / -in-wake`, `tlm-data`;
  `prints_count_min`. Schema corpus +13 (`channels-*`, `probe-list*`,
  `variable-power*`, `tlm-data*`, `fleet-owner`).

### Page 0.14.0 · foxlib 1.7.0 · foxlib-c 0.1.11 — phase D: the fox as a server

The `checkpoint` section is built (`firmware/foxlib/netcheckpoint.py`):

- **Portal**: a `wifi-ap` fox serves one page on port 80 while its radio is
  up — title, plain-text paragraphs, the code set large, a callsign form
  that POSTs to `/find` — to every GET whatever the path, so a phone's
  captive-portal check opens the sign-in sheet; **captive DNS** on port 53
  answers every A query with the fox's address. Our own responder (GET,
  POST, one DNS answer), ~100 lines, no library. Non-blocking sockets,
  bounded per tick; the runner ticks `while_up` every 50 ms when a
  checkpoint is on (`NetFox.tick_ms`; the LED is then steadily on).
- **Find log**: `finds.csv` — `fox_uid,template,cycle,ms_since_boot,
  callsign,client_mac`, ≤ 200 lines, client MAC from `stations_ap` when the
  port gives it; a read-only filesystem is said once and finds kept in RAM.
- **BLE service**: a connectable service (read characteristic `…C1` = the
  code, write `…C2` = a callsign) on the beacon of a BLE fox or on a
  second BLE radio beside a Wi-Fi fox; `BleBeacon` gains `connectable`,
  `service_uuid` (128-bit UUID list in the scan response, the name cut to
  fit) and `restart()` after a central disconnects.
- `schedule.sleep: deep` with a portal is refused by the firmware as well
  as the page (`schedule.sleep` → off, reported).
- New **`checkpoint`** template (Wi-Fi chips: C3, C5, C6, S3), the portal
  on by default with code 4471, wake 120 / off 10, four clients.
- Page: Bench tab **Collect finds** (reads `finds.csv`, one `find` row per
  callsign into the fleet log keyed by the fox uid, deduplicated; download
  the fox's CSV; clear on fox). The demo fox seeds two finds. The
  checkpoint card drops its "arrives in phase D" note.
- Simulator: `socketpool` mock with a scripted phone (`scenario.phone`:
  `dns` / `get` / `post`, split bodies), `_bleio` service, characteristic
  and buffer mocks with a scripted central (`scenario.central`); the fox's
  `finds.csv` is read back; expectations `http_min`, `http_body_contains`,
  `dns_min`, `file_contains`, `files_absent`. Scenarios `portal-phone`,
  `portal-no-log`, `portal-refuses-deep-sleep`, `portal-and-ble-service`,
  ble-beacon `checkpoint-service`. Schema corpus: four checkpoint cases.
- `NetFox` hooks gain `on_up` (after the radio is up, before the window).

Hardware gates (runbook steps 20–26): the captive sheet on an iPhone and
an Android; RAM on the C3 with phones attached; `finds.csv` on a board
whose host holds the drive.

### Page 0.13.1 · foxlib 1.6.1 · foxlib-c 0.1.11 — recovery is a checkbox

`limits.recover` (default `true`; the Behavior tab's **enable automatic
recovery attempts**, FM foxes) switches the 1.6 recovery off as one thing
while it is being tested: the watchdog is not armed, a cycle that raises
stops the fox with a traceback as before, and `safemode.py` reads the key
from `fox.json` and leaves the board in safe mode. Re-tuning before every
transmission stays on either way. The card says what each state means and
whether the watchdog is set on Deploy. Simulator: `recovery-off` (the PWM
refusal ends `code.py`; a scenario may now expect `raises`). FM templates
1.1.2 / composite 0.2.2 (defaults carry the key).

### Page 0.13.0 · foxlib 1.6.0 · foxlib-c 0.1.11 — a fox that lasts the hunt

A field test of the XIAO ESP32-C3 + SA868 fox reported the foxes stopping
after a few hours. Nothing in the firmware could have raised its way to a
visible crash; the ways a fox goes quiet for the rest of a hunt are quieter
than that, and foxlib 1.6 closes each one:

- **Safe mode is now survivable.** A supply dip while the module keys
  (brownout) makes CircuitPython boot into safe mode, where `code.py` never
  runs again until someone power-cycles the board. A new `safemode.py`,
  written beside `code.py` with every foxlib install (`firmware/index.json`
  `root`), resets the board back into a normal boot after a 5 s pause for the
  supply to recover. It counts consecutive resets in `microcontroller.nvm`
  and gives up after 50; `foxlib.guard.healthy()` clears the count when a
  cycle completes, and the boot log notes any resets since the last one.
  Safe mode entered on purpose (reset pressed twice, a flash-write failure,
  a USB problem) is left alone.
- **Hardware watchdog** (`limits.watchdog_s`, 10–3600 or `null`; the C3
  defaults set 90 s; a field on Deploy). `cycle.run()` arms it and every wait
  in foxlib feeds it: `led.hold`, each tone event in `tones.Player.play`
  (an SSTV frame is one call), the cycle prologue. A hung interpreter (a
  console write nobody reads, a stuck peripheral) resets; `safemode.py`
  brings it back. Never armed by a bench `Fox(quiet=True)`; disarmed when the
  loop ends and in `Fox.deinit()`.
- **The module is re-tuned before every transmission** (`radio.ensure`): the
  DMO modules keep their channel in RAM only, so an SA868 that lost power
  comes back on its default channel and the fox sounds dead while the ESP32
  keys on happily. One `AT+DMOSETGROUP` per cycle (~150 ms); setup is redone
  first when the module never answered at boot. Status changes are logged
  (`radio noreply -> ok (re-tuned)`).
- **A cycle that raises is logged and the loop goes on** (PTT released,
  LED `fatal` for 5 s). `Tx.play` catches what the transmitter raises
  (`play failed (RuntimeError: …)`, `tx.failed`), so a template body never
  ends `code.py`. `gc.collect()` runs at the top of every cycle.
- Cycle timing is integer milliseconds from `time.monotonic_ns()`
  (`cycle._now_ms`, `radio.keyed_ms`, `led.hold`): CircuitPython floats have
  ~22 bits of mantissa, so `time.monotonic()` is only good to several ms
  after a few hours.

Simulator: a mocked watchdog (a wait that does not feed it fails the run),
`microcontroller.nvm`, and fault injection — `module_reset_at_s` (the
module forgets its channel; `keyed_on_default_max` counts key-ups on the
wrong channel), `module_silent_until_s`, `pwm_fail_at_s`. Shared scenarios
`soak-8h` (eight virtual hours under the watchdog, every template),
`module-reset`, `module-noreply-then-ok`, `play-raises`, `watchdog-off`.
Schema corpus: `watchdog_set/off/bad/float`.

Not changed, worth checking in the field: the C3 defaults have
`pins.batt_sense: null`, so there is no low-battery pause — a sagging pack
transmits until it browns out. Wire the divider and set the pin, or set
`battery.critical_v` for the pack in use.

### Page 0.12.1 · foxlib 1.5.0 · foxlib-c 0.1.11 — docs consolidated

Twelve documents under `docs/` become six, each the one place for its
subject:

- `docs/bench-runbook.md` now holds the network-fox tick-list (was
  network-fox-bench), a new board's first session (was
  first-hardware-session) and how recordings become CI tests (was
  bench-recordings): the one page at the bench.
- `docs/picofox.md` = picofox-hardware + picofox-notes: the
  hardware foxlib-c is written against, and what the vendor firmware does.
- `CONTRIBUTING.md` gains *Adding a target* (was adding-a-target) and
  *Releasing* (was releasing); its pre-push list points at
  `tests/README.md`, which owns the one copy; the still-open items of the
  October 2026 audit are listed there and the audit document itself is
  retired to the git history.

Every path in the tree (docs, Python/JS comments, the About tab) repointed;
`tools/check_docs.py` covers 15 documents. Three comments in
`firmware/foxlib-c/picofox/` still name the old picofox-hardware path; they
move with the next firmware change rather than bumping foxlib-c for a
comment. Page 0.12.1 for the About-tab text.

### Docs audit (2026-11-14) — no version change

An independent read of every document against the code; 39 findings,
all addressed. The hard constraints held (no `dc34fox` anywhere; no vendor
PicoFox files in the tree). Fixed: `docs/bench-runbook.md` pinned to 0.9.6 / foxlib
1.2.1 (now current, and `puzzle-beacon` in the network run); PROTOCOL.md
named `fox.radio.key()` (it is `key_for()`) and said nothing about the
NetFox bench calls, the board-clock write or the Listen-only port grant;
DESIGN.md said a chip target sees "all ten" templates and the Nano 33
`ble-beacon` only (the two contracts never mix; the counts are 7 / 4 / 2),
that Plan *and* Payload are hidden for a network fox (Payload holds the
four cards), that the picker is grouped by family, "Zigbee on the C5
only" (the C6 too), a `fox.py` that does not exist, a reserved
`wifi-beacon` payload, and "UF2 boards later"; the §2 layout, §5
`template.json` (`contract`, `radios`, `needs`) and §7 tabs now cover
variants, the wiring card, the contest cards, the deploy clock,
Disconnect-and-flash and the Listen-only reconnect. SECURITY.md names the
esptool-js jsDelivr fallback. CONTRIBUTING's bump table and pre-push list
match the lint and CI. "Three network foxes" is four in six places; the
plan's decisions section is restored (the pushed
copy had the pre-decision text), `portal.body` not `body_md`, hw_smoke
flags marked not built; the 2026-10 audit no longer says no tag exists;
flasher/README documents `expectChip` / `port` / `impl` / `chipId()`;
bench-recordings says how a `--sniffer` run replays; CONFIG's table marks
checkpoint/sense "accepted, not built"; hardware-log rows for 11-14 and
the C5/C6 serial check; a third party's callsign removed from
picofox-notes; the stale, untagged `firmware/foxlib-c/picofox/
foxbench-picofox.uf2` untracked (CI builds the real one).

### Page 0.12.0 · foxlib 1.5.0 · foxlib-c 0.1.11

**Contest features, phase C — how hard the fox is to find** (`stealth`
section, built). foxlib 1.5.0 `netstealth.py`:

- **MAC rotation**: a new locally administered address every cycle or once
  per boot (Wi-Fi AP, probe and BLE), logged per cycle.
- **Names at random** from the payload list; **timing jitter** of up to
  ±N s on each wake and sleep (the runner takes per-cycle overrides).
- **Silent start**: N s after power-on, or until a wall-clock time read
  against the board clock set at deploy (unset clock → logged, starts at
  once); a short LED blink every 3 s while waiting; the started state
  survives deep sleep (`alarm.sleep_memory`).
- **Decoys**: the access point walks through its name and up to four
  decoy SSIDs, 3 s each. **BLE only**: Wi-Fi off at boot, a split clue's
  Wi-Fi half dropped.
- Simulator: `ap_swap` / `wifi_disabled` / `alarm.sleep_memory` in the
  mocks, pending radio stops flushed at deep sleep and at the end of a
  run, new expectation kinds (`net_distinct_min/max`, `net_only_names`,
  `keyed_lengths_vary`, `first_key_after/before_ms`, `prints_count_max`,
  `net_events_max`, `net_contains_event`, `net_not_contains`); 11 stealth
  scenarios. The demo board prints the stealth lines.
- `docs/bench-runbook.md` steps 15–19; CONFIG.md stealth paragraph.

### Page 0.11.1 · foxlib 1.4.1 · foxlib-c 0.1.11

- Bench finding 2026-11-14: a network fox with the `N0CALL` placeholder
  was blocked at deploy even with "use the callsign as the name" unticked.
  A Part 15 device need not identify, so the placeholder is now a warning
  (no operator in the fleet record) and blocks only when it would be the
  name on the air; the banner's `id=` gains `none` for that case
  (`set` / `none` / `unset`); foxlib 1.4.1. ID-tab wording to match.
- CI (`ci.yml`, maintained by hand): the bench-replay step installs
  `pyserial` itself (it ran before the step that did), and the sim job
  runs `firmware/sim/test_netpayload.py`.


### Page 0.11.0 · foxlib 1.4.0 · foxlib-c 0.1.11

**Contest features, phase B — what the fox says** (`payload` section,
built). foxlib 1.4.0 `netpayload.py`:

- Names: `rotate` (one of the list per cycle, in order), `morse-name` (the
  Morse of a word as the SSID / BLE name, cut to 32 bytes at a space),
  `static`. The callsign-as-name switch still wins.
- BLE: an iBeacon `code` (major/minor), an **Eddystone-URL** frame (the
  phone offers to open it; a URL over 17 encoded bytes is logged and not
  sent) and an **Eddystone-TLM** frame (battery, frame count, uptime),
  rotated every `interleave_ms` while the radio is up.
- **Split clue**: the fox's other radio runs alongside with the other half
  of a clue as its name (Wi-Fi + BLE boards).
- New template **`puzzle-beacon`** (BLE; experimental): rotating names,
  code 1/1 and telemetry on by default — the contest beacon.
- Page: the payload card previews what is on the air (names for cycles
  0–2, the BLE frame order); the demo board prints the payload lines;
  `nameForCycle` / `morseName` in `netschema.js` mirror the firmware.
- Simulator: frame swaps recorded as `adv_swap` (not an unkey), 11
  payload scenarios incl. frame-byte goldens, `test_netpayload.py`
  (Eddystone encoding, TLM, Morse names; CI's sim job runs it since 0.11.1);
  parity corpus +2 (146).
- `docs/bench-runbook.md` steps 12–14; CONFIG.md payload paragraph.

### Page 0.10.0 · foxlib 1.3.0 · foxlib-c 0.1.11

**Contest features, phase A** (`docs/network-fox-payloads-plan.md`): the
scaffolding for payloads, checkpoints, sensing and stealth on the network
foxes — the contract, the forms, the clock, the simulator hooks. Nothing
transmits differently yet; the firmware for each section lands in phases
B–E and says so until then.

- `net` contract: optional `payload`, `checkpoint`, `sense`, `stealth`
  sections (CONFIG.md "Contest features"), validated by `netcfg.py` and the
  `netschema.js` twin (parity corpus +12, 144 identical). A section is in
  fox.json only while its card is on. foxlib 1.3.0: `netfeatures.py`
  attaches built features to the runner's `before_up` / `while_up` /
  `after_down` hooks; the banner gains `features=<sections>` and
  `clock=<time|unset>`, and a `note:` per section that is accepted but not
  built.
- Payload tab for network foxes: four cards (*What the fox says / serves /
  listens for / How hard it is to find*) with every field of the plan,
  byte counters, and the page checks for what would not work (a sign-in
  page with deep sleep, a start time with the clock unset, BLE frames on a
  Wi-Fi template, a split clue on a one-radio board, …).
- Deploy tab: **Set the board clock** — from this browser now, or a fixed
  time so every fox of a fleet gets the same one; remembered in the
  browser; `rtc.RTC().datetime` over the REPL before the files are written.
- `template.json` `needs`: what an organiser must provide (BLE tags, a
  sign…), shown on the Behavior and Deploy tabs and lint-checked.
- Simulator: `rtc` mock (`scenario.clock`), `prints_not_contain`, four
  phase-A scenarios; the demo board prints the new banner fields.
- Bench recordings survive a firmware or catalog release: the replay
  board keeps a small file store, answers the writes of files the
  recording never saw (a new foxlib module, a changed chunking) with the
  silence a real board gives, and answers each verify from the bytes
  written. `docs/bench-runbook.md` says so; `REPLAY_DEBUG=1` traces
  the matching.

### Page 0.9.7 · foxlib 1.2.1 · foxlib-c 0.1.11

- Network-fox Radio tab: the wiring table no longer overflows its card —
  pin notes are tooltips on the options instead of part of their labels,
  the help sits under the pin, three columns; the Board dropdown stays
  inside the card. Hint wording for Hidden SSID, the MAC field and deep
  sleep trimmed to what the page does ("not possible with this firmware
  (noted here and in the fox's banner)"; "locally administered and
  unicast").

### Page 0.9.6 · foxlib 1.2.1 · foxlib-c 0.1.11

- Fleet CSV: a cell that itself began with an apostrophe and a formula
  character (`'=…`) lost the apostrophe on the round trip; the writer now
  doubles it and the reader takes exactly one off. Import rejects a row
  with no `uid` by line instead of merging it with every other uid-less
  row at the same timestamp (`tools/check_fleet.py` agrees); `DESIGN.md`
  says which rows those are and that they do not travel through a CSV.


### Page 0.9.5 · foxlib 1.2.1 · foxlib-c 0.1.11

- **Fleet CSV comes back.** `fromCsv` parses what `toCsv` writes (and what
  the batch flasher writes, and what a spreadsheet does to either: BOM,
  CRLF, trailing blank line, every cell re-quoted) and takes off the
  apostrophe the writer puts in front of `= + - @` cells. **Import CSV**
  on the Fleet tab merges a file by `uid` + `timestamp`: new rows added,
  the same event counted as present and never overwritten, rows of the
  wrong shape reported with their line number, an unknown column refused
  by name. `tools/check_fleet.py` checks a file with the same rules from
  the terminal. Round trip, each rejection, and a spreadsheet-mangled
  file are unit-tested; the smoke imports its own export and a
  batch-flasher file.
- Fixed: a fleet cell containing a bare carriage return was written
  unquoted, which broke the row on read.


### Page 0.9.4 · foxlib 1.2.1 · foxlib-c 0.1.11

**foxlib-c 0.1.11** — `player.c`'s mailbox carries the play request pointer
as `uintptr_t` (was `uint32_t`: the same 32 bits on the RP2040, a truncated
pointer on the 64-bit host the new test runs on). No behaviour change on the
board.


- Tests: Playwright 1.49.1 → 1.65.0 (Chrome for Testing 158), the
  deliberate bump `CONTRIBUTING.md` describes; no change to the smoke or
  its fake serial port was needed. Node 20 stays (1.65 wants ≥ 20).

- The page's typefaces are served from `css/fonts/` (woff2, OFL 1.1,
  112 kB); the page makes no third-party request and works on a laptop
  with no internet. `LICENSES.md` lists them.
- The deploy stamps `?v=<VERSION>` onto the page's asset links
  (`tools/stamp_assets.py`, in the deploy and release jobs, self-tested in
  CI), so a new version is a new URL to a browser that cached the last one
  (audit: the mixed-version window). Bump `VERSION` on any user-visible
  change — `check_catalog --since` already insists (`CONTRIBUTING.md`).
- **A sniffer for the wifi-probe fox** (`tools/sniffer/code.py`, a second
  XIAO C3/C6 in monitor mode printing every probe request as line-JSON)
  and `hw_smoke.py --sniffer <port>`, which counts probe requests from the
  fox's MAC carrying its SSID during the observe window and fails the
  template at zero — the one network template a phone could not verify.
  `firmware/sim/pty_sniffer.py` stands in for the board in CI, which runs
  the positive and the silent-sniffer case; the 802.11 parser has its own
  test (`firmware/sim/test_sniffer_parse.py`).
- Tests: the real esptool-js through a whole flash — see 0.9.3's entry;
  the stub-mode fake, erase, compressed write and MD5 landed here.
- Tests: `player.c` on the host (`firmware/foxlib-c/tests/player_test.py`,
  in `make check`): the real core-1 code and `si5351.c`, core 1 a thread on
  the virtual clock, a fake I²C controller that decodes every offset write
  back to deviation counts. Morse for `PARIS` comes back off the bus edge
  for edge against `core_dump morse`; two plays, STOP, `max_samples`, the
  empty list, the flash bus hold, the attenuator word and a rev 2 board, a
  hung core 1 (core 0 unkeys by itself). Closes the audit's "player.c has no
  host test"; the FatFs/MSC path is what remains.


### Page 0.9.3 · foxlib 1.2.1 · foxlib-c 0.1.10

Pre-pause cleanup, 2026-11-06: documentation brought level with the tree,
and tests for the flasher's real transport, before the remaining boards go
on the bench.

- **Tests: the vendored esptool-js runs in CI** against a fake ESP32-C3 ROM
  and stub (`tests/unit/fake-rom-port.mjs`, `esptool-real.test.mjs`): the
  reset strategy per port kind (USB-JTAG vs classic DTR/RTS with its 100 ms
  hold), sync, chip identification, eFuse reads, baud change and port
  reopen; then the chip erase, the compressed write inflated into an
  in-memory flash, and esptool-js's own MD5 check over it — a byte-exact
  write passes, a corrupted one fails with the wrapper reporting
  `flash_ok: no`; the write offset; `eraseAll: false`; the wrong-chip
  refusal and the not-in-download-mode failure. `flash()` takes a `port`
  for this. What stays bench-only is the physical side.
- The page's typefaces are served from `css/fonts/` (woff2, OFL 1.1); no
  third-party request. The deploy stamps `?v=<VERSION>` onto the asset
  links (`tools/stamp_assets.py`), so a new version is a new URL to a
  browser that cached the last one; bump `VERSION` on any user-visible
  change (`CONTRIBUTING.md`).
- `tools/bench_queue.py`: the bench queue derived from the catalog and
  `docs/hardware-log.md`; `--check` in CI fails when a stable target has no
  row. Hardware descriptors may carry `log_names` for the match.
- Tests: `npm run smoke` reports per section and names the section an
  exception happened in. CI's pty bench run covers all seven FM templates,
  not three.
- Page: the remaining Board-tab handlers that awaited a device call with no
  catch go through `app.guard` (a rejection is a console line, audit W12);
  `parseBanner` and the catalog's board map are prototype-free, so a banner
  saying `board=__proto__` is a plain unknown id (`banner.test.mjs`).
- Catalog: a target must say `status` (`stable` | `experimental` |
  `planned`); absent used to mean stable. `seeed_xiao_esp32c3` says so.
- Docs: `project-audit-2026-10.md` has a 2026-11-06 status block — most of
  the "open" page items were fixed in 0.7–0.9 and are now listed as such,
  with what remains; `CONTRIBUTING.md`: experimental targets on `main` are
  the gate; `releasing.md` lists the
  pinned tooling (Arm toolchain, Pico SDK, esptool-js, Playwright).


### Page 0.9.2 · foxlib 1.2.1 · foxlib-c 0.1.10

- Bench finding 2026-10-26: flashing a second board while the page was
  still connected to the first left the Flash button disabled, its reason
  only in a tooltip. With a REPL / console / listen session open the button
  now reads **Disconnect and flash** and does exactly that — closes the
  session (console line), then asks for the port to flash. Same on the
  Batch flashing card. A drive session is left
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
- `fox.json` (`net` contract): `board` is the chip target, new `variant`
  and `pins` (`led`, `batt_sense`; CONFIG.md); the firmware takes the LED
  from `pins.led` (null = no LED, as on the bare XIAO C3) and reports a
  name the board lacks as `partial(pins.led)`. foxlib 1.2.0. Simulator:
  LED edges checked per variant; per-chip defaults; `check_catalog`: chip
  targets, variants, one radio set per chip, shared builds only within a
  chip when both declare `shared_build`, net defaults' pins match the
  default variant. `tools/hw_smoke.py --board <chip> --variant <hardware>`.
- `docs/bench-runbook.md`: the per-board bench list; hardware-log table
  of the seven boards and the build each runs; `CONTRIBUTING.md`
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

- Three boards behind "Show experimental targets": DFRobot FireBeetle 2
  ESP32-C5, Waveshare ESP32-S3-Nano (via the ROM's download mode) and Seeed
  XIAO ESP32C6. Serial over native USB confirmed on the C5 and C6.
- Hardware descriptors carry the battery auto-off and serial-during-sleep
  notes for boards that deep-sleep between transmissions.

### Page 0.7.12 · foxlib 1.0.4 · foxlib-c 0.1.10

- The Board picker lists only targets verified on hardware. Targets with
  status `experimental` sit behind a **Show experimental targets** checkbox
  (remembered per browser; a selected target is always listed). Nothing is
  removed: a release of this page is what the hardware log vouches for.

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


Two bugs the new tests found:

- **A page whose saved working form was an experimental target did not
  boot** (blank page, `renderRadio … reading 'cfg'`): the Radio/Plan/Schedule
  tabs rendered at boot before the ID tab had initialised a shared UI
  module. Each tab now initialises it itself.
- **The flasher would have refused a real ATOM Lite.** `chipId()` turned
  esptool's "ESP32-PICO-D4" / "ESP32-D0WDQ6" into `esp32picod4` /
  `esp32d0wdq6`, not `esp32`, so the chip check would have reported "the
  port belongs to an ESP32-PICO-D4, but the selected board is an ESP32" and
  stopped. The classic ESP32's package variants now map to `esp32`; the old
  unit test had encoded the bug.
- `setTemplate` with carry no longer assumes a `payload` section.

Tests: the test server can play a deployed site (CI-written fingerprint),
so the hosted-image paths run in the smoke — fingerprint shown, image
accepted when it matches, refused with the "mid-deploy" hint when it does
not. The simulated esptool can fail to
connect or to start its stub (unit-tested); `send()` has a unit test; three
smoke asserts that could not fail now can, and two sleeps are waits.

### Page 0.7.9 · foxlib 1.0.4 · foxlib-c 0.1.9

Regroup after the 2026-10-22 test and documentation reviews. Code:

- The simulated esptool records the write address and the tests read it.
- `ReplLink.interrupt()` from raw mode sends Ctrl-B first instead of a 4.5 s
  Ctrl-C dance — every XIAO Bench action after a read paid it. Timeouts are
  injectable; the unit suite dropped from 49 s to 11 s.
- A refused deploy no longer leaves the button at "Writing…" (the blocker
  is checked before `busy`); the listen-only device swap is awaited.
- A simulated flash (test mode) says so in the log.

Documentation, from the same review:

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
`usb_descriptors.c`.

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
0.1.8 are described under their own headings in the commit history.

### Page 0.7.0–0.7.4 · foxlib 1.0.3 · foxlib-c 0.1.7–0.1.8

- **Catalog packs** (`?pack=<url>`): another repository's hardware, targets,
  templates and defaults loaded over this site's, data only, linted with
  `check_catalog.py --pack` (`tests/fixtures/pack/`).
- 1200-baud touch: the picked port's USB ids are checked against the
  hardware descriptor; "port gone"/"still there" verdicts.
- foxlib-c 0.1.8: `correction_ppm` applied; `fox_drive_changed` by content;
  banner via `con_puts`; build date = commit author date.

### Page 0.6.2 · foxlib 1.0.3 · foxlib-c 0.1.7

The October 2026 audit (its document is in the git history; the open items are in CONTRIBUTING.md) and what followed it.

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
