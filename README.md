# fox-bench

A browser workbench for small amateur-radio fox transmitters: CircuitPython
boards with a NiceRF SA868 running our firmware, and drive-configured foxes
such as the AI6YM PicoFox running theirs. Configure a fox, write its firmware and settings
over USB, hear and see what it will transmit before it goes on the air,
test it on the bench, and keep a log of the fleet. Chrome or Edge; nothing
to install.

**Use it:** https://lc-linkous.github.io/fox-bench/ — *Try without
hardware* runs the whole page against a simulated board.

Status: **v0.18 — three device families, two contracts.** All seven FM templates have been
deployed from the page to a XIAO ESP32-C3 + SA868 and run on both 2 m and
70 cm (checked with `tools/hw_smoke.py`; `docs/hardware-log.md` records
what was verified on which board, when, with which firmware); CircuitPython itself can be flashed
onto a bare board from the Board tab, one at a time or as a batch. The
same CircuitPython firmware also runs **network foxes** — a Wi-Fi access
point, a Wi-Fi probing station or a BLE iBeacon on a duty cycle, with the
callsign or a configured name as the SSID / device name and a chosen MAC —
on bare boards with no radio module, listed by chip (ESP32-C3, -C6, -C5,
-S3, nRF52840: the XIAO C3 / C6 / C5 / S3, the Waveshare ESP32-S3-Nano,
the FireBeetle 2 ESP32-C5, the Arduino Nano 33 BLE). On top of the three
beacons, the network foxes carry contest features configured per fox on
the Payload tab — what the fox says (rotating names, codes, Eddystone
frames, split clues), what it serves (a captive sign-in page with a code
and a find log, a BLE service), what it listens for (hunter tags, another
fox, a crowd, who joins or probes) and how hard it is to find (MAC and
name rotation, channel and power varying per wake, mode rotation, a
shell game across the fleet, scheduled start and stop) — plus an event
sheet of what every fox shows on the air and a handoff from one fox to the
next, FM or network (`docs/network-fox-payloads-plan.md`). These five
templates (three beacons, `puzzle-beacon`, `checkpoint`) and the five chip
targets are **experimental** until a hardware-log row says a phone has
found them. The
AI6YM PicoFox is supported two ways: with its **vendor firmware** (the page
writes its settings, renders its audio and Morse-ID files, and draws the
cycle that firmware runs — verified on air, `docs/picofox.md`), and
with **fox-bench's own firmware** (`firmware/foxlib-c/`, GPL-3.0-or-later:
`fox.json`, every template the CircuitPython foxes have including SSTV, FM
at 8 kHz with pre-emphasis, banner and bench buttons over its serial
console; flashed from the Board tab as a UF2 and swapped with the vendor's from
the same card — on the air on a rev 3 board since October 2026, with Morse +
songs and Morse + SSTV verified there and the rest run in the host tests). Every push runs three test layers in CI: the firmware
simulator (`firmware/sim/`), the REPL protocol against a fake board and
the page itself in headless Chromium (`tests/`), and a lint of every
descriptor (`tools/check_catalog.py`); the site deploys from `main` only
after all three passed, carrying the UF2 that run built
(`.github/workflows/ci.yml`). See `tests/README.md`; releases are tags
(`CONTRIBUTING.md`, `CHANGELOG.md`).

| | |
|---|---|
| `DESIGN.md` | architecture: descriptors, templates, foxlib, tabs |
| `CONFIG.md` | the `fox.json` contract, validated by the page and the firmware |
| `PROTOCOL.md` | the raw-REPL exchange, byte by byte |
| `index.html`, `css/`, `js/` | the page (no build step, ES modules) |
| `hardware/`, `boards/`, `modules/`, `bands.json` | descriptors: physical designs, targets (hardware + firmware + family), radio modules, band plans |
| `firmware/foxlib/` | shared firmware library |
| `firmware/templates/<id>/` | one `code.py`, manifest and per-board defaults per fox behaviour |
| `firmware/sim/` | simulator: mocked hardware, virtual clock, scenarios, Python/JS parity |
| `firmware/sim/pty_board.py` | the simulated board on a pseudo-terminal, for testing serial tools without hardware |
| `tests/` | page smoke test (Playwright) and REPL protocol tests (fake board) |
| `tools/check_catalog.py` | lint for every descriptor, defaults file and index; runs in CI |
| `tools/hw_smoke.py` | bench script: every template on a real board, banner + bench + memory, JSON report |
| `tools/sniffer/` | CircuitPython for a second board: prints every Wi-Fi probe request it hears as line-JSON, so `hw_smoke.py --sniffer` can verify the wifi-probe fox over the air |
| `tools/replay_check.py` | replays a `hw_smoke.py --record` file into the pty board and checks it (`docs/bench-runbook.md`) |
| `tools/bench_queue.py` | what the next bench sessions have to show, derived from the catalog and `docs/hardware-log.md`; `--check` runs in CI |
| `tools/session_close.py` | after a `hw_smoke.py` run: the hardware-log row and the `boards_tested` additions, from the report (`docs/bench-runbook.md`) |
| `flasher/` | CircuitPython flashing component (esptool-js bundled; Apache-2.0, licensed separately) |
| `tools/batch_flash.py` | headless CircuitPython batch flasher, same CSV as the Fleet tab |
| `tools/check_fleet.py` | checks a fleet CSV with the same rules as the Fleet tab's import |
| `tools/check_catalog.py`, `tools/check_docs.py`, `tools/check_ci.py` | the lints CI runs: descriptors and version bumps, paths named in the docs, the workflow file |
| `docs/build-and-flash.md` | the pipeline in diagrams: the three families, how a template becomes files on a board, which foxlib files go, source vs `.mpy`, what CI builds on every push and what is pinned where |
| `docs/bench-runbook.md` | the one page for the bench: the queue as commands, what each should print, the network-fox tick-list, a new board's first session, how recordings become CI tests |
| `docs/picofox.md` | the PicoFox: its hardware from the schematic (what foxlib-c is written against) and what its vendor firmware reads and does (the drive family) |
| `docs/network-fox-payloads-plan.md` | plan for contest payloads on the network foxes: puzzles, checkpoint portal, sensing, stealth |

## Running locally

```
python -m http.server 8000
```
then open http://localhost:8000/ — module scripts don't load from `file://`.

Tests: the full local sequence is in `tests/README.md` (catalog and docs
lint, the two simulators, the C firmware's host tests, the page's unit and
smoke suites); CI runs the same.

Reading the code: `CONTRIBUTING.md` opens with a map — which three to five
files to read, in order, for each thing you might have come to do.

## Licensing

Three pieces, three licences: the page **GPL-2.0-only** (`LICENSE`),
everything under `firmware/` — foxlib and foxlib-c — **GPL-3.0-or-later**
(`firmware/LICENSE`), the flasher under `flasher/` **Apache-2.0**
(`flasher/LICENSE`). What each bundles (esptool-js, FatFs, the Pico SDK
and TinyUSB in the built UF2) and what is deliberately *not* here (the
PicoFox hardware and vendor firmware, CC BY-NC-SA 4.0) is listed in
`LICENSES.md`.
