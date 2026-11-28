# Bench runbook

The one page to have open at the bench. It is the order `tools/bench_queue.py`
prints, with the exact commands, what each one should print, and what to do
when it does not. Everything here is what the catalog claims and has not been
re-run on a board since: the point of the session is to make the rows in
`docs/hardware-log.md` true again.

## Before plugging anything in

```
git pull && python3 tools/bench_queue.py          # the order below, derived from the catalog
pip install pyserial                              # hw_smoke's only dependency
ls /dev/ttyACM*                                   # Linux; on Windows use COMx everywhere below, and `python` for `python3`
```
The bench laptop is a Windows machine (Device Manager → Ports shows the
COMx); every tool here runs there, `hw_smoke --payload/--checkpoint`
through `netsh wlan`. Nothing in this file needs Linux.

Each CircuitPython run below writes `hw_smoke-<uid>-<time>.json` (the report)
and, with `--record`, a replay fixture. Keep both; the report drives
`tools/session_close.py`, the fixture becomes a CI test. The page version is
the footer of the deployed site (tag first so the row names a release,
not a build; the numbers below are the current ones — `bench_queue.py`
prints them).

## Open questions only hardware can answer (as of page 0.18)

Collected from foxlib 1.6–1.10 and the network-fox phases; each answer
decides something in code or in the catalog. Write the answers into
`docs/hardware-log.md` (one row per board) and strike them here.

| # | Question | How | Decides |
|---|---|---|---|
| Q1 | Which builds have monitor mode? | REPL on C3, C5, C6, S3: `import wifi; print(hasattr(wifi, "Monitor"))` | where the honeypot's probe logging is offered |
| Q2 | Does `stations_ap` work? | wifi-beacon running, a phone joined, then at the REPL: `import wifi; print([(bytes(s.mac_address).hex(), s.rssi) for s in wifi.radio.stations_ap])` | honeypot joins; the find log's client MAC (else the IP) |
| Q3 | Is the watchdog real, and quiet at the REPL? | the boot log's `watchdog 90s` (or `unavailable(...)`); interrupt `code.py`, use the Bench tab for 2 min: no reset (the source says CircuitPython stops it on Ctrl-C) | whether 1.6's watchdog stays on by default |
| Q4 | Does `safemode.py` run after a brownout? | a bench supply dipped (or a flat pack at high power): `fox safemode: BROWNOUT, reset 1 of 50`, then a normal boot with the `safe-mode reset` note | recovery on CircuitPython 8.1+ builds; which builds need it noted |
| Q5 | Does the sign-in sheet pop by itself? | checkpoint fox; an iPhone and an Android join (step 21) | captive DNS as default; the fallback text |
| Q6 | How much RAM is left on the C3? | `import gc; gc.collect(); print(gc.mem_free())` with: checkpoint + a phone connected; mode rotation with all three kinds; sense with tags, relay and honeypot | whether those features stay offered on the C3 |
| Q7 | Can `finds.csv` be written on a board with a CIRCUITPY drive? | settled on the S3 (page 0.18.4): not without `boot.py`; the files are read-only to the board's code, also on battery. Deploy and `hw_smoke.py` now put `firmware/boot.py` on such a board ("Boards with a CIRCUITPY drive", under the tick-list). Confirm that step 21 writes `finds.csv` after that | — |
| Q8 | Does the BLE Scan list names now? | Bench → Scan on a BLE fox (the 0.18 fix) | — (confirms the fix) |
| Q11 | Do the payload features run at all? | puzzle-beacon on any chip: the boot log has no `** payload failed to load` line, and nRF Connect shows the name rotating (0.18.2: they never loaded on a board before) | that phase B works on hardware |
| Q9 | What is a room's BLE crowd? | the `crowd: N advertisers` line in a quiet room and in a busy one | the default for `sense.crowd.max` |
| Q10 | Does a shell-game fox survive a battery swap? | battery-only power cycle: `the board clock is unset; keeping seat N's identity` | whether shell-game foxes need re-deploying after a swap, or an RTC board |
| Q12 | Is the configured MAC the one on the air? | per kind: wifi-beacon's BSSID in the analyser, wifi-probe's source MAC in the sniffer's lines, ble-beacon's address in nRF Connect, each against the `… up: NAME (MAC)` line; and whether the console has `note: MAC … was asked for, the radio reports …`. On Wi-Fi also: does the chip's own address (the Board tab's, `7C:…`-style) ever show beside the fox's name? | the MAC sequence in `netradio.py` (radio stopped, mode on, set, start) — new in 1.10.3 and never run on a board; MAC rotation and the shell game depend on it |
| Q14 | Does the ESP32 still refuse to advertise after a scan, and which retry clears it? | ble-beacon with `sense.tags` on (a scan before every wake), or Bench → Scan then Radio up: with foxlib 1.10.5 the console says `note: BLE start refused (…530); started on the second try` or `… adapter reset and started`, once, and the beacon is on the air. 2026-11-18, XIAO ESP32S3, CircuitPython 10.3.2: reproduced on the page — Radio up ok, Scan ok, Radio up → `Unknown system firmware error: 530` | which retry stays in `netradio.py`; whether sense costs an adapter reset per wake |
| Q15 | Where does the bare ESP32-C3 hang when a network template starts? | **Answered 2026-11-19** with the boot trace: `init: ble workflow switched off (free 46704)` was the last line, then the port dropped (a reset). The next step is `import wifi` → `esp_wifi_init`, which could not get its RAM: the Python heap had grown into it (121 kB free at the prompt, 46 kB when `NetFox` started, because `foxlib/__init__.py` imported the whole FM stack on the way to `netfox`). Fixed in foxlib 1.10.7 (FM imports lazy, `wifi`/`_bleio` imported first). The hang was a reboot loop: the crash → safe mode → `safemode.py` reset → crash again, 50 × 5 s; safemode.py now stops after 3 crashes | re-test wifi-beacon on the C3 with 1.10.7 (trace on): the banner, then the four templates |
| Q13 | Which BLE powers does the nRF52840 take? | ble-beacon at 9 dBm on the Nano 33 BLE: `note: this chip has no 9 dBm BLE step; advertising at 8 dBm` and the beacon is on the air | the BLE power steps the page offers per chip |

## 1. PicoFox re-run (foxlib-c 0.1.14 / page 0.18.35)

From foxlib-c 0.1.12 the script runs the PicoFox too, over its console
(its one serial port — the FOXBENCH drive is a disk, not a port; no drive
involved — PROTOCOL.md "Files over the console"). Close the Board tab's
connection first: one program holds the port. Flash the site's `foxbench-picofox.uf2` from the Board tab first
if the fox is older, then:

```
python3 tools/hw_smoke.py --port /dev/ttyACM1 --board picofox-foxlibc \
    --call "W1ABC FOX DE W1ABC" --yes-antenna \
    --record tests/fixtures/bench/picofox-foxlibc-0.1.14-<date>.json --report picofox.json
```

It identifies the fox by `version` / `uid`, saves its fox.json and
defaults.json with `get`, `put`s each FM template's pair (the fox reloads
and prints its banner about a second later), listens, runs `status`,
`batt` and `key 1`, and puts the saved files back. The report goes through
`session_close.py` like any other. What only this session can show: the
`put` path writes the flash (the host sim covers the parser), and a drive
write while a `put` is in flight waits for it (`main.c`, 0.1.13).

**ModemManager** (Linux, optional): a freshly plugged ESP32 (`303a:1001`)
or PicoFox is opened by ModemManager for a few seconds to see if it is a
modem, with the tty's echo on — the fox then reads its own banner back as
commands. Nothing depends on fixing that: from foxlib-c 0.1.16 the
firmware drops lines it just sent itself, the page retries `version`, and
`hw_smoke.py` waits the window out. If the few-second wait after a
plug-in annoys you, a udev rule keeps ModemManager off these ports (the
same rule Arduino, PlatformIO and Espressif suggest for Linux):

