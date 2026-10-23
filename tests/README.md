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

Setup for the Node tests (once): `cd tests && npm ci && npx playwright
install --with-deps chromium` (`--with-deps` pulls Chromium's system
libraries on a fresh Linux box; on macOS and Windows plain `install
chromium` is enough). The smoke test also needs `gcc`, `make` and
`python3`: it boots the exported foxlib-c deploy set in the C host build
(`make -C firmware/foxlib-c/tests build/host_sim`) and the Python one in
`firmware/sim/run.py`. The smoke also drives the page's real transports
through a fake Web Serial port (`tests/page/fake-serial.mjs`: a port whose
bytes come from `FakeBoard` or `FakeConsoleLink`) — Connect over the REPL
and a deploy through it, Listen only with banner-follow and the device
swap, a port drop, the 1200-baud touch on the right and the wrong port —
and a fake bootloader drive for the UF2 copy (refusal on the fox's own
drive; the drive vanishing mid-close). Chromium can be pointed at an existing build with
`CHROMIUM=/path/to/chrome npm run smoke`.

Everything CI runs, locally, from the repository root:

```
python3 tools/check_catalog.py --since origin/main && python3 tools/check_docs.py
python3 tools/check_ci.py && python3 tools/build_kitsune.py --selftest
python3 tools/check_catalog.py --manifest tests/fixtures/kitsune/manifest.json
python3 firmware/sim/run.py
make -C firmware/foxlib-c/tests check
cd tests && npm run unit && npm run smoke
```

(The firmware itself needs the Arm toolchain named in
`firmware/foxlib-c/README.md`; the tests above do not. `check_ci.py` needs
PyYAML.) `--since` is the version-bump lint: give it the base of the series
you are about to push, not `HEAD`, or a bump missing from an earlier commit
goes unnoticed until CI.

CI guards that exist because of a real slip: `check_ci.py` (a duplicate `if:`
made GitHub refuse the workflow, which showed up as no run at all);
`build_info.py` reads `FOXLIBC-VERSION:` out of the built UF2 and fails when it
differs from `firmware/foxlib-c/VERSION` (CMake had read the file once, at
configure time); `check_catalog.py --since` counts `hardware/` and `boards/` as
page files (a USB id in a descriptor drives the 1200-baud touch) and compares
the fox-bench firmware's USB ids with `usb_descriptors.c`;
`check_catalog.py --manifest` pins a merged kitsune image at offset 0x0.

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
