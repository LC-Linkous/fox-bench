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
ls /dev/ttyACM*                                   # Linux; on Windows use COMx everywhere below
```

Each CircuitPython run below writes `hw_smoke-<uid>-<time>.json` (the report)
and, with `--record`, a replay fixture. Keep both; the report drives
`tools/session_close.py`, the fixture becomes a CI test. The page version is
the footer of the deployed site (tag first so the row names a release,
not a build; the numbers below are the current ones — `bench_queue.py`
prints them).

## 1. PicoFox re-run (foxlib-c 0.1.11 / page 0.12.0)

This one is from the page, not the script (foxlib-c is compiled firmware).
Board tab → connect over the touch → flash `foxbench-picofox-0.1.11.uf2` from
the site → Behavior tab deploy one template → listen on a handheld. Then write
its row by hand in the 0.1.10 row's shape (`session_close.py` only reads
`hw_smoke` reports). Row date, board `AI6YM PicoFox rev 3`, firmware
`foxlib-c 0.1.11, site build <id from the console>, page 0.12.0`.

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
`pty-c3-all-fm.json`'s "should replace" note.

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

## The network-fox tick-list (every bare board)

The tick-through list for the network-fox templates (`wifi-beacon`,
`wifi-probe`, `ble-beacon`, `puzzle-beacon`) on the bare boards. One pass per board; each
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

### The pass (every board)

Board tab → **Show experimental targets** → the chip under **CircuitPython
board**. Radio tab → wiring card: the **Board** dropdown names your board
when the chip has more than one; the LED pin is the descriptor's default.

1. **Flash CircuitPython** (Board tab → Flash CircuitPython card, the `.bin`
   from the linked circuitpython.org page; the nRF52840 by `bossac` by hand).
   Connect: the Board tab's *Board id* shows what the board reports; for a
   sibling build it says "the … runs this build". Record the id.
2. **wifi-beacon**, defaults (SSID `FOXBENCH WiFi Beacon`, channel 1, 17 dBm,
   open; callsign on the ID tab; wake 15 / off 5, sleep **off**). Deploy.
   Banner: `cfg=ok radio=ok id=set freq=none net=wifi-ap name="FOXBENCH WiFi
   Beacon" mac=F2:B0:00:00:00:01`; then `cycle 0`, `wifi-ap up … for 15 s`,
   `wifi-ap down`, `sleep 5 s`. `cfg=partial(pins.led)` means the LED name in
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
   → `ok wifi-ap <name> for 3.0 s`.
9. **ble-beacon**, defaults (UUID `F0B0F0B0-0000-4000-8000-000000000001`,
   major 1, minor 1, name `FOXBENCH Beacon`, 100 ms, 0 dBm). Deploy; nRF
   Connect shows the iBeacon frame (Apple 0x004C, UUID / major / minor) and
   the name in the scan response, coming and going on the duty cycle.
   Callsign as name, `tx_power_dbm` −12 vs 9 against the app's RSSI.
10. **wifi-probe** (with the sniffer board on a second port): `hw_smoke.py
    --sniffer` reports `N probe(s) from F2:B0:00:00:00:05, N with SSID
    <callsign>` during the observe window and fails the template at zero.
    By hand: the sniffer's serial output is one JSON line per probe
    request; watch for the fox's MAC with the callsign as SSID, every
    cycle, on channels 1/6/11. The board never joins anything.
11. **Hardware-log row**: date · board (variant) · firmware (foxlib version,
    CircuitPython version, build id) · checked (which of 2–10) · how (phone
    apps) · result. A chip target goes `stable` once every one of its
    variants has a clean row for 2–9 (the C5 needs both boards; the S3 both
    boards); the templates list the chip in `boards_tested` then.

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

### Per-board notes

- **XIAO ESP32C3** (`esp32c3`): the firmware path is the proven one (same
  board as the FM fox). No LED: step 3's LED check is "stays dark". First.
