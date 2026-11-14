# Network foxes on the bench — first sessions per board

The tick-through list for the network-fox templates (`wifi-beacon`,
`wifi-probe`, `ble-beacon`) on the bare boards. One pass per board; each
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

## The pass (every board)

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
11. **Hardware-log row**: date · board (variant) · firmware (foxlib 1.2.0,
    CircuitPython version, build id) · checked (which of 2–10) · how (phone
    apps) · result. A chip target goes `stable` once every one of its
    variants has a clean row for 2–9 (the C5 needs both boards; the S3 both
    boards); the templates list the chip in `boards_tested` then.

## Payloads (phase B, foxlib 1.4.0) — on any board that passed 2–9

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

## Stealth (phase C, foxlib 1.5.0)

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

## Per-board notes

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
- **Nano 33 BLE Rev2** (`nrf52840`): `ble-beacon` only. CircuitPython goes
  on with `bossac` (double-tap reset → the Arduino bootloader; the
  circuitpython.org page has the command); the page then deploys over the
  REPL as for any board. Reports `arduino_nano_33_ble_rev2`.
