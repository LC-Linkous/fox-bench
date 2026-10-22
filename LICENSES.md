# Licences in this repository

fox-bench is three pieces under three licences, plus what they bundle.
Every source file carries an `SPDX-License-Identifier` line saying which
applies to it; this page is the map.

| what | where | licence | text |
|---|---|---|---|
| **The page**: `index.html`, `css/`, `js/`, descriptors (`hardware/`, `boards/`, `modules/`, `bands.json`, `songs/`), `tools/`, `tests/`, docs | repository root | **GPL-2.0-only** | `LICENSE` |
| **Firmware**: foxlib (CircuitPython), the template runners, the simulator, and **foxlib-c** (C, Pico SDK) | `firmware/` | **GPL-3.0-or-later** | `firmware/LICENSE` |
| (two exceptions under `firmware/sim/`: `parity.mjs` and `schema_parity.mjs` import the page's `js/` and are GPL-2.0-only test code, as their SPDX lines say) | | | |
| **Flasher**: CircuitPython flashing from the page | `flasher/` | **Apache-2.0** | `flasher/LICENSE`, `flasher/NOTICE` |

The page writes the firmware to a board as data and imports the flasher as
an ES module across its directory boundary; neither is derived from the
other. They are an aggregation of three programs, not one, which is why
three licences can coexist in one repository.

## Third-party code

| component | used by | licence | where |
|---|---|---|---|
| esptool-js 0.7.0 (Espressif) | `flasher/` | Apache-2.0 | `flasher/vendor/esptool-js/`, `flasher/NOTICE` |
| FatFs R0.16 (ChaN) | `firmware/foxlib-c/` | FatFs licence (BSD-1-clause style) | `firmware/foxlib-c/third_party/fatfs/LICENSE.txt` |
| Raspberry Pi Pico SDK 2.1.x and TinyUSB | linked into the foxlib-c UF2, not in this repository | BSD-3-Clause / MIT | `firmware/foxlib-c/NOTICE` |
| CircuitPython | runs the foxlib family; downloaded by the user from circuitpython.org, never shipped here | MIT | — |

## Hardware and firmware that are *not* here

The **AI6YM PicoFox** hardware and its vendor firmware are © Giorgi
Enterprises LLC dba AI6YM.radio, **CC BY-NC-SA 4.0**. fox-bench includes
and modifies none of it. The `drive` family writes the files that firmware
reads; the `foxlib-c` firmware was written from the published schematic and
component datasheets (`docs/picofox-hardware.md`) and credits the hardware
design. Nothing in fox-bench grants rights to the PicoFox design.

The **kitsune** fox firmware (Wi-Fi, BLE, Bluetooth Classic and Zigbee foxes
for the RF CTF) is the work of its authors at https://github.com/rfhs/kitsune
and belongs to them. fox-bench includes none of it: the `compiled` family's
descriptors describe the boards it runs on, and `js/model/vendor/kitsune.js`
is fox-bench's own description of the configuration header that build
reads, written from reading the public repository. Their repository carries
no licence file at the time of writing; nothing of theirs is redistributed
from here.

## Lineage

The template runners under `firmware/templates/` descend from earlier
GPL-3.0 fox firmware (rot13labs fox via the 2024 CircuitPython port,
building on YAFB by KN4CK) and keep their lineage notices. foxlib's
independent modules and all of foxlib-c are new work under the same licence.

## Distributing a built UF2

`foxbench-picofox.uf2` (built by CI into the site) contains fox-bench's
GPL-3.0-or-later firmware, FatFs, the Pico SDK and TinyUSB. Pass it on with
`firmware/foxlib-c/NOTICE` (or a link to this page) and the source is a
`git clone` away, which is all those licences ask.