```
# /etc/udev/rules.d/99-fox-bench.rules
ATTRS{idVendor}=="303a", ENV{ID_MM_DEVICE_IGNORE}="1"
ATTRS{idVendor}=="2e8a", ENV{ID_MM_DEVICE_IGNORE}="1"
```

(`sudo udevadm control --reload`, replug.)

## 1a. First session on a C-firmware ESP32 (foxlib-c 0.1.16)

Flash the site's `foxbench-esp32c3.bin` (under `firmware/foxlib-c/esp32/` on the site, from CI) at `0x0`
(`esptool.py --chip esp32c3 write_flash 0x0 foxbench-esp32c3.bin`; the Board
tab's card will do this in a later page), open nothing else on the port, then
the same command with `--board esp32c3-foxlibc --payload` (the computer's
Wi-Fi sees the beacon). `wifi-beacon` is the one template on the air; the
other four boot and report `not in this firmware` in their banner notes —
expected, they still count as ok. The ESP32 console is the flashing port
(USB-Serial-JTAG), and deep sleep takes it away: `--fox` with `sleep:
"deep"` is for a later session.

## 2. XIAO ESP32-C3 + SA868 re-run (foxlib 1.5.0 / page 0.12.0)

Antenna or dummy load on the SA868 first. Then:

```
python3 tools/hw_smoke.py --port /dev/ttyACM0 --board seeed_xiao_esp32c3 --module sa868_dual \
    --call "W1ABC FOX DE W1ABC" --yes-antenna \
    --record tests/fixtures/bench/c3-sa868-foxlib-1.5.0.json --report c3-sa868.json
```

Expected: seven lines of the table, every `ok`; the FOX banner for each
template within ~3 s of the reboot; the key test audible on the handheld on
the template's default frequency. The script restores whatever `code.py` /
`fox.json` were on the board at the end.

If it stops short:

- **no banner, `boot_log` shows an import error** — foxlib did not land whole.
  Re-run; the write verifies size + CRC32, so a second failure is the board,
  not the transfer. Note it in the row.
- **`radio=…` in the bench actions** — the module is not answering (PD pin,
  TX/RX swap, 9600 baud). Templates still pass; the row's result says
  "module not answering", no status change.
- **replay later says `ReplayError`** — fine, that is what the fixture is for;
  the recording is of what the board did today.

Close it:

```
python3 tools/session_close.py c3-sa868.json --page 0.12.0 --recording tests/fixtures/bench/c3-sa868-foxlib-1.5.0.json
python3 tools/session_close.py c3-sa868.json --page 0.12.0 --recording tests/fixtures/bench/c3-sa868-foxlib-1.5.0.json --apply
python3 tools/bench_queue.py --check && python3 tools/check_catalog.py --since origin/main
```

The dry run first so you can read the row before it is written. Add
`--note "…"` for anything the handheld told you that the script cannot know.
Then the Recordings section below: list the new fixture in the table and drop
`sim-esp32c3-fm.json`'s "should join it" note.

### After the field report: foxlib 1.6 on the SA868 fox

The field test reported the foxes stopping after a few hours. foxlib 1.6
hardens the loop (CHANGELOG, "a fox that lasts the hunt"); this is what to
look at on the bench before the next outing, and what to ask of anyone who
finds a "dead" fox.

Bench, one board, a real pack, the handheld on the frequency:

1. Deploy morse-songs with **enable automatic recovery attempts** ticked on
   Behavior (the default). The boot log gains `watchdog 90s` after the
   banner; `ls` on the board shows `safemode.py` beside `code.py`. To
   watch a fox die the old way instead, untick it: the log says
   `recovery off`, and a brownout then leaves the board in safe mode with
   its reason on the console.
2. **Module reset while running.** Pull the SA868's power lead (or its PD pin
   low) for a second between transmissions and restore it. The next cycle
   should be on frequency again and the log should not change — the fox
   re-tunes before every key-up, so the handheld hears nothing different. Do
   the same *during* a transmission: the keyed audio stops, the next cycle is
   back.
3. **Brownout.** Run from a pack that is nearly flat with `radio.high_power`
   on, or brown the board out on purpose (a bench supply at 2.6 V for a
   moment). The console shows `fox safemode: BROWNOUT, reset 1 of 50 in 5 s`,
   then a normal boot whose banner is followed by
   `note: 1 safe-mode reset since the last completed cycle`. After the first
   full cycle the note is gone on the next reboot.
4. **Hang.** With code.py running, `Ctrl-C` and wait two minutes at the
   REPL (use the Bench tab meanwhile): nothing happens. CircuitPython
   stops a RESET watchdog when code.py ends by Ctrl-C or a reload, and
   leaves it running after an uncaught exception, so a fox whose code.py
   died resets after 90 s and `safemode.py` brings it back (foxlib 1.10.2
   stopped disarming it itself).
5. Leave it running from a full pack overnight (a soak); the handheld or a
   recording confirms it is still on frequency in the morning. Put the hours
   in `docs/hardware-log.md`.

What to ask when a fox is found quiet:

- Was the status LED doing anything? `unconfigured`/`fatal` double-blinks
  mean the loop is running and something is wrong with the config or module;
  a dark LED with a warm module means brownout or a hang; a dark LED and a
  cold module is the pack.
- Did a power cycle bring it back? Yes = safe mode or a hang (the 1.6 fixes
  apply). No = the pack or the wiring.
