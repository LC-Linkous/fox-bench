# fox-bench

A browser workbench for small amateur-radio fox transmitters (CircuitPython
board + NiceRF SA868). Configure a fox, write its firmware and settings
over USB, hear and see what it will transmit before it goes on the air,
test it on the bench, and keep a log of the fleet. Chrome or Edge; nothing
to install.

**Use it:** https://lc-linkous.github.io/fox-bench/ — *Try without
hardware* runs the whole page against a simulated board.

Status: **v0.2 — running on hardware.** The first XIAO ESP32-C3 + SA868
foxes have been deployed from the page and heard on the air (morse-songs);
the other templates are verified in the simulator and awaiting their turn
on the bench. Every push runs three test layers in CI: the firmware
simulator (`firmware/sim/`), the REPL protocol against a fake board and
the page itself in headless Chromium (`tests/`), and a lint of every
descriptor (`tools/check_catalog.py`). See `tests/README.md`.

| | |
|---|---|
| `DESIGN.md` | architecture: descriptors, templates, foxlib, tabs |
| `CONFIG.md` | the `fox.json` contract, validated by the page and the firmware |
| `PROTOCOL.md` | the raw-REPL exchange, byte by byte |
| `index.html`, `css/`, `js/` | the page (no build step, ES modules) |
| `boards/`, `modules/`, `bands.json` | descriptors the page renders from |
| `firmware/foxlib/` | shared firmware library |
| `firmware/templates/<id>/` | one `code.py`, manifest and per-board defaults per fox behaviour |
| `firmware/sim/` | simulator: mocked hardware, virtual clock, scenarios, Python/JS parity |
| `firmware/sim/pty_board.py` | the simulated board on a pseudo-terminal, for testing serial tools without hardware |
| `tests/` | page smoke test (Playwright) and REPL protocol tests (fake board) |
| `tools/check_catalog.py` | lint for every descriptor, defaults file and index; runs in CI |
| `tools/hw_smoke.py` | bench script: every template on a real board, banner + bench + memory, JSON report |
| `tools/batch_flash.py` | headless CircuitPython batch flasher, same CSV as the Fleet tab |
| `docs/first-hardware-session.md` | checklist for a new board, module or CircuitPython build |

## Running locally

```
python -m http.server 8000
```
then open http://localhost:8000/ — module scripts don't load from `file://`.

Tests: `python3 firmware/sim/run.py` · `python3 tools/check_catalog.py` ·
`cd tests && npm ci && npx playwright install chromium && npm test`.

## Licensing

GPL-2.0 for the page, tools and docs (`LICENSE`). GPL-3.0-or-later for
everything under `firmware/` (`firmware/LICENSE`). See DESIGN.md §9.
