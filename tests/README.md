# Tests

Three layers, each runnable alone. CI runs all of them on every push as
the `page`, `sim` and `foxlib-c` jobs of `.github/workflows/ci.yml`; the
`deploy` job (Pages, `main` only) needs all three, so a red layer leaves
the live site as it was.

| What | Where | Run |
|---|---|---|
| Firmware behaviour (every template × scenario on mocked hardware), encoder parity Python↔JS | `firmware/sim/` | `python3 firmware/sim/run.py` |
| REPL protocol and device layer against a fake CircuitPython board | `tests/unit/` | `cd tests && npm run unit` |
| The page itself, every tab × every template on the demo board, in headless Chromium; the zips it exports are unpacked and booted in the firmware simulator (`run.py --deploy-set`) | `tests/page/` | `cd tests && npm run smoke` |

Setup for the Node tests (once): `cd tests && npm ci && npx playwright install chromium`.

`SHOTS=/some/dir npm run smoke` also saves a screenshot of every tab, which
CI keeps as an artifact for a week — useful for seeing what a failure looked
like, and for a quick visual diff after a CSS change.

## The fake board

`tests/unit/fake-board.mjs` is a `Link` that speaks CircuitPython's REPL
protocol with the quirks real XIAO ESP32-C3s show. It is not a Python
interpreter: code run in raw mode goes to a handler that recognises the
exact snippets `js/device/repl-device.js` sends and answers them from an
in-memory filesystem. Changing a snippet in `repl-device.js` therefore
fails these tests until the fake learns the new one — that is intended;
the snippets are the wire protocol.

Options worth knowing: `running` (fox transmitting when the port opens),
`ctrlCIgnores`, `ansi`, `noise`, `chunk`, `latency`, `dropPrompt`,
`execDelay`, `bootLog`, `files`.

## What is not tested here

Anything that needs a real board: USB enumeration, Web Serial permission,
timing of the real CircuitPython VM, RF. `tools/hw_smoke.py` covers that
from the bench, and `docs/first-hardware-session.md` is the manual
checklist.

## foxlib-c (the native firmware)

`make -C firmware/foxlib-c/tests check` builds the portable core and the
PicoFox runner for the host and runs two suites: `parity.py` (C encoders,
scheduler and validator against foxlib and against the page's validator) and
`sim.py` (the runner through `firmware/sim/scenarios.json`, judged by the
simulator's decoder). The page smoke test boots a deploy set exported for the
`picofox-foxlibc` target in the same host simulation, so a page change that
breaks what the firmware reads fails CI. The firmware itself is cross-compiled
in the `foxlib-c` job (UF2 as an artifact); the `deploy` job puts that same
artifact into the site.
