# fox.json — configuration contract

`fox.json` lives at the board root. The page writes it in full; the
firmware (`foxlib/cfg.py`) merges it over the template's defaults file
(`defaults/<target id>.json` in the repo, written to the board as
`defaults.json`), validates every field, and reports the result
in the boot banner. Both sides validate against this document.

Rules that apply everywhere:

- Unknown keys are ignored and reported as `cfg=partial(...)` so typos
  surface.
- A field that fails validation falls back to its default and is named
  in the banner. The fox still runs.
- A file that fails to parse → every default, `cfg=default(parse)`.
- No file → every default, `cfg=default(missing)`.
- On the C firmware (`foxlib-c`), a file longer than its buffer (24 575
  bytes) or with more JSON values than its parser holds (4096; a note is
  three values) → every default, `cfg=default(too_large)`. The page checks
  the same limits before it writes (`js/model/foxlibc-limits.js`, kept equal
  to the C headers by `firmware/foxlib-c/tests/parity.py`): at most 16 songs
  of 256 notes, 16 frequencies, 4 ranges, a 64-byte callsign.
- Types are strict: `146.565` not `"146.565"`; `true` not `1`. JSON has
  one number type, so an integer field accepts `3.0` as `3`.
- A top-level value that is not an object (a list, `null`) is treated as
  an empty file: every default, `cfg=ok`.
- `fleet` is merged over the template's `fleet` block, key by key; the
  firmware never reads it.
- Both validators are run over the same corpus in CI
  (`firmware/sim/schema_corpus.json`, `schema_parity.py`, `schema_parity.mjs`)
  and must agree on the effective configuration and the banner status,
  including the order of the keys named in `partial(...)`.

## Top level

```json
{
  "schema": 1,
  "template": "morse-songs",
  "board": "seeed_xiao_esp32c3",
  "module": "sa868_vhf",
  "pins": { … },
  "radio": { … },
  "plan": { … },
  "id": { … },
  "payload": { … },
  "schedule": { … },
  "battery": { … },
  "limits": { … },
  "fleet": { … }
}
```

| key | type | notes |
|---|---|---|
| `schema` | int | `1`. The page migrates older files forward; the firmware refuses a newer schema (`cfg=default(schema)`). |
| `template` | string | Must equal the template id of the `code.py` on the board. Mismatch → `cfg=default(template)`. |
| `board` | string | the target id (`boards/<id>.json`), which for most boards is also CircuitPython's `board.board_id`. Mismatch with the running board → `cfg=default(board)`: pins from another board are never applied. A target that runs a sibling board's CircuitPython build (`hardware.circuitpython.board_ids`) reports that sibling's id; the firmware then accepts a `fox.json` naming the same target as the `defaults.json` deployed with it, since the page writes both for one target. |
| `module` | string | A `modules/<id>.json` id. Used by the page for range validation; the firmware uses `radio.ranges_mhz` below, which the page copies in. |

## `pins`

Role → pin name as exposed by the CircuitPython `board` module.

```json
"pins": { "ptt": "D3", "pd": "D4", "hl": "D5", "uart_tx": "D6", "uart_rx": "D7",
          "audio": "D1", "led": "D10", "batt_sense": null }
```

| role | required | constraint |
|---|---|---|
| `ptt` | yes | digital out. Low = transmit. |
| `pd` | yes | digital out. High = module awake. |
| `hl` | yes | digital out. Low = low power. |
| `uart_tx` | yes | board flag `uart_tx` |
| `uart_rx` | yes | board flag `uart_rx` |
| `audio` | yes | board flag `pwm` |
| `led` | no | digital out, or `null` (no status LED) |
| `batt_sense` | no | board flag `adc`, or `null` (no divider fitted — never read a floating pin) |

No two roles may name the same pin. A pin name that `board` does not
have → that role falls back to the default and is named in the banner.
If a **required** role has no valid value even after fallback, the fox
boots silent with `cfg=fatal(pins.ptt)` and the `unconfigured` LED
pattern, because keying unknown pins is worse than not keying.

## `radio`

```json
"radio": { "family": "dmo", "ranges_mhz": [[134.0, 174.0]],
           "bandwidth_khz": 25.0, "squelch": 3, "volume": 5,
           "high_power": false, "power_dbm": null }
```

