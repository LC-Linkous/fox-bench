# fox-bench

A browser workbench for small amateur-radio fox transmitters (CircuitPython
board + NiceRF SA868). Configure a fox, write its firmware and settings
over USB, hear and see what it will transmit before it goes on the air,
test it on the bench, and keep a log of the fleet. Chrome or Edge; nothing
to install.

**Use it:** https://lc-linkous.github.io/fox-bench/ — *Try without
hardware* runs the whole page against a simulated board.

Status: **v0.2 — firmware milestone.** `foxlib` is implemented and every
template passes the simulator (`python3 firmware/sim/run.py`: 92 scenario
runs on mocked hardware with a virtual clock), and the Python and JS
encoders emit byte-identical event streams (`firmware/sim/parity.*`). Not
yet run on a real board — that is the next step.

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
| `tools/batch_flash.py` | headless CircuitPython batch flasher, same CSV as the Fleet tab |

## Running locally

```
python -m http.server 8000
```
then open http://localhost:8000/ — module scripts don't load from `file://`.

## Licensing

GPL-2.0 for the page, tools and docs (`LICENSE`). GPL-3.0-or-later for
everything under `firmware/` (`firmware/LICENSE`). See DESIGN.md §9.
