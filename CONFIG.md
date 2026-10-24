# fox.json — configuration contract

`fox.json` lives at the board root. The page writes it in full; the
firmware (`foxlib/cfg.py`) merges it over the template's
`defaults/<board_id>.json`, validates every field, and reports the result
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
| `board` | string | CircuitPython `board.board_id`. Mismatch with the running board → `cfg=default(board)`: pins from another board are never applied. |
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
"limits": { "max_keydown_s": null }
```

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
"fleet": { "profile": "Fox 3 — 146.565", "number": 3, "event": "", "notes": "" }
```

Bookkeeping for the page. The firmware ignores this block entirely
(it is merged over the defaults' `fleet` block so no key is lost).

## The `compiled` family (RFHS kitsune foxes)

Foxes whose configuration is compiled into their firmware keep the
`fox.json` shape for the page's sake — profiles, the fleet log and the
validator are shared — but their sections are their own; `pins`, `radio`,
`plan`, `id`, `payload`, `battery` and `limits` do not appear. Today the
page turns this document into a kitsune conference header block
(`docs/kitsune-integration-plan.md`); later the same document is what a
`foxcfg` partition would hold. Validated by `js/model/vendor/kitsune.js`.

| key | type | meaning |
|---|---|---|
| `challenge.name` | string | `RFHS_CHALLENGE_NAME`: the scoreboard name |
| `challenge.keyphrase` | string | what a hunter must say (`FOX_KEYWORDS` prints "Hunter should ask '…'") |
| `challenge.tier` | `easy` \| `medium` \| `hard` | a label; kitsune selects a block of values by tier at build time, the page writes one explicit block guarded by it |
| `wifi.ssid` | string ≤ 32 bytes | `FSSID` |
| `wifi.psk` | string, 8–63 or empty | `PSK` |
| `wifi.mac` | `XX:XX:XX:XX:XX:XX` | `MAC_ADDR`, spoofed; locally administered unicast (kitsune: first byte `F2`); the skeleton's `00:01:02:…` is refused |
| `wifi.band` | `2.4` \| `5` | AP only; 5 GHz needs the `wifi5` radio |
| `wifi.channel` | int | AP only; 0 = random at every wake; 2.4 GHz 1–11 (12–13 warn), 5 GHz one of 36 40 44 48 149 153 157 161 165 |
| `wifi.hidden` | bool | AP only, `SSID_HIDDEN` |
| `wifi.max_clients` | 1–4 | AP only |
| `wifi.tx_power_dbm` | one of 19.5 19 18.5 17 15 13 11 8.5 7 5 2 −1 | `TXPOWER` (`WIFI_POWER_…`) |
| `ble.device_name` | string ≤ 29 bytes | `DEVICE_NAME` |
| `ble.uuid` | 8-4-4-4-12 hex | `BEACON_UUID` |
| `ble.major`, `ble.minor` | 0–65535 | |
| `ble.signal_power_dbm` | −127–0 | `SIGNAL_POWER`, the calibration byte (−59 = `0xC5`) |
| `ble.mac` | 6 bytes | spoofed |
| `ble.adv_min`, `ble.adv_max` | 32–16384 | advertising interval in 0.625 ms units |
| `ble.tx_power_dbm` | one of −12 −9 −6 −3 0 3 6 9 | `ADV_TX_POWER` (`ESP_PWR_LVL_…`) |
| `bt.name` | string | Bluetooth Classic `NAME` |
| `bt.mac` | 6 bytes | spoofed |
| `zigbee.mac` | 8 bytes (EUI-64) | spoofed |
| `zigbee.channel` | 0 or 11–26 | 0 = random |
| `zigbee.tx_power_dbm` | −15–20 | ESP32-C5 range |
| `schedule.kind` | `duty` | the only kind: awake, then deep sleep |
| `schedule.wake_s` | 1–86400 | `TIME_TO_WAKE` (`ADVERTISING_DURATION` for the iBeacon) |
| `schedule.sleep_s` | 0–86400 | `TIME_TO_SLEEP` (`GPIO_DEEP_SLEEP_DURATION`); 0 = never sleeps |
| `led.enabled` | bool | informational today (kitsune has no switch for its LED) |

Templates: `wifi-ap` and `wifi-client` fill `wifi`, `ble-ibeacon` fills
`ble`, `bt-classic` fills `bt`, `zigbee-coordinator` fills `zigbee`; each
names the radio it needs (`radios` in `template.json`) and is offered only
on hardware that lists it (`hardware/<id>.json` `radios`).

## The `net` contract (network foxes on CircuitPython)

The `wifi-beacon`, `wifi-probe` and `ble-beacon` templates use the SoC's
own radio as the transmitter — no module, no `module`/`pins`/`radio`/`plan`/
`payload`/`battery`/`limits` sections. `template.json` says
`"contract": "net"`, and the document is validated by
`firmware/foxlib/netcfg.py` on the board and `js/model/netschema.js` in the
page (held equal by `firmware/sim/schema_parity.*`). Everything that does
not fit falls back to the defaults file, reported in the banner as
`cfg=partial(<keys>)`, like the FM contract. The runner is
`firmware/foxlib/netfox.py`; the radios are `firmware/foxlib/netradio.py`.

| key | type | meaning |
|---|---|---|
| `net.kind` | `wifi-ap` \| `wifi-probe` \| `ble` | fixed by the template |
| `net.ssid` | string, 1–32 bytes | `wifi-ap`, `wifi-probe`: the network name on the air (unless `id.use_callsign_as_name`) |
| `net.psk` | string, empty or 8–63 bytes | `wifi-ap`: empty = open network (the page says so), otherwise WPA2 |
| `net.channel` | int | `wifi-ap`: 1–13, or one of 36 40 44 48 149 153 157 161 165 when the hardware lists the `wifi5` radio |
| `net.hidden` | bool | `wifi-ap`: **CircuitPython cannot hide an AP** — accepted and reported, the SSID is broadcast; `radio=ok(hidden_unsupported)` and a `note:` line in the banner |
| `net.max_clients` | 1–8 | `wifi-ap` |
| `net.name` | string, 1–32 bytes | `ble`: the complete local name (in the scan response, cut to 29 bytes) |
| `net.uuid` | 8-4-4-4-12 hex | `ble`: iBeacon proximity UUID |
| `net.major`, `net.minor` | 0–65535 | `ble` |
| `net.signal_power_dbm` | −128–0 | `ble`: the iBeacon calibration byte (measured power at 1 m) |
| `net.adv_min`, `net.adv_max` | 20–10240 ms | `ble`: advertising interval; `adv_min ≤ adv_max` |
| `net.tx_power_dbm` | Wi-Fi: one of 2 5 7 8.5 11 13 15 17 18.5 19 19.5; BLE: one of −12 −9 −6 −3 0 3 6 9 | radio power |
| `net.mac` | `XX:XX:XX:XX:XX:XX` | the address the fox uses, locally administered unicast (the defaults use `F2:B0:00:00:00:xx`); the Radio tab's **Random** draws one. Not every CircuitPython port lets the BLE address be set — the beacon still runs on the chip's own |
| `id.callmessage` | string, 1–64 bytes | the operator's callsign (the usual gate: `N0CALL` is refused at deploy) |
| `id.use_callsign_as_name` | bool | the callsign is the SSID / BLE name on the air (a ham fox hunt); off, the configured `net.ssid`/`net.name` is (a contest) |
| `schedule.kind` | `duty` | the only kind |
| `schedule.wake_s` | 1–3600 | radio up for this long each cycle |
| `schedule.sleep_s` | 0–86400 | then off for this long; 0 = always on |
| `schedule.sleep` | `off` \| `deep` | how the off time is spent: radio off with USB alive (the page keeps its connection), or **deep sleep** (`alarm`): the board reboots at the end, the USB port disappears meanwhile, the cycle count restarts at 0 |
| `led.enabled` | bool | status LED: 900/100 ms blink while the radio is up, a double flash every 2 s when unconfigured |
| `fleet.*` | | as the FM contract |

`wifi-probe` is a station that keeps trying to join `net.ssid` with a
password that cannot be right: the probe requests carry the SSID and the
spoofed MAC, which is what a hunter's sniffer sees, and the fox never
joins anything. The bench's **Radio up** is `key_for(seconds)` (radio up
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
spaces. `radio`: `ok` · `ok(hidden_unsupported)` · `nowifi` · `noble` ·
`wifi(<Error>)` · `ble(<Error>)`. After `woke from deep sleep` the cycle
count has restarted.

```
FOX template=wifi-beacon/1.0.0 foxlib=1.1.0 board=seeed_xiao_esp32c3 uid=… cfg=ok radio=ok id=set freq=none net=wifi-ap name="KY4ZR FOX" mac=F2:B0:00:00:00:01
```

## Migrations

`schema` increments only for breaking changes. The page carries forward
migrations in `js/model/schema.js`; the firmware never migrates, it only
refuses a schema newer than it knows.