| key | type | range | notes |
|---|---|---|---|
| `family` | string | `dmo` | selects the `foxlib/radio.py` driver by control protocol. `dmo` = NiceRF AT dialect (SA818/SA818S/SA868/SA868S/DRA818). Copied from the module descriptor. |
| `ranges_mhz` | [[lo, hi], …] | | copied from the module descriptor; the firmware drops any plan frequency outside them |
| `bandwidth_khz` | number | 1–100 | requested channel width. The driver uses the nearest width the module supports (DMO: 12.5 or 25) and the page warns when it is not exact. |
| `squelch` | int | 0–8 | receive-side; no audible effect on a transmit-only fox |
| `volume` | int | 1–8 | receive-side; same note |
| `high_power` | bool | | `hl` pin high. Default `false`. The DMO modules have exactly two levels; this is the only power control the firmware has. |
| `power_dbm` | number or null | 0–40 | the measured or nominal output of the selected level, recorded for profiles and the fleet log. The firmware ignores it. |

### `radio` for the `si5351fm` family (foxlib-c targets: the PicoFox with fox-bench firmware)

Boards of the `foxlib-c` device family have the radio on the board, so there
is no `pins` section (the validators skip it) and the `radio` keys describe
the Si5351 exciter. `squelch`, `volume` and `high_power` have no meaning there.

| key | type | range | notes |
|---|---|---|---|
| `family` | string | `si5351fm` | |
| `itu_zone` | int | 1–3 | zone 1 is 144–146 MHz, 2 and 3 are 144–148. The firmware also refuses to key within 20 kHz of a band edge (`radio=band_edge`) |
| `attenuation` | int | 0–127 | BVA1761 steps of 0.25 dB on rev 3 boards; ignored on rev 2 (the firmware detects the revision) |
| `id_deviation_hz`, `audio_deviation_hz` | int | 500–10000 | peak FM deviation of the Morse ID and of the payload |
| `tone_shape` | `sine` \| `bright` | | `bright` adds the odd harmonics a PWM square wave has |
| `preemphasis` | bool | | 6 dB/octave boost of the highs relative to the highest tone of the stream, like a voice transmitter |
| `correction_ppm` | number | −200…200 | reference (TCXO) correction applied to every frequency |
| `sample_rate` | int | 4000–10000 | FM update rate: PLL fraction writes per second. 8000 is the design point |
| `tx_while_mounted` | bool | | `true` (default): the fox runs with the FOXBENCH drive mounted and reloads ~1.5 s after the host's last write. `false`: silent until the drive is ejected or unplugged |

## `plan`

```json
"plan": { "frequencies_mhz": [146.565], "announce_qsy": false }
```

| key | type | notes |
|---|---|---|
| `frequencies_mhz` | [float, …] | at least one. One entry = fixed frequency. More = rotate after each transmission. Entries outside `radio.ranges_mhz` are dropped with a banner note; if none survive, `cfg=fatal(plan)` and the fox stays silent. |
| `announce_qsy` | bool | with more than one frequency, send `QSY <next>` in Morse before moving. |

The page additionally checks each entry against the selected region's
band plan (`bands.json`) and names the test an entry failed — as a
warning that Deploy asks to confirm ("Deploy anyway?"), not a rejection.
The firmware checks only the module range (foxlib), plus a 20 kHz margin
inside the 2 m band edges (foxlib-c).

## `id`

```json
"id": { "callmessage": "N0CALL DECOY DECOY N0CALL", "placeholder": "N0CALL",
        "wpm": 12, "tone_hz": 800, "telemetry": ["batt"],
        "tx_without_callsign": false }
```