- Was it keying (the handheld's S-meter) with no audio, or silent? Keying
  with no audio on the planned frequency is the module on its default channel
  (fixed by re-tuning); silent is the ESP32.
- How was the SA868 powered? From the pack through the XIAO's 3V3 regulator
  is marginal at high power (the module draws up to ~1 A keyed); the module
  wants the pack or 5 V directly, with a decoupling capacitor at its pins.
- Was a laptop attached? A console with a sleeping host is one way for a
  print to stall; the watchdog now covers it.
- The C3 defaults have `pins.batt_sense: null`: no low-battery pause. A fox
  with the divider wired and the pin set pauses at `battery.critical_v`
  instead of browning out mid-transmission.

## 3. Bare XIAO ESP32-C3 (`esp32c3`, network foxes, first session)

The same board, module unplugged (or a second C3). Two boards on the bench:
the fox on ACM0, the sniffer on ACM1. Put the sniffer on first (its `code.py`
is not a template, so not from the page):

```
python3 -c "from tools.hw_smoke import Repl; r = Repl('/dev/ttyACM1'); r.interrupt(); \
  r.write_file('code.py', open('tools/sniffer/code.py','rb').read()); print(r.reboot_and_capture(until=rb'\"role\":\"sniffer\"'))"
```

Expected: the `{"t":"hello","role":"sniffer",…}` line. If instead the boot log
ends in `AttributeError: … 'Monitor'`, the build on that board has no monitor
mode: the Seeed C3 10.3.1 build does (checked against the build's module
list), so that is an older CircuitPython — reflash it from the page's Board
tab (10.3.1) and try again. `ImportError: wifi` is the same answer.

Then the fox:

```
python3 tools/hw_smoke.py --port /dev/ttyACM0 --sniffer /dev/ttyACM1 --board esp32c3 \
    --call "W1ABC FOX DE W1ABC" --yes-antenna --templates wifi-beacon,wifi-probe,ble-beacon,puzzle-beacon \
    --record tests/fixtures/bench/c3-net-foxlib-1.5.0.json --report c3-net.json
```

Expected per template: banner, then for `wifi-probe` a line like
`sniffer: N probe(s) from f2:b0:…, N with SSID 'W1ABC FOX DE W1ABC', M from others`.
`wifi-beacon` you check on a phone's Wi-Fi list; `ble-beacon` with nRF
Connect. The C3 has no LED, so "stays dark" is right.

- **`no probe request from the fox … reached the sniffer`** — before blaming
  the fox, hold a phone's Wi-Fi settings page open next to the sniffer: its
  own probes should show up as `others`. None at all → the sniffer is not
  hearing anything (monitor mode returns packets but the parse rejects them —
  frames with FCS shift nothing, but a radiotap-like prefix would; paste one
  `RAW` line into `firmware/sim/test_sniffer_parse.py`). Phone seen, fox not →
  the fox's probes are not going out; that is a real finding for the row.
- **`ble-beacon` fails to import** — the C3 build may lack `_bleio`; the
  template's `boards_tested` stays as is, the row says so.

Close it the same way (`session_close.py c3-net.json --page 0.12.0 …`). The
script will offer `esp32c3 experimental -> stable`; the rule in
the network-fox tick-list below is a clean row for every variant, and the C3 has
one, so if all four passed, flip it in `boards/esp32c3.json` and add a
CHANGELOG line. Then `wifi-probe` needs a note in the Recordings section below:
replaying a sniffer run needs `firmware/sim/pty_sniffer.py` on the second pty.

## 3a. The C3 hang (2026-11-18/19, before foxlib 1.10.6)

What two bare XIAO ESP32-C3s did, so the next session does not repeat it:

- **Every network template hangs before the banner.** The deploy writes,
  the soft reboot prints `code.py output:` and nothing more; Ctrl-C from
  the page and from miniterm gets nothing; miniterm itself freezes on the
  dead port. Only the reset button or a replug brings the board back. The
  same on CircuitPython 10.2.1, 10.3.1 and 10.3.2, under the page and under
  miniterm after a hard reset. After a power cycle `reset_reason` is
  `POWER_ON` and `nvm[0]` is 0 — no safe-mode entry was recorded, so this is
  not a brownout and not a watchdog (a network fox had none before 1.10.6).
- **morse-songs on the same board runs** (foxlib 1.10.5, watchdog 90 s): the
  board, the build and the deploy path are fine; it is the network path.
- **At the REPL, step by step, nothing hangs** (code.py renamed away):
  `import wifi` ok, `wifi.radio.enabled` True, `wifi.radio.start_ap("FOXTEST", "")`
  puts FOXTEST on a phone's Wi-Fi list, `wifi.radio.tx_power` reads and sets
  (the getter prints nothing on this build). Free heap: 121664 at the
  prompt → 75024 after `import foxlib.netcfg` → 68592 after `netradio` →
  48304 after `netfox`. `NetFox(...)` itself was never constructed at the
  REPL: that is the next thing to try if the trace does not settle it.
- **The board advertises itself.** nRF Connect shows `CIRCUITPY8c32` at
  `98:3D:AE:AC:8C:32` (the chip's MAC + 2) whenever the C3 is powered:
  CircuitPython's BLE workflow, on from boot on every build without native
  USB. The fox never asked for it; foxlib 1.10.6 switches it off at start.
- Not the antenna, not the module: one board had the SA868 wired, the
  other was bare with the u.FL antenna; one is known to carry 2.4 GHz
  packets for another project.

**2026-11-19, with the trace (page 0.18.10):** `init: start seeed_xiao_esp32c3
(free 46832)`, `init: ble workflow switched off (free 46704)`, then
`serial port dropped` — the chip reset at `import wifi`. 46 kB free at the
start of `NetFox` against 121 kB at a bare prompt is the whole story: on the
espressif ports the Python heap grows into the RAM the Wi-Fi driver needs at
`esp_wifi_init`, and foxlib's imports (the FM stack through
`foxlib/__init__.py`, then the net modules, all compiled from source on the
board) had taken it. `esp_wifi_init` failed under `ESP_ERROR_CHECK` → panic →
reboot → safe mode → `safemode.py` reset it → the same crash, every 5 s, 50
times. That loop is why nothing could connect afterwards: the USB port came
and went with every reset. foxlib 1.10.7 imports the radios first and the FM
stack only for an FM fox; safemode.py gives up after 3 crashes.

**With 1.10.7** the crash is gone and the failure is honest: `MemoryError:
memory allocation failed, allocating 3645 bytes` compiling `netcfg.py` —
the radio stacks are up, the heap left cannot compile a 24 kB module. That
is what `.mpy` is for: page 0.18.13's Deploy → *Precompiled (.mpy)* (after
`python3 tools/build_mpy.py` has built the 10.x set). Next C3 attempt:
trace on, precompiled on, wifi-beacon; the `free` numbers in the `init:`
lines against the source run's are the measurement either way.

### 3b. What the C3 episode says about the setup (audit, 2026-11-19)

- **Memory is a per-configuration property, and the bench had no number
  for it.** Every row said ok/fail; none said how close. From foxlib 1.10.11
  the network banner carries `mem=`; a row without it is incomplete.
  Under ~20 kB, treat the board as marginal: a feature switched on later
  (checkpoint is 19 kB of source, sense 14 kB) loads more modules at
  runtime and is the next `MemoryError`, after the banner said ok.
- **The C3 cannot shed the BLE stack.** CircuitPython starts its BLE
  workflow before `code.py`; the fox can stop the advertising, not free the
  stack. A Wi-Fi-only template on the C3 pays for BLE it never uses. If
  `mem=` stays low with `.mpy`, the catalog should say the C3 is an FM and
  BLE-beacon board, not a network-fox board — not squeeze further.
- **A board that crashed three times stays in safe mode, dark.** That is
  the design (a crash repeats; the bench must be able to get in), but in
  the field it looks like a dead fox: no LED, no banner. A power cycle boots
  normally, crashes, and lands back in safe mode with the count already at
  its limit. Only a deploy that then completes a cycle clears it. The
  Board tab's *Safe mode* line is where that shows.
- **The `.mpy` set was briefly a committed binary** (page 0.18.13), which
  made every firmware patch a two-step apply. Page 0.18.17 follows the UF2's
  precedent instead: CI builds the set in the `sim` job and stages it into
  the site; nothing is committed and the hosted page always has it. A
  checkout builds its own with `python3 tools/build_mpy.py` (gitignored).
- **The replay fixtures were loosening** (247 of 434 and 223 of 685
  exchanges used; the rest were foxlib source chunks from old releases).
  Recording format 2 (page 0.18.16) keeps one line per file and is scrubbed
  of the callsign and the neighbours' SSIDs/addresses; `tests/README.md`.
  The S3 recording is format 1 and carries the callsign and the bench's
  neighbours — harmless, but re-record it at the next S3 session; the C3
  gets a hardware recording once it is up (the old `pty-c3-all-fm.json`, now removed, was
  a simulator recording, now `sim-esp32c3-fm.json`).
- **The import-graph tool is a regex over `from . import`.** It
  special-cases `netfeatures.MODULES`; a new `__import__` by name anywhere
  else would be invisible to it and the file would be missing from the
  board. The simulator would not notice either (it imports from the tree).
  Rule: no dynamic imports in foxlib outside `netfeatures`.
- **The stale removal is foxlib-only and runs after the write**, so a
  deploy that dies midway leaves a complete set plus leftovers, never a
  hole. Anything a user put into `foxlib/` by hand is removed with them.

## The network-fox tick-list (every bare board)

