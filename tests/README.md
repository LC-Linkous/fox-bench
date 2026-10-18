# Tests

Three layers, each runnable alone. CI runs all of them on every push
(`.github/workflows/page.yml` and `firmware.yml`).

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