| key | type | range | notes |
|---|---|---|---|
| `callmessage` | string | 1–64 bytes of UTF-8 (the C firmware's buffer; ASCII is one byte per character) | sent in Morse each transmission. Characters outside the Morse table are skipped. |
| `placeholder` | string | | sentinel. If it appears in `callmessage`, the callsign is unset. Do not personalise. |
| `wpm` | int | 5–40 | PARIS timing |
| `tone_hz` | int | 300–3000 | |
| `telemetry` | [string] | subset of `["batt", "chg"]` | words appended to the ID. `batt`: `BAT 3V7` from the battery divider (ignored when `pins.batt_sense` is `null`, and on boards without one). `chg`: the word `CHG` while the charger is active — boards with a charger-status line (the PicoFox); never appears off USB power; ignored elsewhere. |
| `tx_without_callsign` | bool | | **default `false`**: with the placeholder present the fox boots, prints `id=unset`, never keys PTT, and shows the `unconfigured` LED pattern. `true` restores warn-and-transmit. |

## `payload`

Exactly one `kind`. The template manifest's `sections` says which kinds
the template reads; the composite template reads all.

### `songs`

```json
"payload": { "kind": "songs", "articulation": 0.875, "skip_on_low_battery": true,
             "playlist": [
               { "name": "Auld Lang Syne", "tempo": 90,
                 "notes": [[55, 8], [60, 12], [60, 4]] } ] }
```

| key | type | range | notes |
|---|---|---|---|
| `articulation` | float | 0.5–1.0 | fraction of each note slot that sounds |
| `skip_on_low_battery` | bool | | ID only when the battery is low |
| `playlist` | [song] | ≥1 | played in order, one per transmission, wrapping |
| `song.tempo` | int | 40–300 | quarter notes per minute |
| `song.notes` | [[midi, dur32]] | midi 0–127 (0 = rest), dur32 1–64 | duration in 32nds of a whole note |

### `sstv`

```json
"payload": { "kind": "sstv", "mode": "robot36-gray", "images_file": "images.bin",
             "skip_on_low_battery": true }
```

Images are a payload file the page generates (see the template
manifest), not part of `fox.json`. `images.bin` layout: `u8 count`, then
per image `u8 width, u8 height, u8 name_len, name, width*height bytes`.
Robot 36 at 40 px/line is ~37 s keydown per image regardless of content.

### `none`

```json
"payload": { "kind": "none", "dit_s": 3.0, "message": null }
```

Nothing follows the ID. `dit_s` overrides the Morse element length for
the ID itself (QRSS); `null` keeps `id.wpm`. `message` replaces the ID
text when set (must still contain a callsign; the page enforces it).
Range `dit_s` 0.05–30. There is no upper bound on resulting keydown
other than `limits.max_keydown_s`.

## `schedule`

Exactly one `kind`.

```json
"schedule": { "kind": "fixed", "delay_ms": 30000 }

"schedule": { "kind": "popcorn", "seed": 18, "cluster": 2,
              "cluster_gap_ms": 8000, "dark_min_ms": 10000, "dark_max_ms": 300000 }

"schedule": { "kind": "resurrection", "seed": 1, "delay_ms": 30000,
              "alive_min_ms": 1800000, "alive_max_ms": 3600000, "dead_ms": 3600000,
              "dit_min_ms": 180000, "dit_max_ms": 300000, "id_every": 3,
              "dead_song": false }
```

All durations are ints in milliseconds, ≥ 0; `*_min ≤ *_max`. `seed` is
an int 0–2³¹−1 for the glibc-constant LCG in `foxlib/schedule.py`; the
page runs the same generator to draw the timeline, and the fleet log
records the seed so organisers can reconstruct every transmission time.

## `battery`

```json
"battery": { "divider_ratio": 2.0, "calibration": 1.0, "samples": 16,
             "low_v": 3.5, "critical_v": 3.3, "recovery_v": 3.4 }
```

Ignored when `pins.batt_sense` is `null`. Constraint
`critical_v < recovery_v ≤ low_v`. Below `low_v`: payload skipped if the
payload says so, LED pattern `low`. Below `critical_v`: no transmissions,
LED `critical`, recheck every 60 s, resume above `recovery_v`.

## `limits`

```json
"limits": { "max_keydown_s": null, "watchdog_s": 90, "recover": true }
```

`recover` (foxlib 1.6.1; the Behavior tab's "enable automatic recovery
attempts", default `true`): `false` is the pre-1.6 behaviour, for finding
out what a fox dies of — the watchdog is not armed whatever `watchdog_s`
says, a cycle that raises stops the fox with a traceback, and `safemode.py`
reads this key and leaves the board in safe mode. The module is re-tuned
before every transmission either way.

`watchdog_s` (foxlib 1.6; `null` or 10–3600, the ESP32-C3 defaults say 90)
arms the hardware watchdog when the cycle loop starts; every wait in foxlib
feeds it, so a board whose interpreter has hung resets instead of staying
silent. The reset lands in safe mode, where `safemode.py` (written beside
`code.py` with foxlib) resets again into a normal boot; the same file
brings a board back after a brownout. Not read by foxlib-c. A bench session
(`Fox(quiet=True)`) never arms it.

`null` = no limit from the configuration, and no template sets one. When
a number (1–7200) is set in the UI, the firmware unkeys when a single
transmission reaches it, logs `keydown-limit`, and shows that LED pattern
once. The page displays computed airtime per transmission next to this
field. **foxlib-c** additionally caps any single transmission at 600 s
(+2 s grace) when no limit is set — a wall-clock guard on core 0 — so a
QRSS message longer than ten minutes is cut on the PicoFox; the Deploy tab
warns when the worst-case transmission exceeds it.

## `fleet`

```json
"fleet": { "profile": "Fox 3 — 146.565", "number": 3, "event": "", "notes": "", "owner": "W1ABC", "points_to": 2 }
```

`points_to` (page 0.16) names the fox this one leads to — a saved
profile's fox number, or its name. Text anywhere else in the file may then
carry `{{to.freq}}` (an FM fox's first frequency, "146.565"),
`{{to.name}}` (a network fox's name on the air), `{{to.code}}` (its portal,
BLE-service or beacon code), `{{to.number}}`, `{{to.callsign}}`; the page
fills them from that profile at deploy and validates the filled text, so
a portal body "Next: listen on {{to.freq}} MHz" or a Morse message "QSY
{{to.name}}" is checked at its real length. The editor keeps the
placeholders; an unresolved one blocks the deploy. The firmware never sees
a placeholder. The Fleet tab's **Handoff chain** lists who points to whom
and flags loops, self-references and missing targets; the event sheet
prints `→ N`.

The Deploy tab's **Fleet record** card edits `number`, `event`, `owner` and
`notes`. Every fleet-log row a deploy makes carries them, plus an
`on_air` column — a one-line summary of what a hunter could observe (name,
MAC, channel or list, power or range, iBeacon ids, payload frames, decoys,
start, portal code, schedule). The Fleet tab's **Event sheet** is the
latest deploy per chip uid, filtered by `event`, as a table, a CSV and a
print view: the field document for the day, built from the fleet log
alone.

Bookkeeping for the page. The firmware ignores this block entirely
(it is merged over the defaults' `fleet` block so no key is lost).
`owner` (page 0.14.1) is the operator's callsign when `id.callmessage` is
not it — a network fox left at the placeholder, a club fox — recorded in
fox.json and in the fleet log's `owner` column, never on the air; the ID
tab of a network fox has the field. Every fleet row is keyed by the chip
uid regardless, so a connected board is recognised with or without it.

## The `net` contract (network foxes on CircuitPython)

The `wifi-beacon`, `wifi-probe`, `ble-beacon` and `puzzle-beacon` templates use the SoC's
own radio as the transmitter — no module, no `module`/`radio`/`plan`/
`payload`/`battery`/`limits` sections, and a two-role `pins` section (LED,
battery sense) instead of the module wiring. They run on **chip targets**
(`boards/esp32c5.json` …), each covering the physical boards of that chip
as `variants`; the FM templates run on board + module targets, never both. `template.json` says
`"contract": "net"`, and the document is validated by
`firmware/foxlib/netcfg.py` on the board and `js/model/netschema.js` in the
page (held equal by `firmware/sim/schema_parity.*`). Everything that does
not fit falls back to the defaults file, reported in the banner as
`cfg=partial(<keys>)`, like the FM contract. The runner is
`firmware/foxlib/netfox.py`; the radios are `firmware/foxlib/netradio.py`.

| key | type | meaning |
|---|---|---|
| `board` | string | the **chip target** (`esp32c3`, `esp32c6`, `esp32c5`, `esp32s3`, `nrf52840`): the firmware is the same for every board of that chip |
| `variant` | string | the physical board (a hardware id: `seeed_xiao_esp32c5`, `dfrobot_firebeetle2_esp32c5`, …), recorded for the fleet and hardware logs; the page sets it from the Board dropdown on the Radio tab, or from the id a connected board reports |
| `pins.led` | pin name or `null` | the status LED, resolved with `getattr(board, name)`; `null` = no LED (the bare XIAO C3). Defaults come from the variant's descriptor |
| `pins.batt_sense` | pin name or `null` | reserved: a battery divider on an ADC pin; no board in the catalog has one wired |
| `net.kind` | `wifi-ap` \| `wifi-probe` \| `ble` | fixed by the template |
| `net.ssid` | string, 1–32 bytes | `wifi-ap`, `wifi-probe`: the network name on the air (unless `id.use_callsign_as_name`) |
| `net.psk` | string, empty or 8–63 bytes | `wifi-ap`: empty = open network (the page says so), otherwise WPA2 |
| `net.channel` | int | `wifi-ap`: 1–13, or one of 36 40 44 48 149 153 157 161 165 when the hardware lists the `wifi5` radio |
| `net.channels` | `[]`, up to 13 distinct channels, or `"any"` | `wifi-ap` (foxlib 1.8): one drawn per wake from the list, seeded by the chip uid and the cycle so a fleet does not hop together; `[]` = `net.channel` every wake; `"any"` is stored as 1–11 (the channels every region allows; the page's *any* button writes the region's own list) |
| `net.probe_ssids`, `net.probe_ssid_s` | ≤ 8 distinct names of 1–32 B; 0–600 s | `wifi-probe` (foxlib 1.8): other networks sought instead of `net.ssid` — one per wake drawn at random when `probe_ssid_s` is 0, else the next in list order every `probe_ssid_s` s inside the wake (a fresh round of probe requests each time) |
| `net.hidden` | bool | `wifi-ap`: **CircuitPython cannot hide an AP** — accepted and reported, the SSID is broadcast; `radio=ok(hidden_unsupported)` and a `note:` line in the banner |
| `net.max_clients` | 1–8 | `wifi-ap` |
| `net.name` | string, 1–32 bytes | `ble`: the complete local name (in the scan response, cut to 29 bytes) |
| `net.uuid` | 8-4-4-4-12 hex | `ble`: iBeacon proximity UUID |
| `net.major`, `net.minor` | 0–65535 | `ble` |
| `net.signal_power_dbm` | −128–0 | `ble`: the iBeacon calibration byte (measured power at 1 m) |
| `net.adv_min`, `net.adv_max` | 20–10240 ms | `ble`: advertising interval; `adv_min ≤ adv_max` |
| `net.tx_power_dbm` | Wi-Fi: one of 2 5 7 8.5 11 13 15 17 18.5 19 19.5; BLE: one of −12 −9 −6 −3 0 3 6 9 | radio power |
| `net.mac` | `XX:XX:XX:XX:XX:XX` | the address the fox uses, locally administered unicast (the defaults use `F2:B0:00:00:00:xx`); the Radio tab's **Random** draws one. Applied each time the radio comes up, with the Wi-Fi radio stopped, so nothing is sent under the chip's own address. On `ble` it is a static random address, whose two top bits must be set: the firmware sets them (`02:…` is on the air as `C2:…`) and says so. Every `… up:` line shows the address read back from the radio; if the build would not take it, a `note: MAC … was asked for, the radio reports …` line says so once |
| `id.callmessage` | string, 1–64 bytes | the operator's callsign — the fleet record. A network fox is a Part 15 device and need not identify: with the `N0CALL` placeholder it still runs under its configured name (banner `id=none`, the page warns); the placeholder is refused only when it would be the name on the air (`use_callsign_as_name`, banner `id=unset`) |
| `id.use_callsign_as_name` | bool | the callsign is the SSID / BLE name on the air (a ham fox hunt); off, the configured `net.ssid`/`net.name` is (a contest) |
| `schedule.kind` | `duty` | the only kind |
| `schedule.wake_s` | 1–3600 | radio up for this long each cycle |
| `schedule.sleep_s` | 0–86400 | then off for this long; 0 = always on |
| `schedule.sleep` | `off` \| `deep` | how the off time is spent: radio off with USB alive (the page keeps its connection), or **deep sleep** (`alarm`): the board reboots at the end, the USB port disappears meanwhile, the cycle count restarts at 0 |
| `led.enabled` | bool | status LED: 900/100 ms blink while the radio is up, a double flash every 2 s when unconfigured |
| `fleet.*` | | as the FM contract |

Deploy's **Precompiled (.mpy)** writes the template's set as bytecode
(`firmware/mpy/<CircuitPython major>/`, built by `tools/build_mpy.py` with
that major's `mpy-cross`) instead of the sources: the board skips the
compile, whose peak heap is several times the source and was more than the
ESP32-C3 had beside its radio stacks. A `.py` beside a `.mpy` would be
imported instead, so Deploy removes the other form as stale either way.

What Deploy writes to `foxlib/` is the set of modules the template imports
(`firmware/index.json` → `foxlib_sets`, derived by `tools/foxlib_deps.py`
from the import graph); files from another family already on the board are
removed as stale. Files on flash cost no RAM — only imports do — so this is
for deploy time and a board that looks like what it is, not for memory.

`safemode.py` resets the board back into a normal boot after a brownout or
a watchdog bite, up to 50 times in a row, but after a crash inside
CircuitPython itself (`HARD_FAULT`, `NO_HEAP`, `STACK_OVERFLOW` …) only 3
times: a crash repeats, and a board resetting every five seconds cannot be
connected to. It keeps the last reason in `microcontroller.nvm[1]`; Re-read
board shows it.

A network fox has no `limits` section: the hardware watchdog is always armed
at 90 s when the cycle loop starts (foxlib 1.10.6; `netfox.WATCHDOG_S`; with
`schedule.sleep = deep`, long enough to sleep through, since a nordic watchdog
cannot be stopped once armed) so a
fox that hangs in the field — the SoC's radio stack, a console write with
nobody reading — resets instead of staying silent until someone power-cycles
it; `safemode.py` brings it back as for an FM fox. It is switched off before
deep sleep and, by CircuitPython, after Ctrl-C. Two things outside `fox.json`
also change what a network fox does at boot:

- **CircuitPython's BLE workflow** (the board advertising itself as
  `CIRCUITPYxxxx`, on from boot on builds without native USB such as the
  ESP32-C3's) is switched off for the run — it gives the board away to any
  scanner and keeps the BLE stack busy beside the fox's own radio. The banner
  says so (`note: CircuitPython's own BLE advertising … is off while the fox
  runs`); it is back at the next reset.
- **`FOX_TRACE = 1` in `settings.toml`** (Deploy → *Trace the boot*, or
  `hw_smoke.py --trace`) makes the fox print every step of its start
  (`init: radios wifi24,ble (free 70000)` …) before the banner, so a board
  that hangs on the way up shows where. Off by default: nothing before the
  banner.

### Contest features (optional sections)

Four more sections, each **absent unless switched on** in the Payload tab
(docs/network-fox-payloads-plan.md). The firmware validates them like the
rest (bad keys fall back and are reported), names the enabled ones in the
banner as `features=payload,stealth`, and — until the phase that builds a
section lands — prints `note: <section> is accepted but not in foxlib X yet;
the fox runs without it`. The page says the same on each card.

| section | keys | phase |
|---|---|---|
| `payload` | `enabled`; `kind` static \| rotate \| morse-name; `names` (≤ 16 × 1–32 B); `morse_of` (≤ 16); `code.major` / `.minor` 0–65535; `eddystone.url` (http(s), ≤ 64) / `.tlm` bool / `.tlm_data` `{batt_mv 0–65535, temp_c −128–127, count, uptime_s}` any subset (1.8); `split.wifi` (≤ 32 B) / `.ble` (≤ 29 B); `interleave_ms` 100–10000 | **built, foxlib 1.4.0** |
| `checkpoint` | `enabled`; `stop_at` `YYYY-MM-DDTHH:MM:SS` or empty (1.10); `portal.{enabled, title ≤ 40 B, body ≤ 512 B plain text, code ≤ 16, ask_callsign, captive_dns, log}`; `ble.{enabled, service_uuid, code ≤ 16}` | **built, foxlib 1.7.0** |
| `sense` | `enabled`; `slot_ms` 200–5000 (BLE scan length); `tags.{enabled, match 1–16 B, log, rssi_min −100–0}`; `relay.{enabled, wait_for ≤ 32 B, then up \| down \| toggle}`; `honeypot.{enabled, log, probes, window_s 1–10}`; `crowd.{enabled, max 1–100, quiet_s 10–3600, rssi_min −100–0}` | **built, foxlib 1.10.0** |
| `stealth` | `enabled`; `rotate_mac` false \| per-cycle \| per-boot; `rotate_name` bool; `duty_jitter_s` 0–300; `start.after_s` 0–86400 / `start.at` `YYYY-MM-DDTHH:MM:SS[zone]`; `decoys` (≤ 4 × 1–32 B); `ble_only` bool; `variable_power` null \| `{min_dbm, max_dbm, per wake \| slot, slot_s 2–600}`; `modes` `[]` \| 2–3 distinct kinds; `modes_random` bool; `shell_game` null \| `{identities: 2–8 × {name, mac}, period_s 60–86400, index}` | **built, foxlib 1.5.0; `variable_power` 1.8.0; `modes`, `shell_game` 1.9.0** |

**`payload` (built):** `rotate` makes `names[cycle % n]` the SSID / BLE name
of each cycle (the fox logs `payload: name this cycle …`); `morse-name`
puts the Morse of `morse_of` on the air (`.-- .---- .- -... -.-.`, words
joined by ` / `, cut to 32 bytes at a space); `static` is the configured
name or callsign. `id.use_callsign_as_name` still wins when set. On a BLE
fox, `code` replaces the iBeacon major/minor when either is non-zero, and
the advertisement rotates through its frames every `interleave_ms`:
iBeacon → Eddystone-URL (frame type 0x10; the URL in the compact encoding,
up to 17 bytes after the scheme — a longer one is logged and not sent) →
Eddystone-TLM (0x20: battery mV or 0, temperature *not supported*, frame
count, uptime in 0.1 s). `split` runs the fox's other radio alongside with
the other half as its name (Wi-Fi template → a BLE advertiser; BLE
template → an open AP), on boards with both radios; the simulator and a
scanner app both see the two halves. The `puzzle-beacon` template ships
with the section on.

**`stealth` (built):** `rotate_mac` gives the radio a new locally
administered address every cycle (`per-cycle`, logged as `stealth: mac this
cycle …`) or once per power-up (`per-boot`); `rotate_name` draws the
cycle's name at random from the payload list instead of in turn;
`duty_jitter_s` moves each wake and sleep by up to ±N s (logged per
cycle); `start.after_s` keeps the fox silent for N s after power-on and
`start.at` until a wall-clock time read against the board clock (the zone
in the string is ignored — the clock's zone is the page's; with the clock
unset the fox logs it and starts at once; across deep sleep the fox
remembers it has started via `alarm.sleep_memory`); while waiting the LED
gives a short blink every 3 s. `decoys` makes a Wi-Fi access point walk
through its name and the decoy SSIDs, 3 s each, so a phone's list shows
several. `ble_only` turns the Wi-Fi radio off at boot and drops a split
clue's Wi-Fi half. Random choices are seeded from the chip id and the
cycle, so a fleet does not move in lockstep.

**`checkpoint` (built):** `portal` turns a `wifi-ap` fox into a web server
on port 80 while its radio is up: one page (`title`, `body` as plain-text
paragraphs, `code` set large, and when `ask_callsign` a one-field form that
POSTs to `/find`), served to every GET whatever the path — which is what
makes a phone's captive-portal check (`hotspot-detect.html`,
`generate_204`) open the sign-in sheet. `captive_dns` adds a UDP responder
on port 53 that answers every A query with the fox's address
(192.168.4.1), so the sheet appears without anyone typing an address; off,
hunters open `http://192.168.4.1/`. With `log`, each callsign handed in
(letters, digits, `/` and `-`, upper-cased, ≤ 16) is appended to
`finds.csv` on the fox as `fox_uid,template,cycle,ms_since_boot,
callsign,via` (`via` is `portal` or `ble`; no address of the phone — a
hunter's device is not the fox's to record, foxlib 1.11), up to 200 lines; a filesystem the host
holds is reported once and the finds kept in RAM. The runner ticks the
server every 50 ms while the radio is up (the LED is then steadily on
instead of blinking). `ble` adds a connectable service to the fox's BLE
advertisement — on a BLE fox the beacon itself, on a Wi-Fi fox a second
BLE radio beside the access point — with a read-only characteristic
`<service_uuid with its last byte C1>` carrying `code` and a write
characteristic `…C2` for a callsign (logged as client `ble`); the scan
response then carries the 128-bit service UUID and the name cut to 11
bytes. `checkpoint.portal` with `schedule.sleep: deep` is refused by both
the page and the firmware (`schedule.sleep` → `off`): deep sleep would
drop a hunter mid-page. The `checkpoint` template ships with the portal on.
The Bench tab's **Collect finds** reads `finds.csv` into the fleet log, one
`find` row per callsign.

**What varies per wake (foxlib 1.8, `netvary.py`):** `net.channels`,
`net.probe_ssids` and `stealth.variable_power` are drawn from the chip uid
and the cycle (the stealth RNG), so the simulator is deterministic and a
fleet does not move in lockstep; each draw is one log line (`channel this
cycle 6`, `probing for X`, `tx power this cycle 8 dBm`, `tx power now 11
dBm` for a slot re-draw). `variable_power` picks from the kind's power
steps between `min_dbm` and `max_dbm` (Wi-Fi steps for `wifi-ap` /
`wifi-probe`, BLE steps for `ble`; both must be steps of that kind and
`min < max`); `per: slot` re-draws every `slot_s` while the radio is up —
Wi-Fi changes power live, BLE restarts advertising. `eddystone.tlm_data`
replaces any of the four measured TLM fields with a fixed number, so the
telemetry a beacon scanner shows carries a clue.

**Mode rotation and the shell game (foxlib 1.9, phase H):** `stealth.modes`
lists the radio kinds the fox is, one per wake in turn (`modes_random`:
drawn) — `netmodes.py` builds one radio per kind at setup from the fox's
own `net` section (same name on the air, same MAC and power; the rest from
sensible defaults: an iBeacon UUID for the BLE twin of an access point,
channel 6 for the AP twin of a beacon) and swaps `fox.radio` before every
wake, first in the hook order so the other features see the cycle's kind;
a kind the hardware refuses is dropped with a log line, and fewer than two
working kinds means no rotation. The sign-in page is served on access-point
wakes only. `stealth.shell_game` is a fleet-wide list of identities
`{name, mac}` and a period: the fox in seat `index` shows identity
`(index + clock // period_s) % n`, so with as many identities as seats no
two foxes show the same name at once and every fox wears every name in
turn. It follows the board clock (`clock_seconds`, a zone-less sum of the
RTC's components since 2000-01-01; the page computes the same from local
time); with the clock unset the fox keeps its seat's identity and says so
once. The shell game sets both the name and the MAC, so MAC rotation, name
rotation and payload names are errors beside it. The Fleet tab's **Shell
game** card writes the same list to several saved profiles with their
seats and shows the rotation table.

**`sense` (built, foxlib 1.10, `netsense.py`):** everything is heard
*before* a wake, with the radio not yet up. One BLE scan of `slot_ms`
serves `tags` (every advertiser whose name starts with `match` and is at
least `rssi_min` strong: a console line and, with `log`, a `near.csv`
row kind=`tag`) and `crowd` (distinct advertisers above `rssi_min`; more
than `max` and the fox stays silent for `quiet_s`, LED `armed`). `relay`
is a Wi-Fi scan for `wait_for`: `up` keeps the fox silent until the
other fox has been heard once, then on for good; `down` silences any wake
in which it is heard; `toggle` flips the fox on/off each time the other
fox comes back after a wake without it. `honeypot` logs, while an access
point is up, every station that joins (`wifi.radio.stations_ap`, kind
`join`) and, with `probes` and a CircuitPython build that has
`wifi.Monitor`, listens `window_s` before each wake on the AP's channel
for probe requests naming any of this fox's names (SSID, payload names,
decoys, probe list, shell-game identities: kind `probe`; other probe
requests are counted in one line). A build without `wifi.Monitor` says so
once and logs joins only. A silent wake is logged `silent this wake
(<reason>)` and the other features' after-wake steps still run.
`near.csv` columns: `fox_uid, template, cycle, ms_since_boot, kind, rssi,
name`, up to 500 lines; the Bench tab's **Who is near** reads it (shown
and downloadable, not merged into the fleet log). No addresses (foxlib
1.11): the devices a fox hears in a park are not its to record. An address
is used in RAM only, to write a tag or prober at most once per five minutes
and to count joins within a wake; `name` is always one of ours (the tag
name the organisers gave out, the SSID a station probed for — only our
own are logged — or the fox's).

**Done for the day (`checkpoint.stop_at`, foxlib 1.10):** once the board
clock reaches `stop_at`, the fox takes its radio down, says `done: <reason>; off the air until power-cycled`,
and blinks the LED `done` pattern (long and slow) until power-cycled.
`stop_at` without the board clock set is an error on the page; on the
fox it is said once and ignored. (`stop_after_finds`, a count of callsigns
handed in, left in 1.11: one phone reloading the thank-you page could end
a checkpoint's day, and a count of devices is not something a fox should
keep. A fox.json carrying the key gets `checkpoint.stop_after_finds ->
default (unknown)` in the banner and runs.)

Cross-section rules the validator applies: `payload.kind: rotate` with no
names falls back to `static`; `checkpoint.portal` and `sense.honeypot` /
`relay` need a Wi-Fi radio, `stealth.ble_only` and `sense.tags` / `crowd`
a BLE radio; `sense.relay` needs `wait_for`; `stealth.modes` only kinds
the hardware has; a portal with deep sleep turns deep sleep off. The page
adds what only it can know: a start time, a stop time or the shell game
with the board clock unset; a split clue on a one-radio board; BLE frames
on a Wi-Fi template; the shell game beside MAC or name rotation; a relay
on a BLE-only fox (the relay's Wi-Fi scan would turn the Wi-Fi radio back
on); unresolved `{{to.*}}` placeholders.

The banner's `clock=` is the board's RTC (`unset` until the page sets it
at deploy — the Deploy tab's *Set the board clock*, from the browser or a
fixed time given to every fox of a fleet).

`wifi-probe` is a station that keeps trying to join `net.ssid` with a
password that cannot be right: the probe requests carry the SSID and the
spoofed MAC, which is what a hunter's sniffer sees, and the fox never
joins anything. One attempt is about two seconds of probe requests; the
fox makes one after another for the whole wake (foxlib 1.10.3; before, one
per wake). The bench's **Radio up** is `key_for(seconds)` (radio up
for N s); **Scan** is `rssi()`, the strongest neighbours this radio can see
— a liveness check, not a receiver's RSSI.

## Boot banner

One line, space-separated `key=value`, printed after setup and before the
first cycle. The page parses it after every reboot.

```
FOX template=<id>/<ver> foxlib=<ver> board=<board_id> uid=<hex> cfg=<status> radio=<status> id=<set|unset> freq=<mhz>[,<mhz>…]
```

`cfg`: `ok` · `partial(<dotted.keys>)` · `default(missing|parse|schema|template|board)` · `fatal(<key>)`.
`radio`: `ok` · `err(<reply>)` · `noreply`.

A network fox (`net` contract) prints the same keys with `freq=none`, then
its own: `net=<kind> name=<name> mac=<XX:…>` — `name` is quoted when it has
spaces — then `features=<sections>` when any contest section is on, and
`clock=<ISO time | unset>`, and `mem=<bytes>` (foxlib 1.10.11), the heap
left after init — under about 20 kB a feature switched on later, or a
longer payload, is the next `MemoryError`. Its `id=` has three values: `set`, `none` (the
placeholder, not on the air — allowed), `unset` (the placeholder would be
the name on the air). `radio`: `ok` · `ok(hidden_unsupported)` · `nowifi` · `noble` ·
`wifi(<Error>)` · `ble(<Error>)`. After `woke from deep sleep` the cycle
count has restarted.

```
FOX template=wifi-beacon/1.0.0 foxlib=1.1.0 board=seeed_xiao_esp32c3 uid=… cfg=ok radio=ok id=set freq=none net=wifi-ap name="W1ABC FOX" mac=F2:B0:00:00:00:01
```

## Migrations

`schema` increments only for breaking changes. The page carries forward
migrations in `js/model/schema.js`; the firmware never migrates, it only
refuses a schema newer than it knows.
