# foxlib-c — fox-bench's native firmware

The `foxlib-c` device family: fox-bench's own firmware in C for boards that do
not run CircuitPython. Same contract as the CircuitPython foxes — `fox.json`
over `defaults.json` (CONFIG.md), the same templates, the `FOX …` banner, bench
actions — on a board the page talks to through a USB drive and a serial console.

Licence: GPL-3.0-or-later (`firmware/LICENSE`), like foxlib. FatFs under
`third_party/fatfs` has its own permissive licence.

```
core/        portable, hardware-free: json, morse, melody, schedule, synth, cfg
picofox/     the Pico SDK application for the AI6YM PicoFox hardware (RP2040 + Si5351)
third_party/ FatFs R0.16
tests/       host builds: parity with foxlib, the runner against the simulator's scenarios
VERSION      firmware version (the banner's foxlib=c-<version>)
```

## Targets

| target | hardware | status |
|---|---|---|
| `picofox-foxlibc` | AI6YM PicoFox rev 2/3 (`hardware/picofox.json`, `docs/picofox-hardware.md`) | experimental: builds and passes the simulations; first on-air test pending |

## What the PicoFox firmware does

- **USB**: a mass-storage drive `FOXBENCH` (the 15 MB of flash above the 1 MB
  program image, FAT, created on first boot with `fox.json`, `defaults.json`
  and a README) and a serial console (115200, any rate).
- **Configuration**: `fox.json` validated over `defaults.json` exactly as
  foxlib does (`core/cfg.c` is tested against `foxlib/cfg.py` and
  `js/model/schema.js`). Compiled-in morse-songs defaults are the last resort.
  About 1.5 s after the host's last write to the drive the fox reloads.
- **Behaviour**: foxlib's cycle (`foxlib/cycle.py`) as a state machine:
  Morse ID, songs, QRSS message, fixed / popcorn / resurrection schedules
  (same seeded LCG), plan rotation with QSY announcements, keydown limit,
  dead-phase wakes, SSTV (Robot 36 grayscale, streamed from `images.bin`
  one image per cycle, the test card when there are none). Every template:
  morse-songs, morse-sstv, morse-qrss, popcorn, resurrection, freq-rotator,
  composite.
- **Radio**: core 1 owns the Si5351. The carrier is PLLA × (a + b/c) with
  MultiSynth0 an integer /6; FM is done by rewriting the PLLA fraction once
  per sample at `radio.sample_rate` (8000 default), deviation from
  `radio.id_deviation_hz` / `radio.audio_deviation_hz`, with pre-emphasis and
  the `bright` tone shape synthesised in integer math (`core/synth.c`, the
  same renderer as the page's WAV preview); SSTV segments are pure tones at
  flat deviation (`audio_deviation_hz`), played back to back with the ID on
  one carrier. Keying = CLK0 output enable +
  amplifier enable. Attenuation (rev 3) through the BVA1761 serial interface
  — written from the datasheet, **unverified on hardware**, never touched at
  attenuation 0.
- **Console** (`picofox/console.c`): banner at boot, when a terminal opens and
  after every reload; the fox log (`cycle N @ f`, `morse: …`, `song: …`);
  commands `help status key <s> tone <hz> <s> id freq <mhz> atten <n> batt
  files reload stop uid version reboot bootsel`, each answered with `ok` or
  `err: …`. `bootsel` jumps to the UF2 bootloader (the RPI-RP2 drive appears)
  so the vendor firmware can go back without touching the button.
- **No LED, no battery voltage** on this hardware: the log carries the status,
  `batt` reports only whether the charger is active.

## Build

```
export PICO_SDK_PATH=/path/to/pico-sdk          # 2.1.x with lib/tinyusb initialised
cmake -S firmware/foxlib-c/picofox -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build                              # -> build/foxbench-picofox.uf2
```

CI (`.github/workflows/firmware.yml`) builds it on every push and the Pages
workflow places it at `firmware/foxlib-c/picofox/foxbench-picofox.uf2` on the
site, where the Board tab fetches it ("Get fox-bench firmware" → copy to
RPI-RP2).

## Tests (no hardware)

```
make -C firmware/foxlib-c/tests check
```

- `parity.py`: the C core against foxlib (Python) — identical Morse, song and
  SSTV event streams, identical schedule sequences, identical `cfg=` status lines
  for every template default and a set of bad `fox.json` files; and against
  the page's validator for the pinless family; synth sanity.
- `sim.py`: `picofox/fox.c` built for the host against stubbed hardware
  (`tests/host_sim/`), run through the Python simulator's own scenarios
  (`firmware/sim/scenarios.json`) and judged by its decoder — the banner,
  the decoded ID, kinds of audio, waits, keydown cuts, retunes, dead wakes.
- The page smoke test boots a deploy set exported for this target in the
  same host simulation.

## Switching between the two firmwares

Both live in the first 1 MB of flash and share the FAT volume above it, so
a swap keeps the files. Board tab, firmware card, either direction:

1. select the target you want to end up on — "(fox-bench firmware)" or
   "(vendor firmware)" — and fetch its image (`Get fox-bench firmware`, or
   `Get pfoxr3v1.uf2`, which comes from the vendor's GitHub into the browser);
2. **Reboot into bootloader** (the 1200-baud touch on the serial port; both
   firmwares answer it — BOOTSEL is inside the case);
3. **Copy to RPI-RP2**. The page verifies the bootloader drive disappears.

The loaded image belongs to the target it was loaded for; switching targets
forgets it. The drive keeps the name it was formatted with (`PicoFox` on a
unit the vendor firmware formatted), and each firmware ignores the other's
files: `fox.json`/`defaults.json` for ours, `settings.txt` and the WAVs for
theirs. Opening a drive whose files belong to the other firmware says so.

## First hardware session

`docs/first-hardware-session.md` has the general checklist. For this target:
Board tab → "Get fox-bench firmware" → "Reboot into bootloader" (the
1200-baud touch; BOOTSEL is inside the case) → copy to RPI-RP2. A
`FOXBENCH` drive and a serial port appear. Listen only shows the banner;
`status` shows the measured I²C write time (must be well under 125 µs at
8 kHz) and the detected revision; `key 2` with a power meter checks the
amplifier-enable polarity; `atten 40` then `key 2` checks the attenuator
(rev 3). Then Deploy with your callsign and listen on a receiver.