The tick-through list for the network-fox templates (`wifi-beacon`,
`wifi-probe`, `ble-beacon`, `puzzle-beacon`, `checkpoint`) on the bare boards. One pass per board; each
ends with a row in `docs/hardware-log.md`. The receiver is a phone: its
Wi-Fi list, a Wi-Fi analyser app that shows BSSID and channel, and a BLE
scanner app (nRF Connect or similar). `wifi-probe` is the one a phone
cannot see: put `tools/sniffer/code.py` on a second XIAO C3 or C6 and
pass its port as `--sniffer` — `hw_smoke.py` then counts the probe
requests that actually went over the air (`tools/sniffer/README.md`).

Before the first board: `python3 tools/hw_smoke.py --port <port> --board
<chip> --call <callsign> --yes-antenna --templates wifi-beacon,ble-beacon`
does steps 2, 8 and 9 below unattended and writes a report; add
`wifi-probe` to the list and `--sniffer <port2>` with the sniffer board
plugged in and step 10 is covered too. The rest is the page and the phone.

### Boards with a CIRCUITPY drive (ESP32-S3, nRF52840)

CircuitPython gives such a board's files to the computer: read-only to the
board's own code, which is what writes when the page or `hw_smoke.py`
deploys over serial and what writes `finds.csv` on a fox. The first Deploy
stops with instructions instead of `OSError: [Errno 30] Read-only
filesystem`. Once per board, either:

1. **Download boot.py** on the Deploy card (or take `firmware/boot.py`),
   copy it onto the CIRCUITPY drive, press reset, Connect, Deploy; or
2. eject the CIRCUITPY drive in the file manager (cable in), Deploy again:
   the page writes `boot.py` itself. If ejecting drops the serial port
   (some Linux desktops power the device down), use the first way.

From then on the drive is read-only on the computer. Note which way you
used and whether the board needed a second reset. To undo:
`import os; os.remove("boot.py")` at the console and reset, or safe mode.

### The pass (every board)

Board tab → **Show experimental targets** → the chip under **CircuitPython
board**. Radio tab → wiring card: the **Board** dropdown names your board
when the chip has more than one; the LED pin is the descriptor's default.

1. **Flash CircuitPython** (Board tab → Flash CircuitPython card, the `.bin`
   from the linked circuitpython.org page; the nRF52840 by `bossac` by hand).
   On a board with a CIRCUITPY drive the card has a second step: download
   `boot.py`, copy it onto the drive that just appeared, eject, press R
   ("Boards with a CIRCUITPY drive", above). Connect: the Board tab's
   *Board id* shows what the board reports; for a sibling build it says
   "the … runs this build". Record the id.
2. **wifi-beacon**, defaults (SSID `FOXBENCH WiFi Beacon`, channel 1, 17 dBm,
   open; callsign on the ID tab; wake 15 / off 5, sleep **off**). Deploy.
   Banner: `cfg=ok radio=ok id=set freq=none net=wifi-ap name="FOXBENCH WiFi
   Beacon" mac=F2:B0:00:00:00:01`; then `cycle 0`, `wifi-ap up: … (F2:B0:00:00:00:01)
   for 15 s`, `wifi-ap down`, `sleep 5 s`. The address in brackets is read
   back from the radio: anything else there, or a `note: MAC … was asked
   for` line, is the answer to Q12. `cfg=partial(pins.led)` means the LED name in
   the descriptor is not one this build has: note what `dir(board)` lists
   (REPL: `import board; dir(board)`) — that is the fix.
3. **Phone**: the SSID appears for ~15 s and is gone for ~5. Analyser: BSSID
   `F2:B0:00:00:00:01`, channel 1. **LED** blinks while the radio is up
   (900/100 ms) and is off during the sleep — or stays dark on a board
   whose descriptor says it has none.
4. **Callsign as SSID**: ID tab → *Use the callsign as the SSID*; redeploy;
   the phone shows the callsign.
5. **MAC and power**: Radio tab → **Random**, deploy; the BSSID follows.
   `tx_power_dbm` 2 → the analyser's RSSI drops clearly against 17.
6. **Hidden SSID on**: banner `radio=ok(hidden_unsupported)` + the note; the
   phone still sees the SSID. That is the expected result.
7. **Deep sleep**: Schedule → sleep **deep**; deploy, then **Listen only**.
   The port disappears for ~5 s each cycle; the page says it is waiting and
   listens again when the board returns with `woke from deep sleep`,
   `cycle 0`. On the phone the SSID still comes and goes. A power bank with
   auto-off is what this mode fights; try the one you would hunt with.
8. **Bench tab**: **Scan** lists your home AP with an RSSI; **Radio up 3 s**
   → `ok wifi-ap <name> (<MAC>) for 3.0 s`, the MAC read back from the
   radio while it was up.
9. **ble-beacon**, defaults (UUID `F0B0F0B0-0000-4000-8000-000000000001`,
   major 1, minor 1, name `FOXBENCH Beacon`, 100 ms, 0 dBm). Deploy; nRF
   Connect shows the iBeacon frame (Apple 0x004C, UUID / major / minor) and
   the name in the scan response, coming and going on the duty cycle.
   Callsign as name, `tx_power_dbm` −12 vs 9 against the app's RSSI.
   The phone's own Bluetooth settings never list a beacon (only
   connectable devices); use the scanner app. On an iPhone, iOS keeps
   iBeacon frames from apps, so the scanner shows a device with the name
   and no beacon data; the Eddystone frames do show. **Scanner shows
   nothing at all** (XIAO ESP32S3, 2026-11-17, nRF Connect on a Galaxy): if
   the scanner lists no devices whatsoever, not even the laptop, it is the
   phone — restart it (that was the answer on 2026-11-17); then the
   antenna (the XIAO S3's u.FL antenna must be fitted and seated; a loose
   connector was the first board's fault), then the app's RSSI filter, then
   this at the page console (Ctrl-C first), one line — a plain connectable
   advertisement that every scanner lists:

   ```
   import _bleio, time; a = _bleio.adapter; a.enabled = True; a.start_advertising(b"\x02\x01\x06", scan_response=b"\x08\x09FOXTEST", connectable=True, interval=0.1); print("FOXTEST from", a.address)
   ```

   (`a.stop_advertising()` stops it.) Seen → the radio is fine and the
   fault is in the fox's frames or the scanner's handling of them. Not
   seen on a phone that lists other devices → antenna or board.
10. **wifi-probe** (with the sniffer board on a second port): `hw_smoke.py
    --sniffer` reports `N probe(s) from F2:B0:00:00:00:05, N with SSID
    <callsign>` during the observe window and fails the template at zero.
    By hand: the sniffer's serial output is one JSON line per probe
    request; watch for the fox's MAC with the callsign as SSID, through
    the whole wake (a round every ~2 s; before foxlib 1.10.3 only the
    first 2 s of each wake), on channels 1/6/11. The board never joins
    anything.
11. **Hardware-log row**: date · board (variant) · firmware (foxlib version,
    CircuitPython version, build id) · checked (which of 2–10) · how (phone
    apps) · result. A chip target goes `stable` once every one of its
    variants has a clean row for 2–9 (the S3 needs both boards); the
    templates list the chip in `boards_tested` then.

### A page-built configuration on the bench (`--fox`)

`hw_smoke` deploys each template's bare defaults; everything the page lets
you set is otherwise tested only in the simulator. `--fox FILE` closes that:
the file is a `fox.json` — the page's Deploy → **export** (`fox.json` in the
zip), or a hand-written overlay with just the sections to change — merged
over the template's defaults and run with the same scan, portal, bench and
recording machinery. Its `template` picks the template when `--templates` is
not given; its `id.callmessage` is the callsign unless `--call` says
otherwise; `net.psk` makes `--checkpoint` join with the key (nmcli and
netsh both). A config the firmware disagrees with shows as
`cfg=partial(…)` and fails the template, which is the point.

