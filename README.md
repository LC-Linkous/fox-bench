# fox-bench

A browser workbench for small amateur-radio fox transmitters: CircuitPython
boards with a NiceRF SA868 running our firmware, and drive-configured foxes
such as the AI6YM PicoFox running theirs. Configure a fox, write its firmware and settings
over USB, hear and see what it will transmit before it goes on the air,
test it on the bench, and keep a log of the fleet. Chrome or Edge; nothing
to install.

**Use it:** https://lc-linkous.github.io/fox-bench/ — *Try without
hardware* runs the whole page against a simulated board.

Status: **v0.7 — four device families.** All seven FM templates have been
deployed from the page to a XIAO ESP32-C3 + SA868 and run on both 2 m and
70 cm (checked with `tools/hw_smoke.py`; `docs/hardware-log.md` records
what was verified on which board, when, with which firmware); CircuitPython itself can be flashed
onto a bare board from the Board tab, one at a time or as a batch. The
AI6YM PicoFox is supported two ways: with its **vendor firmware** (the page
writes its settings, renders its audio and Morse-ID files, and draws the
cycle that firmware runs — verified on air, `docs/picofox-notes.md`), and
with **fox-bench's own firmware** (`firmware/foxlib-c/`, GPL-3.0-or-later:
`fox.json`, every template the CircuitPython foxes have including SSTV, FM
at 8 kHz with pre-emphasis, banner and bench buttons over its serial
console; flashed from the Board tab as a UF2 and swapped with the vendor's from
the same card — on the air on a rev 3 board since October 2026). The fourth
family, **compiled**, is for the RF Hackers Sanctuary's
[kitsune](https://github.com/rfhs/kitsune) foxes — Wi-Fi AP and client, BLE
iBeacon, Bluetooth Classic and Zigbee on five ESP32-family boards — whose
configuration is compiled in: the page prepares and checks it with the
same forms and exports the conference header their build reads; flashing
and per-fox configuration are planned (`docs/kitsune-integration-plan.md`).
kitsune belongs to its authors and nothing of it is included here. Every push runs three test layers in CI: the firmware
simulator (`firmware/sim/`), the REPL protocol against a fake board and
the page itself in headless Chromium (`tests/`), and a lint of every
descriptor (`tools/check_catalog.py`); the site deploys from `main` only
after all three passed, carrying the UF2 that run built
(`.github/workflows/ci.yml`). See `tests/README.md`; releases are tags
(`docs/releasing.md`, `CHANGELOG.md`).

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
| `flasher/` | CircuitPython flashing component (esptool-js bundled; Apache-2.0, licensed separately) |
| `tools/batch_flash.py` | headless CircuitPython batch flasher, same CSV as the Fleet tab |
| `docs/first-hardware-session.md` | checklist for a new board, module or CircuitPython build |
| `docs/picofox-notes.md` | what the PicoFox's vendor firmware reads and does; the basis of the drive family |
| `docs/picofox-hardware.md`, `firmware/foxlib-c/` | the PicoFox hardware from its schematic, and fox-bench's own firmware for it (the foxlib-c family) |

## Running locally

```
python -m http.server 8000
```
then open http://localhost:8000/ — module scripts don't load from `file://`.

Tests: `python3 firmware/sim/run.py` · `python3 tools/check_catalog.py` ·
`cd tests && npm ci && npx playwright install chromium && npm test`.

## Licensing

Three pieces, three licences: the page **GPL-2.0-only** (`LICENSE`),
everything under `firmware/` — foxlib and foxlib-c — **GPL-3.0-or-later**
(`firmware/LICENSE`), the flasher under `flasher/` **Apache-2.0**
(`flasher/LICENSE`). What each bundles (esptool-js, FatFs, the Pico SDK
and TinyUSB in the built UF2) and what is deliberately *not* here (the
PicoFox hardware and vendor firmware, CC BY-NC-SA 4.0) is listed in
`LICENSES.md`.
