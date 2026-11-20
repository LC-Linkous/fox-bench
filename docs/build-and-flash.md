# How a fox gets built and flashed

What is compiled, what is not, where each piece is built, and what the page
writes to a board. `DESIGN.md` is the map of the repository; this is the
map of the pipeline. Boxes are files; arrows are who moves them.

## 1. The four families, and what "firmware" means in each

```
  family      the fox's program            where it is built        what the page writes to the board
  ─────────   ──────────────────────────   ──────────────────────   ─────────────────────────────────────────
  foxlib      CircuitPython: foxlib/*.py   not compiled (source),   code.py, fox.json, defaults.json, foxlib/
              + a template's code.py       or .mpy by CI (§4)       (as .py, or .mpy), safemode.py, [boot.py],
                                                                    [settings.toml], [payload files]
  foxlib-c    C: firmware/foxlib-c/        CI → foxbench-picofox    fox.json + defaults.json onto the FOXBENCH
              picofox (the PicoFox)        .uf2 (§5)                drive; the firmware reloads itself
  drive       the vendor's own firmware    not ours                 settings.txt, audio.wav, .callsign.wav and
              (AI6YM PicoFox)                                       the marker file, onto its drive
  compiled    kitsune (rfhs/kitsune), the  CI from a pinned         nothing (phase 2): a conference header block
              config compiled in           upstream commit, gated   to export; images flashed by hand
```

Two different things get "flashed" and the words matter:

- **The platform**: CircuitPython itself (`adafruit-circuitpython-<board>-<ver>.bin`)
  on an ESP32, or the UF2 bootloader's drive on an RP2040. This is Adafruit's
  build, downloaded by you from circuitpython.org and loaded into the page
  (the site cannot fetch it for you). The page flashes it with esptool.js over
  Web Serial. Done once per board, or when a newer CircuitPython is wanted.
- **The fox**: everything in the right-hand column above. Written over the
  REPL (foxlib), onto a drive (foxlib-c, drive), or not at all (compiled).
  Done on every Deploy. Nothing is compiled on your machine at this step.

## 2. A template, from repository to board

```
   firmware/templates/<id>/                           the page (Deploy)                        the board
   ┌──────────────────────────────┐
   │ template.json                │  sections, families, pins, capabilities ──► form tabs, checks
   │ code.py                      │──────────────────────────────── copied as is ─────────────────► /code.py
   │ defaults/<target>.json       │──── copied as is ──────────────────────────────────────────────► /defaults.json
   └──────────────────────────────┘        │
                                           ▼
                                    form ⊕ defaults ──► validate (js/model, the same rules as foxlib/cfg.py
                                                        and netcfg.py: schema parity is a CI step) ──────────► /fox.json
   firmware/foxlib/*.py  ─────────────── the template's set only (§3) ───────────────────────────────────────► /foxlib/
   firmware/safemode.py  ─────────────── when recovery is on ───────────────────────────────────────────────► /safemode.py
   firmware/boot.py      ─────────────── CIRCUITPY-drive boards (writable filesystem) ──────────────────────► /boot.py
   payload sources       ─────────────── rendered in the page (SSTV image, songs) ──────────────────────────► /payload/…
```

`code.py` is tiny and generic: it imports foxlib and runs a `Fox` (FM) or
`NetFox` (network) on `fox.json`. Everything a template *is* lives in
`template.json` (what the form offers) and `defaults/<target>.json` (the
numbers for that board). The board reads `fox.json` on top of
`defaults.json`; a missing or broken key falls back to the default and the
banner says `cfg=partial(...)`.

There is no build step for a template. Adding one is three files and a
catalog entry; `tools/check_catalog.py` checks the rest.

## 3. What goes into `foxlib/` on the board

Not all of foxlib. The import graph decides:

```
   code.py ──► foxlib.Fox(…)          ──► "fm"  set: __init__ cfg report radio tones melody sstv battery schedule led cycle guard morse
   code.py ──► foxlib.netfox.NetFox(…) ──► "net" set: __init__ guard led report netcfg netradio netfox netfeatures netvary netmodes
                                                       netpayload morse netsense netcheckpoint netstealth
```

`tools/foxlib_deps.py --write` walks `from . import …` from each template's
`code.py` and writes the sets into `firmware/index.json`; `check_catalog`
fails if the tree and the sets disagree. Deploy writes the set and removes
the rest of `foxlib/` from the board as stale, so a board carries only what
it runs. Files on flash cost nothing at runtime — only imports do — so this
is about deploy time and a board that looks like what it is, not memory.

## 4. Source or bytecode: the `.mpy` set

A CircuitPython board compiles each `.py` when it is imported, and the
compiler's peak heap is several times the source. On the ESP32-C3 that peak,
on top of the Wi-Fi and BLE stacks, is more than the board has. A `.mpy` is
the same module already compiled to bytecode: no compile on the board, about
a third of the size.