```bash
python3 tools/hw_smoke.py --port /dev/ttyACM0 --board esp32c6 --yes-antenna --mpy \
  --fox fox.json --payload --checkpoint --record seeed_xiao_esp32c6-fox-2026-11-24.json --report c6-fox.json
```

What to know:
- **Deep sleep** (`schedule.sleep: deep`): the console port is gone while
  the fox sleeps. The host side (`--payload` scan, `--checkpoint` visit)
  still runs during the wake; the REPL bench phase is skipped (`bench:
  skipped`), and the restore waits up to 3 minutes for the port to return
  at a wake. Keep `wake_s` long enough for the portal visit (60 s+).
- **Recordings carry the overlay** (`args.fox`), callsign scrubbed, so a
  replay deploys the same config. A PSK in the overlay is in the recording
  too: use a throwaway key in anything you will commit.
- A `board` in the file that is not `--board` is deployed anyway with a
  NOTE; a `variant` in the file is used when `--variant` is not given.
- One overlay, one template: for several configs run `hw_smoke` once per
  file (each run writes its own report and recording).

### Payloads (phase B, foxlib 1.4.0) — on any board that passed 2–9

12. **Rotating names** (wifi-beacon, Payload tab → *What the fox says* →
    rotate, three names): the phone's Wi-Fi list shows a different name
    each cycle, in order; the console says `payload: name this cycle …`.
    Then **morse-name** with the callsign: the SSID reads `-.- -.-- ....-`.
13. **puzzle-beacon** (BLE): nRF Connect shows, from one address, the
    iBeacon (major 1 / minor 1 by default — set a code), then an
    Eddystone-TLM frame (battery 0 mV on boards without a divider, the
    frame count climbing, uptime), switching every second; the name
    changes each cycle. Add an Eddystone URL: the phone offers to open it
    (Android shows it in the scanner; iOS needs an Eddystone-aware app).
14. **Split clue** (C3 / C6 / C5 / S3 — both radios): wifi-beacon with
    `split.wifi` and `split.ble`: the Wi-Fi list shows the SSID and the BLE
    scanner the other half, from the same fox, at the same time. Watch the
    console for `payload: second radio failed` — the first sign of a RAM
    or driver limit on that chip.

### Stealth (phase C, foxlib 1.5.0)

15. **MAC per cycle** (wifi-beacon, Payload tab → *How hard it is to find* →
    MAC address: new one each cycle): the analyser's BSSID changes every
    cycle; the console lists each. *Per boot*: one new address, constant
    until the next power-up. Note which the fleet log should carry.
16. **Silent start**: `after_s` 60 → nothing on the air for a minute, the
    LED blinking once every 3 s, then `stealth: starting`. Then `at` five
    minutes ahead with the Deploy tab's clock ticked → same, against the
    wall clock. With deep sleep on, the fox must not wait again after each
    wake (`already started before this deep sleep` in the boot log).
17. **Decoys**: two decoy names → the phone's list shows the fox's name and
    both decoys taking turns, 3 s each (the list may lag: an analyser's
    time graph is clearer).
18. **Jitter** ±8 s on 20/10 → the up/down times on the analyser vary
    cycle to cycle; the console prints each cycle's timing.
19. **BLE only** (ble-beacon on a Wi-Fi + BLE chip): nothing in the Wi-Fi
    list, the beacon as before; `stealth: BLE only; Wi-Fi radio off`.

### Checkpoint (phase D, foxlib 1.7.0) — the fox as a server

20. **checkpoint** template (Wi-Fi chips; C3 first — it is the tight one for
    RAM), defaults: SSID `FOXBENCH Checkpoint`, wake 120 / off 10, the
    portal on with code `4471`, captive DNS, the callsign box, the find log.
    Deploy. Console: `checkpoint: portal at http://192.168.4.1/ with
    captive DNS`; the LED is steadily on while the radio is up (the server
    ticks every 50 ms; a blink cannot be sliced that fine).
21. **Phone joins the network.** The point of the phase: the "sign in to
    network" sheet should open by itself with the page — title, text, the
    code large, the callsign box. Try an iPhone and an Android; note each
    OS's behaviour in the hardware log (iOS fetches Apple's hotspot-detect page, Android Google's
    generate_204 check; both get the fox's page instead). If
    no sheet appears within ~10 s, open `http://192.168.4.1/` in the browser
    by hand — that is the `captive_dns: false` experience, and the answer to
    whether captive DNS works on that phone.
