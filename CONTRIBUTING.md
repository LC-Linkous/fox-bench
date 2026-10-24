# Contributing

fox-bench is one person's workbench that other people are welcome to use
and extend. This page is the short version of how changes get in; the
long versions are `docs/adding-a-target.md` (new hardware, firmware or
templates), `tests/README.md` (what the tests cover) and
`docs/releasing.md` (tags).

## Branches

- `main` is what the live page is built from, and what the hardware log
  vouches for. Every push to `main` runs CI and, when every job is green,
  deploys the page and the firmware it built.
- Work that is not yet verified on hardware lives on a branch (the kitsune
  family is on `kitsune`). Branches run the tests but do not deploy.
- A change comes in as a pull request against the branch it belongs to,
  with the local sequence below green first.

## Before you push

From the repository root (details and prerequisites in `tests/README.md`):

```
python3 tools/check_catalog.py --since origin/main && python3 tools/check_docs.py
python3 tools/check_ci.py && python3 tools/build_kitsune.py --selftest
python3 firmware/sim/run.py
make -C firmware/foxlib-c/tests check
cd tests && npm run unit && npm run smoke
```

`--since origin/main` is the version-bump lint: give it the base of what
you are about to push, not `HEAD`.

## When to bump what

Three version lines move independently (the table at the top of
`CHANGELOG.md`). The lint refuses a push that changes one without bumping
it:

| you changed | bump |
|---|---|
| anything the browser loads — `js/`, `css/`, `index.html`, `flasher/`, `hardware/`, `boards/` | `const VERSION` in `js/main.js` |
| `firmware/foxlib/` or a template's `code.py` | `firmware/foxlib/VERSION` (and the template's `version`) |
| `firmware/foxlib-c/core` or `picofox` | `firmware/foxlib-c/VERSION` |
| only docs, tests or tools | nothing |

Add a line under `## Unreleased` in `CHANGELOG.md` for anything a user of
the page or the firmware would notice.

## When to add a hardware-log row

Whenever a board was on the bench for a change: a row in
`docs/hardware-log.md` with the date, board and revision, firmware version
**and the build's commit or sha256**, page version, what was checked, how
(instrument, distance), and the result. That row is the evidence behind a
target's `status: stable` and a template's `boards_tested`; the lint ties
the two together. A target stays `experimental` — and off the Board picker
unless "Show experimental targets" is ticked — until it has one.

## What not to put in the repository

- The vendor PicoFox firmware or anything from its hardware files
  (CC BY-NC-SA 4.0); the page fetches the firmware from the vendor's GitHub
  at a pinned commit and never hosts it.
- Anything of kitsune's (`LICENSES.md`): descriptors describe their boards,
  the vendor model describes their header; their code is built in CI only
  as a run artifact, with fox-bench's own bench configuration, and hosted
  only if they agree.
- An event's real fox configuration — SSIDs, keys, MACs, frequencies. The
  bench values are labelled as such (`FOXBENCH …`, `F2:B0:…`); keep it
  that way.
- Secrets of any kind. CI has none; the deploy uses GitHub's own token.

## Licences

Page and tools GPL-2.0-only, `firmware/` GPL-3.0-or-later, `flasher/`
Apache-2.0 (`LICENSES.md`). Every source file carries an
`SPDX-License-Identifier` line; a new file gets the licence of the
directory it lives in. By contributing you agree your change is under that
licence.

## Reporting

Bugs: the issue template asks for the diagnostics block from the Board tab
(copies the catalog versions, the device state and the last console
lines). Hardware results: the hardware-report template, or a row in the
hardware log in a PR. Security: `SECURITY.md`.
