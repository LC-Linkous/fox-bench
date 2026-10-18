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

## `plan`

```json
"plan": { "frequencies_mhz": [146.565], "announce_qsy": false }
```

| key | type | notes |
|---|---|---|
| `frequencies_mhz` | [float, …] | at least one. One entry = fixed frequency. More = rotate after each transmission. Entries outside `radio.ranges_mhz` are dropped with a banner note; if none survive, `cfg=fatal(plan)` and the fox stays silent. |
| `announce_qsy` | bool | with more than one frequency, send `QSY <next>` in Morse before moving. |

The page additionally checks each entry against the selected region's
band plan (`bands.json`) and shows which test a rejected frequency
failed. The firmware checks only the module range.

## `id`

```json
"id": { "callmessage": "N0CALL DECOY DECOY N0CALL", "placeholder": "N0CALL",
        "wpm": 12, "tone_hz": 800, "telemetry": ["batt"],
        "tx_without_callsign": false }
```

| key | type | range | notes |
|---|---|---|---|
| `callmessage` | string | 1–64 chars | sent in Morse each transmission. Characters outside the Morse table are skipped. |
| `placeholder` | string | | sentinel. If it appears in `callmessage`, the callsign is unset. Do not personalise. |
| `wpm` | int | 5–40 | PARIS timing |
| `tone_hz` | int | 300–3000 | |
| `telemetry` | [string] | subset of `["batt"]` | appended to the ID, e.g. `BAT 3V7`. Ignored when `pins.batt_sense` is `null`. |
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

`null` = no limit, and no template sets one. When a number (1–7200) is
set in the UI, the firmware unkeys when a single transmission reaches it,
logs `keydown-limit`, and shows that LED pattern once. The page displays
computed airtime per transmission next to this field.

## `fleet`

```json
"fleet": { "profile": "Fox 3 — 146.565", "number": 3, "event": "", "notes": "" }
```

Bookkeeping for the page. The firmware ignores this block entirely
(it is merged over the defaults' `fleet` block so no key is lost).

## Boot banner

One line, space-separated `key=value`, printed after setup and before the
first cycle. The page parses it after every reboot.

```
FOX template=<id>/<ver> foxlib=<ver> board=<board_id> uid=<hex> cfg=<status> radio=<status> id=<set|unset> freq=<mhz>[,<mhz>…]
```

`cfg`: `ok` · `partial(<dotted.keys>)` · `default(missing|parse|schema|template|board)` · `fatal(<key>)`.
`radio`: `ok` · `err(<reply>)` · `noreply`.

## Migrations

`schema` increments only for breaking changes. The page carries forward
migrations in `js/model/schema.js`; the firmware never migrates, it only
refuses a schema newer than it knows.