22. **Hand in a callsign.** Submit the form: the page comes back with
    `Logged: <callsign>`; the console says `checkpoint: find <callsign>`
    (no address: finds.csv's last column is `portal` or `ble`). If the console instead says `find log: cannot write
    finds.csv`, the host holds the drive (an S3 with USB mass storage):
    note it — the finds are kept in RAM for that session, and a `boot.py`
    remount is the fix to come.
23. **Collect finds** (Bench tab): reads `finds.csv`, merges one `find` row
    per callsign into the fleet log (Fleet tab) under this fox's uid;
    pressing it again adds nothing. **Download this fox's CSV**, then
    **Clear on fox**. **Restart fox** afterwards.
24. **Deep sleep refused**: Schedule → deep → the Deploy checks block it
    (and the firmware, if fed such a fox.json by hand, logs
    `schedule.sleep -> default` and runs with the radio off between wakes).
25. **BLE service** (C3 / C6 / C5 / S3): Payload tab → *What the fox serves*
    → *BLE service with the code*. nRF Connect: the beacon is now
    connectable and advertises the service UUID (the name is cut to 11
    bytes beside it); connect, read the `…C1` characteristic (the code),
    write a callsign to `…C2` → console `checkpoint: find <callsign> over
    BLE`, a `ble` row in `finds.csv`. On the checkpoint template this is a
    second radio beside the access point — watch for `second radio failed`
    on the C3.
26a. **The computer as the phone** (Windows: `netsh wlan`; Linux:
    NetworkManager): steps 21–23 without a phone, and a report that can be
    diffed.
    ```
    python tools/hw_smoke.py --port COM5 --board esp32s3 --yes-antenna --templates checkpoint,wifi-beacon --payload --checkpoint
    ```
    On Windows the first `--checkpoint` join may raise the "connect to this
    network?" prompt once; the profile it adds (`fox-bench-smoke`) is
    deleted again when the fox is left. `netsh` reports the adapter's last
    scan, which Windows refreshes on its own every few seconds; if
    `--payload` keeps saying NOT on the air for a fox a phone can see, open
    the taskbar's Wi-Fi list once (that forces a scan) and run again.
    `--payload` scans with the computer's Wi-Fi while each Wi-Fi fox runs
    and fails the template unless its name is on the air (the BSSID is
    compared with `net.mac`, Q12). `--checkpoint` joins the checkpoint fox's
    network, asks its captive DNS for `captive.apple.com` (the answer must
    be the fox), GETs the page (the code must be on it), POSTs `W1XYZ`
    (`--find-call`), leaves the network, and once the fox is stopped reads
    `finds.csv` back over the REPL and requires the row; a `finds.csv` that
    was not on the board before is removed again. The computer has no
    internet while it is on the fox; the serial port is unaffected. On a
    machine with neither (macOS), join the network by hand and run
    `python3 tools/hw_smoke.py --portal-only` — the DNS and portal checks
    alone, no board. What the phone alone can answer stays with the phone:
    whether the sheet *pops* (Q5), and anything BLE (step 25, Q8).
    With `--record`, the host's results (scan, join, DNS, portal) go into
    the recording as `host` lines, so the run replays in CI without a
    Wi-Fi adapter (`replay_check.py` passes `--host-from`).
26. **RAM**: after a wake with several phones attached, the REPL's
    `gc.mem_free()` (Bench → any action, then the console) tells whether
    the C3 has headroom; a `MemoryError` in the console during step 21 or
    25 means the portal goes `radios: ["wifi24"]` + a minimum-RAM note and
    the page offers it on the C6 / S3 / C5 only.

### What varies per wake (phase G, foxlib 1.8.0) and the event sheet

27. **Channel per wake.** wifi-beacon, Radio tab → Channel per wake → *1 / 6
    / 11*. Deploy; a phone's Wi-Fi analyser (or `tools/sniffer`) shows the
    AP's channel differ across wakes while the console says `channel this
    cycle N`. *any* writes the region's list (US 1–11).
28. **Probe list.** wifi-probe, Radio tab → *Other networks it looks for*
    (three names), *Change network every* 5 s, wake 30 s. The sniffer sees
    probe requests for each name in turn from one MAC; the console says
    `probing for X` every 5 s. With the interval at 0, one name per wake.
29. **Variable power.** Payload tab → Stealth → *Variable power* 2–13 dBm,
    *every N seconds* 5. A scanner's RSSI for the fox steps up and down
    within one wake while the console says `tx power now N dBm`; on a BLE
    fox the beacon drops out for a moment at each change (advertising
    restarts). Per wake: one `tx power this cycle` line per wake.
30. **TLM data.** ble-beacon, Payload → Eddystone telemetry on → Battery
    4471, Frame count 146565. nRF Connect's TLM decode shows 4471 mV and the
    count fixed, temperature as before, uptime still counting.
31. **Event sheet.** Deploy → Fleet record: number 1, event "bench",
    operator. Deploy two foxes (two numbers). Fleet tab → Event sheet, event
    "bench": two lines with the `on the air` summaries; *Export CSV*;
    *Print view* opens the one-page table. Re-deploy fox 1 with another
    channel list: still two lines, fox 1's updated.

### Handoff (phase J, page 0.16)

32. Save an FM fox as a profile with Fox number 2 (morse-songs, 146.565).
    On a checkpoint fox: Fleet record → Fox number 3, Points to *#2*; portal
    body "Next: listen on {{to.freq}} MHz". The Deploy checks are clean and
    the hint shows `{{to.freq}} → 146.565`; after deploy the phone's sign-in
    page reads "146.565 MHz" while the Payload tab still shows the
    placeholder. Point the FM fox back at #3 with `QSY {{to.name}}` in its
    Morse message: the Fleet tab's Handoff chain shows both links and a
    `loop:` line — intended here, a warning not a block.
33. Set Points to a number with no profile: a blocking `handoff:` error on
    Deploy; `{{to.freq}}` on a fox pointing at a BLE fox: "has no freq".

### Mode rotation and the shell game (phase H, foxlib 1.9)

34. **Mode rotation.** ble-beacon on the C3, Payload → Stealth → Mode
    rotation: BLE beacon + access point, in turn, wake 10 / off 5. Console:
    `modes: ble / wifi-ap, in turn`, then `mode this cycle …` alternating;
    nRF Connect sees the beacon on even wakes, the phone's Wi-Fi list the
    AP (same name) on odd ones. Add the probing client and switch to *at
    random*. Watch `gc.mem_free()` on the C3 with three radios built.
35. **Shell game.** Save two or three wifi-beacon profiles (fox numbers 1–3).
    Fleet tab → Shell game: pick them, identities FOX-A / FOX-B / FOX-C,
    every 120 s (the field minimum is 60), *Apply*. Load each profile,
    tick *Set the board clock* on Deploy, deploy each board. Within a
    period the phone sees three different names; after the period each
    board has moved one name along (console `shell game: identity k of
    3`), and no two ever show the same name. Power-cycle one board without
    USB: its clock resets, the console says `the board clock is unset;
    keeping seat N's identity` — the known limit (the page sets the clock;
    a battery-only restart loses it). Decide whether that fox needs an
    RTC-backed board or a re-deploy.

### The fox that listens, and done for the day (phase E′, foxlib 1.10)

36. **Tags.** wifi-beacon with Sense → Hunter tags (prefix HUNT-). A second
    board running ble-beacon named `HUNT-RED` (or any BLE tag) a metre
    away: console `sense: tag HUNT-RED -NN dBm` before each wake; Bench →
    *Who is near* shows a `tag` line. Walk the tag away until it drops
    below the threshold.
37. **Relay.** Two boards: fox B wifi-beacon `FOX-2`; fox A with Relay →
    listen for `FOX-2`, *go on the air for good*. A stays `silent this wake
    (relay: waiting for FOX-2)` until B is powered, then `relay: on the air
    from now on`. Repeat with *stay silent while it is on the air* and
    *flip on / off*.
38. **Crowd.** Crowd control, *more than* 3, quiet 60 s. A room with
    several phones / watches near the board: `crowd: N advertisers above …;
    quiet for 60 s` and the LED's short blink every 3 s; the fox comes
    back after a minute. Note the count in a quiet room — that is the
    venue's baseline, and `max` must sit above it.
39. **Honeypot joins.** checkpoint or wifi-beacon with Honeypot log: join
    the AP from a phone → `honeypot: <MAC> joined (-NN dBm)`, a `join` line
    in Who is near. Note whether the MAC is the phone's real one or its
    per-network random one (both iOS and Android randomise by default).
40. **Honeypot probes.** Tick *Listen for probe requests*. On a build with
    `wifi.Monitor`: forget the fox's network on a phone that had joined it
    — the phone probes for it by name (hidden-network style probes are the
    common case), console `honeypot: 1 probe(s) for our names`. On a build
    without: `this build has no wifi.Monitor` once.
41. **Done for the day.** checkpoint, *At* a time a few minutes ahead with
    the board clock set at deploy: `done: …`, the AP disappears, the LED's
    long slow blink; a power cycle brings it back. (The count-of-finds
    trigger left in foxlib 1.11.)

### Per-board notes

- **XIAO ESP32C3** (`esp32c3`): the firmware path is the proven one (same
  board as the FM fox). No LED: step 3's LED check is "stays dark". First.
- **XIAO ESP32C6** (`esp32c6`, two boards): own build; LED on GPIO15, active
  low — the blink is inverted if the descriptor's `active_low` is honoured
  wrongly, note which way it blinks. Run one board radio-off and the other
  deep-sleep for a side-by-side of USB behaviour.
- **XIAO ESP32S3** (`esp32s3` → XIAO ESP32S3): own build; fit the antenna.
- **XIAO ESP32C5** (`esp32c5`): runs the DevKitC-1-N8R8 build (10.3.2) and
  reports its id, `espressif_esp32c5_devkitc_1_n8r8`. 8 MB flash and 8 MB
  PSRAM: `mem=` in the megabytes like the S3 (8.2 MB free, 2026-11-24). Its
  buttons are R = reset (CHIP_EN) and B = boot (GPIO28), its LED `IO27`
  (`led on` ran; Seeed's example drives it LOW for on, so note the blink
  direction). The pin names follow the DevKit's `IOxx` naming — no `D0` in
  `dir(board)`; the descriptor's aliases are the XIAO silkscreen. Antenna:
  U.FL only, fit the supplied one. The same `hw_smoke` line as the C6 with
  `--board esp32c5`. DFRobot's FireBeetle 2 ESP32-C5 is not a variant: a
  4 MB part with no PSRAM, which the 8 MB build does not fit.