- **XIAO ESP32C6** (`esp32c6`, two boards): own build; LED on GPIO15, active
  low — the blink is inverted if the descriptor's `active_low` is honoured
  wrongly, note which way it blinks. Run one board radio-off and the other
  deep-sleep for a side-by-side of USB behaviour.
- **XIAO ESP32S3** (`esp32s3` → XIAO ESP32S3): own build; fit the antenna.
- **XIAO ESP32C5** and **FireBeetle 2 ESP32-C5** (`esp32c5`): both run the
  DevKitC-1-N8R8 build and report the same id, so pick the Board dropdown
  by hand before connecting; the console says "a build shared by …". The
  pin names (`IO27`, `IO15`) follow the DevKit's naming — confirm from
  `dir(board)`. 5 GHz: channel 36 appears in the channel list; a 5 GHz-
  capable phone sees it, a 2.4-only one does not (CircuitPython's 5 GHz AP
  support on the C5 is the open question). If both boards pass, the DevKit
  build is good for the chip; if one fails, the difference is the board.
- **Waveshare ESP32-S3-Nano** (`esp32s3` → Waveshare): the Arduino Nano
  ESP32 build. `board.LED` is the descriptor's guess (the Nano's GPIO48
  builtin); the RGB trio is `LED_RED/GREEN/BLUE` — switch the LED pin on the
  wiring card to one of those if `LED` is not in `dir(board)`.
- **Nano 33 BLE Rev2** (`nrf52840`): `ble-beacon` and `puzzle-beacon` only. CircuitPython goes
  on with `bossac` (double-tap reset → the Arduino bootloader; the
  circuitpython.org page has the command); the page then deploys over the
  REPL as for any board. Reports `arduino_nano_33_ble_rev2`.

## 4 onward: C6 ×2, S3, C5 pair, nRF52840

Same shape as 3 with `--board esp32c6` etc. and `--variant` where the chip
has several boards (`--variant dfrobot_firebeetle2_esp32c5`). The per-board
gotchas (inverted LED on the C6, DevKit pin names on the C5, `bossac` for the
Nano 33) are in the network-fox tick-list below under *Per-board notes*. A chip
target flips to stable only when every variant has its row.

## When the bench is packed up

1. `git status` — the reports and recordings; commit the fixtures under
   `tests/fixtures/bench/`, not the reports (they carry the uid).
2. `python3 tools/replay_check.py` so CI replays what you recorded.
3. `python3 tools/check_docs.py && python3 tools/bench_queue.py --check`.
4. Bump `VERSION` in `js/main.js` by hand if a template's `boards_tested`
   changed (the Behavior tab reads it) and add the CHANGELOG line; the
   version lint does not watch `firmware/templates/`, so it will not remind
   you.

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
- [ ] **Connect** finds a prompt without a reset. If it needs the R button
      first, say so in the hardware report; that is a timing difference
      worth knowing per board.
- [ ] Board tab shows the right board id, a UID, the CircuitPython
      version and "no fox firmware".

### First deploy (morse-songs, default frequency, real callsign)

- [ ] Deploy writes foxlib and the three files; every write logs a CRC.
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
the firmware's text.

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
| `tests/fixtures/bench/pty-c3-all-fm.json` | all seven FM templates against the pty board itself (so CI has one from day one; a real-board recording should replace it after the first session) |

A run made with `--sniffer` records the fox's exchanges only; replaying it
needs the sniffer side too — start `firmware/sim/pty_sniffer.py --mac … --ssid …`
on a second pty and pass it as `--sniffer`, the way `ci.yml`'s sniffer step
does. `replay_check.py` does not do this yet; a `--sniffer` recording is a
manual replay.

Name real-board recordings `<board>-<what>-<date>.json`, e.g.
`seeed_xiao_esp32c3-all-fm-2026-11-12.json`, and say in
`docs/hardware-log.md` which recording a row produced.