```
   firmware/foxlib/*.py ──► mpy-cross (CircuitPython's own, for the pinned tag) ──► firmware/mpy/<major>/foxlib/*.mpy
                                                                                      + manifest.json (source hashes)
                                                                                      + index.json (which majors exist)
```

- **Built by CI, never committed.** The `sim` job runs `tools/build_mpy.py`
  on every push, fetching `mpy-cross` for the tag in `firmware/mpy/pins.json`
  (`{"10": "10.3.2"}`) from Adafruit's S3, the way the library bundle is
  built; the deploy job stages the result at `firmware/mpy/` on the site,
  beside the PicoFox UF2. `firmware/mpy/<major>/` and `index.json` are
  gitignored; `pins.json` is the only source.
- **One set per CircuitPython major.** A `.mpy` is bytecode only, so it loads
  on any build of the same major; majors are not mutually compatible
  (Adafruit ships 9.x and 10.x bundles separately for the same reason).
- **A Deploy checkbox, not a mode.** *Precompiled (.mpy)* writes
  `foxlib/*.mpy` instead of `*.py` (same set, `VERSION` as is) and removes the
  `.py` — CircuitPython imports a `.py` before a `.mpy` of the same name, so
  one left behind would win. Unticked writes the sources and removes the
  `.mpy`. A board can go back and forth, and the banner's `mem=` compared.
- The checkbox is disabled, with the reason, when the site has no set for
  the connected board's CircuitPython major, or the set is another foxlib
  version. On the hosted page that only happens between a push and the end
  of its CI run. A checkout has no set until `python3 tools/build_mpy.py`.
- The simulator always runs the sources; `.mpy` changes what is written,
  not what the fox does.

## 5. The PicoFox's firmware (foxlib-c)

```
   firmware/foxlib-c/picofox/*.c ──► CI: arm-none-eabi-gcc + pico-sdk at pinned versions ──► foxbench-picofox.uf2
                                                                                               + foxbench-picofox.json (fingerprint, RAM budget)
   the site: firmware/foxlib-c/picofox/foxbench-picofox.uf2 ──► Flash tab ──► the RP2040's BOOTSEL drive (a file copy)
   the page: fox.json + defaults.json ──► the FOXBENCH drive ──► the firmware reloads and prints its banner
```

Same pattern as the `.mpy` set: built on every push, served from the site,
gitignored in the repo. The firmware's own tests (`make -C
firmware/foxlib-c/tests check`) run the same scenarios as the CircuitPython
simulator, so the two implementations of a template are held to one
behaviour.

## 6. What CI builds, and how long it takes

Every push to `main` (and every pull request, except the deploy) runs:

```
   job        builds                              fetches                                   roughly
   ────────   ─────────────────────────────────   ───────────────────────────────────────   ───────
   page       nothing (lint, unit, smoke)         npm packages, a Chromium                  4 min
   sim        the .mpy set (§4)                   mpy-cross, ~10 MB, once per runner        < 10 s for the set;
              + every simulator scenario,                                                   the job ~3 min
              parity, replay fixtures
   foxlib-c   the PicoFox UF2 (§5)                the ARM toolchain (~100 MB) + pico-sdk    3–4 min
   kitsune    kitsune images                      upstream at a pinned commit; skipped      skipped unless
                                                  until hosting is agreed                   KITSUNE_COMMIT is set
   deploy     the site: page + descriptors +      the artifacts above                       1 min; main only,
   (Pages)    firmware/ + the UF2 + the .mpy set                                            after the others pass
```

So yes: the `.mpy` set and the UF2 are rebuilt on every push, and no, it
does not cost anything you will notice — compiling 23 modules takes under a
second; the jobs' time is dominated by the things they always did (the
toolchain download, the smoke test's Chromium, the simulator). A push that
touches only docs rebuilds them too; that is the price of never having a
build product that is older than its source.

Nothing is built when you flash or deploy. The page is static: it serves
whatever the last green run staged, and the Flash and Deploy tabs move
files. The only "build" at your end is the one you do not see — the board
compiling `.py` on import — and §4 is how to take even that away.

## 7. What is pinned where

```
   CircuitPython version   hardware/<board>.json (circuitpython.latest_known, the download page)   you load the .bin
   mpy-cross               firmware/mpy/pins.json                                                  CI fetches it
   ARM toolchain, pico-sdk .github/workflows/ci.yml (TC_URL + sha256, SDK_COMMIT)                  CI fetches them
   kitsune                 repository variable KITSUNE_COMMIT (+ KITSUNE_HOST to serve it)         CI fetches it
   foxlib                  firmware/foxlib/VERSION; a template's template.json says the range      the page checks it
   the page                js/main.js VERSION; stamped onto css/js links at deploy                 cache-safe
```