- **5 GHz on the C5** (`--channel 36`): the fox's own scan lists 5 GHz
  networks on 10.3.2, and a receive-side check needs nothing more. An
  access point on channel 36 is another matter: 10.3.2's `start_ap` takes
  channels 1–13 only (`ValueError`), so foxlib 1.11.2 says
  `note: channel 36 refused … on channel 1 instead` once and the fox goes on
  the air on channel 1 — `--payload` then prints `NOTE: asked for channel
  36, on the air on channel 1`. Newer builds (CircuitPython `main` after
  10.3.2) take 5 GHz channels and raise `ValueError` only for a channel the
  country setting forbids; the test proper is the same line with one of
  those builds flashed, a laptop adapter that hears 5 GHz (`nmcli dev wifi
  list` shows CHAN above 14 for some network around), and the expectation
  `on channel 36 as asked`. `wifi-probe` takes `--channel` as its one
  channel (`net.channels`); a probe on 36 needs a sniffer that listens
  there.
- **Waveshare ESP32-S3-Nano** (`esp32s3` → Waveshare): the Arduino Nano
  ESP32 build. `board.LED` is the descriptor's guess (the Nano's GPIO48
  builtin); the RGB trio is `LED_RED/GREEN/BLUE` — switch the LED pin on the
  wiring card to one of those if `LED` is not in `dir(board)`.
- **XIAO nRF52840 / Sense** (`nrf52840`, the default variant): `ble-beacon`
  and `puzzle-beacon` only. CircuitPython goes on as a `.uf2`: double-tap
  the reset button beside the USB-C port, the `XIAO-SENSE` drive appears,
  copy the file from the board page onto it, the board reboots and
  `CIRCUITPY` appears (the page's UF2 copier is RP2040-only, so this is the
  file manager). Reports `Seeed_XIAO_nRF52840_Sense` — mixed case, both the
  plain and the Sense board. The user LED is RGB and active low; foxlib
  drives the red channel and does not honour `active_low` yet, so expect
  it inverted (lit while off) and note the direction. 256 KB RAM: `mem=`
  should sit well above the C3's. No Wi-Fi, so no `--payload` or
  `--checkpoint`; the bench line is the C3's with `--board nrf52840`. The
  2.4 GHz BLE beacon is the one thing to check from a phone. **The nRF52
  watchdog is one-way**: once a fox has armed it, a soft reboot (deploy,
  reload, Ctrl-D) leaves it counting; foxlib 1.11.4 adopts it (`watchdog
  adopted(90s)` in the banner) so the fox is fine, but a board left at the
  REPL for more than `limits.watchdog_s` resets into safe mode (safemode.py
  restarts the fox). Keep bench phases under 90 s, or power-cycle between
  them; `hw_smoke`'s phases are well inside that.
- **Nano 33 BLE Rev2** (`nrf52840`): `ble-beacon` and `puzzle-beacon` only. CircuitPython goes
  on with `bossac` (double-tap reset → the Arduino bootloader; the
  circuitpython.org page has the command); the page then deploys over the
  REPL as for any board. Reports `arduino_nano_33_ble_rev2`.

## 4 onward: C6 ×2, S3, C5, nRF52840

Same shape as 3 with `--board esp32c6` etc. and `--variant` where the chip
has several boards (`--variant waveshare_esp32s3_nano`). The per-board
gotchas (inverted LED on the C6, DevKit pin names on the C5, `bossac` for the
Nano 33) are in the network-fox tick-list below under *Per-board notes*. A chip
target flips to stable only when every variant has its row.

## When the bench is packed up

The one checklist that turns a session into catalog state. Everything the
page and the templates claim about a board comes from these steps, so a
session that skips them did not happen as far as the repository knows (the
S3's five network templates were run on 2026-11-17/18 and still say
`boards_tested: []` for exactly this reason).

1. **The report.** `hw_smoke.py --report NAME.json` wrote one; a session run
   from the page alone has none — run `hw_smoke.py` once at the end with
   `--observe 5` for the templates you ran, so the row has a source. Reports
   carry the uid and the callsign: keep them out of git (`git rm --cached`
   one that got in; the fixtures directory is for recordings, not reports).
2. **The recording**, if you made one (`--record tests/fixtures/bench/<board>-<date>.json`):
   format 2 is scrubbed (callsign → `W1ABC FOX DE W1ABC`, neighbours →
   `neighbour-N`), so it can be committed as is.
3. **Close the session**, dry run first, then `--apply`:

   ```
   python3 tools/session_close.py NAME.json --page <page version> [--recording tests/fixtures/bench/…json] [--note "…"]
   python3 tools/session_close.py NAME.json --page <page version> … --apply
   ```

   This appends the hardware-log row in the shape `bench_queue.py` matches
   and adds the target to `boards_tested` in every template that booted and
   keyed. The two must move together: `bench_queue.py --check` (CI) fails on
   a `boards_tested` entry whose target has no row.
4. **Status flips are yours.** `session_close` prints the flip it would
   recommend (`experimental → stable`, template or target); make it by hand
   after reading the recording, not because seven boots were clean. A
   stable target with no row fails CI; so does a stable template with an
   empty `boards_tested`.
5. `python3 tools/replay_check.py tests/fixtures/bench/<the new one>.json`
   — CI replays every fixture; see it pass once here.
6. `python3 tools/check_docs.py && python3 tools/bench_queue.py --check && python3 tools/check_catalog.py --since origin/main`.
7. Bump `VERSION` in `js/main.js` by hand if a template's `boards_tested`
   changed (the Behavior tab reads it) and add the CHANGELOG line; the
   version lint does not watch `firmware/templates/`, so it will not remind
   you.
8. Open questions the session answered: move the answer into the Q-table
   above, and the detail into the board's section.

## A new board, module or CircuitPython build (first session)

The simulator and the page tests prove the code; this is the list for the
thing they cannot prove. Run it the first time a new board family, a new
radio module, a new carrier PCB or a new CircuitPython release crosses the
bench, and again before relying on a changed `foxlib`. It takes about
twenty minutes with the fox on a dummy load.

Everything here is also what `tools/hw_smoke.py` does automatically for
the templates; the manual steps are the ones that need eyes, ears or a
receiver.

> Add `--record <board>-<what>-<date>.json` to the `hw_smoke.py` line and commit the file under `tests/fixtures/bench/`: the session becomes a CI test (the Recordings section below).

### Before plugging in

- [ ] Antenna or dummy load on the module's RF connector. The fox keys
      within seconds of every reboot.
- [ ] Battery disconnected or known-charged; USB only for the session.
- [ ] Note the board, module, carrier revision and CircuitPython build
      (`os.uname().version`) in the fleet notes or the hardware report.
- [ ] Browser is Chrome or Edge on a laptop; the page is the current
      deploy (version in the top bar matches the repo tag you mean to test).

### Bare board → CircuitPython

- [ ] Bootloader entry works as the Board tab describes it (hold B, plug in).
- [ ] Flash the CircuitPython `.bin` for this board id; the board re-enumerates
      as a serial port (no CIRCUITPY drive on the C3; one on most others).
- [ ] A board with a CIRCUITPY drive: `boot.py` copied onto it from the
      flash card's step 2, ejected, reset. The drive comes back read-only
      on the computer; Deploy's check passes without instructions.
- [ ] **Connect** finds a prompt without a reset. If it needs the R button
      first, say so in the hardware report; that is a timing difference
      worth knowing per board.
- [ ] Board tab shows the right board id, a UID, the CircuitPython
      version and "no fox firmware".

### First deploy (morse-songs, default frequency, real callsign)

- [ ] Deploy writes foxlib (the template's set: 14 files for an FM fox, 16 for a network fox; the rest of `foxlib/` removed as stale) and the three files; every write logs a CRC.
- [ ] Banner: `cfg=ok radio=ok id=set`, and `freq=` is what the plan said.
      `radio=noreply` means the module did not answer on the UART: check
      PD is high, TX/RX not swapped, 9600 baud, module powered.
- [ ] Transmission audible on a handheld on the frequency: ID in Morse,
      then the song; no transmission between cycles.
- [ ] LED pattern matches what the About tab lists for a normal cycle.
- [ ] **Listen only** on a second tab/reconnect shows the fox's own output
      without stopping it; **Re-read board** stops it and reads the files;
      **Restart fox** brings the banner back.

### Bench tab

- [ ] Probe reports the band the module is fitted for, and only that band.
- [ ] RSSI reads with the handheld transmitting nearby, and drops when it stops.
- [ ] Battery reads within 0.05 V of a meter across the pack, with the
      divider the Board tab describes. If not: `battery.calibration`.
- [ ] Key test, 3 s: the handheld hears carrier; nothing after it ends.
      The first bench action after a reboot is slow (foxlib compiles) — note
      how slow; `hw_smoke.py` records it as `import_s`.

### Measurements (one template is enough; put numbers in the hardware report)

- [ ] Output power on low and high into the dummy load, in dBm. Enter the
      measured value on the Radio tab so profiles carry it.
- [ ] Peak deviation on a tone, in kHz. Set it on the Payload tab's
      spectrum panel so the occupied-bandwidth estimate matches reality.
- [ ] Current draw idle / keyed, for the battery-life note.
- [ ] Nothing audible on the adjacent channel with the handheld's squelch
      at the usual setting.

### Every other template, briefly

`python3 tools/hw_smoke.py --port … --call "…" --yes-antenna` does this:
each template deployed, banner read, a few seconds observed, probe/RSSI/
battery/key run on a fresh VM, memory and import time recorded, and the
previous files put back. Keep the JSON report next to the hardware report;
diff it against the last one the next time anything changes.

- [ ] All templates `ok` in the summary table.
- [ ] `free B` is not alarmingly low (under ~20 kB on a C3 means a future
      foxlib change could fail to import).
- [ ] SSTV: a decoder (phone app is fine) shows the test card from the
      handheld's speaker.
- [ ] QRSS: a single dit is the configured seconds long and the module
      stays keyed for all of it.
- [ ] Rotator: the handheld needs retuning after each cycle; with
      `announce_qsy` the next frequency is sent before the move.
- [ ] Popcorn / resurrection: the Schedule tab's timeline matches what the
      fox does for the first few events with the same seed.

### Afterwards

- [ ] Add a row to `docs/hardware-log.md`: date, board, firmware (version and
      the site build's commit), what was checked, how, result.
- [ ] Add the board id to `boards_tested` in each `template.json` that
      passed (the catalog lint checks the id exists).
- [ ] If the board is new: its hardware descriptor in `hardware/` (+ index
      row), a target in `boards/`, a defaults file per template
      (CONTRIBUTING.md (Adding a target)), and the silkscreen note for the Board tab
      if the pin names differ from the printed ones.
- [ ] File a hardware report issue with the measurements, or add them to
      the module descriptor if they belong there (nominal power).
- [ ] Fleet log CSV downloaded; the UID will be the key for this board forever.

### Before a fox leaves the bench: Audit

Fleet tab → **Audit the connected fox**. With a fox connected (REPL), listening
(console) or its drive open, it reads what the fox is — chip UID, template,
callsign, frequencies, and the banner's `cfg`/`radio`/`id` when there is one —
and compares that with the last deploy the fleet log holds for that UID
(by board, for the vendor PicoFox, which exposes no UID). A PicoFox on
fox-bench firmware tells its UID in `board.json` on the drive (firmware
0.1.4+), so drive deploys carry it too; deploys logged before that have no
UID, and the audit falls back to the board's last UID-less deploy, saying so
in the row. The verdict and
any differences go into the log as an `audit` row with your note (box label,
hider, battery state), so the CSV tells each fox's story: flashed → deployed
→ audited → whatever you record next. It compares the fox with the *log*, not
with the form, so an edited-but-not-deployed form never passes as deployed.

## Recordings

A bench run on a real board, saved so it can be repeated without one.

```
python3 tools/hw_smoke.py --port /dev/ttyACM0 --call "W1ABC FOX DE W1ABC" --yes-antenna --record bench.json
python3 tools/replay_check.py bench.json
```

`--record` writes every REPL exchange of the run to a JSON file: each
raw-mode command and the board's reply, each soft reboot and the boot text
up to the banner, and what the fox printed while the script listened. The
file also carries the board id, uid, CircuitPython and foxlib versions, and
the arguments the run was made with.

`firmware/sim/pty_board.py --replay bench.json` is the pty board answering
from that file instead of running code: a command is looked up by its
text and gets the recorded reply, a soft reboot gets the recorded boot
text. Timing and chunking do not matter; only the text does. A command the
recording never saw gets a `ReplayError` reply naming it, so a changed
`hw_smoke.py` fails loudly instead of hanging. The one exception is
`f.write(…)`: the bytes of the files being written change with every
foxlib or catalog release, so an unrecorded write is answered like every
real one (silence) and counted as a content write rather than a miss —
the recording tests the script's commands and the board's replies, not
the firmware's text. A run made with `--payload` or `--checkpoint` also
records what the computer's Wi-Fi saw and did (`host` lines: scan, join,
DNS, portal); `replay_check.py` hands those back to `hw_smoke.py` with
`--host-from`, so the replay needs no adapter and reaches the same verdict,
`finds.csv` row included. The run's callsign becomes `W1ABC FOX DE W1ABC`
in a recording and the laptop's MAC in the `finds.csv` read-back a
placeholder; the `N0CALL` placeholder is left as it is (it is nobody's).

`tools/replay_check.py` ties the two together — starts the replay board,
runs `hw_smoke.py` with the recorded arguments, and exits 1 unless every
template passed, every command was found, and the uid matches. CI runs it
on every file under `tests/fixtures/bench/`.

### What a recording is for

- **A board you no longer have on the desk.** The first session with a
  new board records; from then on the run is a CI test of the script and
  the catalog against that board's actual replies.
- **A bench finding.** When a session finds a bug (2026-10-25: two of
  them), the recording of the failing run, committed before the fix, is
  the regression test; after the fix it is re-recorded.
- **A change to `hw_smoke.py`.** Replay all recordings: a miss shows which
  command changed.

### What it is not

The board's replies are fixed text. A replay cannot find a firmware bug —
it finds script and catalog regressions against replies a real board once
gave. Nor does it cover the serial layer's timing (partial reads, the
swallowed first Ctrl-C), which `tests/unit/repl-link.test.mjs` covers for
the page and the live pty board covers for the script.

### Files

| | |
|---|---|
| `tests/fixtures/bench/sim-esp32c3-fm.json` | all seven FM templates against the pty board itself, recording format 2 (so CI has one from day one; a real-board C3 recording should join it after the first session that boots) |
| `tests/fixtures/bench/sim-esp32c3-foxlibc-console.json`, `sim-picofox-foxlibc-console.json` | the console client against `pty_board.py --console <target>` (a fake foxlib-c console: file store, banner from the fox.json it holds, bench words): `"transport": "console"`, replayed in line mode. From the fake, not a board — the first real recordings replace nothing, they join |

A run made with `--sniffer` records the fox's exchanges only; replaying it
needs the sniffer side too — start `firmware/sim/pty_sniffer.py --mac … --ssid …`
on a second pty and pass it as `--sniffer`, the way `ci.yml`'s sniffer step
does. `replay_check.py` does not do this yet; a `--sniffer` recording is a
manual replay.

A console recording replays with the same command; `pty_board.py` reads
`"transport": "console"` from the file and answers in line mode.

Name real-board recordings `<board>-<what>-<date>.json`, e.g.
`seeed_xiao_esp32c3-all-fm-2026-11-12.json`, and say in
`docs/hardware-log.md` which recording a row produced.
