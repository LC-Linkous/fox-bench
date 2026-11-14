# Network-fox payloads for a contest — build plan

Status: approved 2026-11-14. **Phase A built** (page 0.10.0, foxlib 1.3.0): the four
sections validate on both sides, the Payload tab has the cards, the Deploy
tab sets the clock, templates can declare `needs`, the simulator has the
hooks and an `rtc` mock. Phases B–E next, in that order.
Scope: the `net`-contract foxes (`wifi-beacon`, `wifi-probe`, `ble-beacon`
on the chip targets). The FM foxes are untouched.

What was chosen from the brainstorm, and what was shelved:

| area | decision |
|---|---|
| 1. text and puzzle payloads | **build**: rotating names, codes in the beacon, Eddystone, split clues |
| 2. time-domain "tunes" (power / channel painting, keyed BLE Morse) | **shelved** for this fox: a contest venue may not support 2.4 GHz well enough for RSSI-shape games; the contract leaves room (`payload.kind` is open) |
| 3. the fox as a server (open AP + captive portal, BLE connectable service) | **build** |
| 4. the fox that listens (hunter-tag proximity, relay/chain, probe counting) | **build**, all three |
| 5. difficulty knobs (rotation, random duty, scheduled start, BLE-only, decoys) | **build** |

One constraint from the contest side (the foxdash scoring system,
`fox hunt` project): a static code served by a fox is **not proof of
presence** — foxdash uses rolling-counter NFC tags for finds and rejects
static URLs. So nothing here is the find mechanism. The portal and the BLE
service are *puzzle delivery* and a *checkpoint log*; a rolling code that
foxdash could verify is a later bridge (Phase F), not a dependency.

## 0. Shape of the change

The `net` contract (CONFIG.md) grows four optional sections. Each is
absent by default, so every existing template and defaults file stays
valid, and a fox with none of them behaves exactly as today.

```
payload    what the fox says            (1)   names, codes, Eddystone frames, split clues
checkpoint what the fox serves          (3)   captive portal page + find log; BLE service
sense      what the fox listens for     (4)   hunter tags, another fox, probe requests
stealth    how hard it is to find       (5)   rotation, random duty, scheduled start, decoys
```

Firmware: `netcfg.py` validates them (JS twin `netschema.js`, parity
corpus), `netfox.py` runs them per cycle, new modules `netpayload.py`,
`netserve.py`, `netsense.py`. Page: the **Payload** tab comes back for net
foxes (today hidden) with the four cards; the Bench tab gains "Collect
finds" and "Who is near". Simulator: mocks for `socketpool`, `wifi.Monitor`,
BLE scanning; scenarios per feature. Each phase ends green on the full
local sequence and on one real board before the next starts.

Templates: rather than one template per feature, the three existing
templates gain the sections, and two new templates package the contest
combinations: **`checkpoint`** (open AP + portal + find log) and
**`puzzle-beacon`** (BLE: iBeacon code + Eddystone-URL + name rotation).
Templates stay small `code.py` files that choose from foxlib.

## Phase A — contract, page scaffolding, simulator hooks

Goal: the four sections exist end to end with nothing behind them yet, so
every later phase is "fill in one card and one module".

- `netcfg.py` / `netschema.js`: the four sections, each `enabled: false`
  by default; keys below. Parity corpus +12 cases.
- Page: Payload tab visible for net foxes; four cards, each collapsed with
  an enable checkbox; `checks()` for the obvious conflicts (portal needs
  `wifi-ap`; sense needs the radio awake; deep sleep + portal is an error).
- `netfox.cycles()` grows hooks: `before_up`, `while_up(tick)`, `after_down`;
  the features register into them. The duty cycle stays the spine.
- Simulator: `rec.net` events for every new action; mocks for
  `socketpool`/`wifi.Monitor`/`_bleio` scanning return scripted data from
  the scenario (`scenario.world`: nearby tags, probes, a sibling fox).
- Docs: CONFIG.md sections; DESIGN §5 note.

Decision needed: whether the Payload tab for net foxes should also show
the FM-style *playlist* preview area (no) — it shows the four cards only.

## Phase B — text and puzzle payloads (`payload`)

```
payload:
  kind:        "static" | "rotate" | "morse-name"
  names:       ["WORD1", "WORD2", ...]      rotate: one per cycle (SSID or BLE name), ≤ 32 B each
  morse_of:    "KY4ZR"                       morse-name: the name on the air is the Morse string ("-.- -.-- ....")
  code:        { "major": 1234, "minor": 5678 }        BLE: iBeacon fields as a checkpoint / grid code
  eddystone:   { "url": "https://…", "tlm": true }     BLE: Eddystone-URL frame (phone offers to open it),
                                                       Eddystone-TLM (battery mV, temperature, uptime, adv count)
  split:       { "wifi": "half one", "ble": "half two" }   a clue that needs both radios (C3/C6/C5/S3 only)
```

- Wi-Fi: the SSID per cycle comes from `names[cycle % n]` (rotate) or the
  Morse string; a 32-byte cap is enforced on every entry at validation.
- BLE: frame builder in `netradio.BleBeacon` grows Eddystone-URL (the
  compact URL encoding, 17 B max after the scheme byte) and Eddystone-TLM
  (unencrypted, version 0); a fox can interleave iBeacon / URL / TLM frames
  (one per advertising interval slot) — `interleave_ms`.
- `split`: the fox runs **both** radios in one wake window (AP + BLE
  advertising together is fine on the ESP32 family; test RAM on the C3).
- Page: Payload card with the kind selector, the names list editor (one
  per line, byte counter per line), code fields, Eddystone fields, a
  preview of "what the phone shows this cycle".
- Sim: scenarios for rotation order, byte caps, Eddystone frame bytes
  (golden), split both-radios-up.
- Bench: phone Wi-Fi list shows the rotation; nRF Connect decodes the
  URL / TLM; iBeacon major/minor as set.

## Phase C — difficulty knobs (`stealth`)

```
stealth:
  rotate_mac:    false | "per-cycle" | "per-boot"       new locally-administered MAC each cycle / each boot
  rotate_name:   false | true                            draw the name from payload.names at random, not in order
  duty_jitter_s: 0                                       wake/sleep lengthened or shortened by ±N s at random
  start:         { "after_s": 0 } | { "at": "2026-08-08T09:00:00-04:00" }   silent until then
  decoys:        []                                      Wi-Fi: extra SSIDs the AP cycles through quickly (one AP at
                                                         a time in CircuitPython: 2–3 s each) so the list shows several
  ble_only:      false                                   Wi-Fi radio never enabled (a C3/C6 as a pure BLE fox)
```

- `start.at` needs a clock: the page sets the board's RTC from the browser
  at deploy (`rtc.RTC().datetime`, already available over the REPL); the
  banner prints the fox's idea of "now" so drift is visible; deep sleep
  keeps the RTC on the ESP32 family. `after_s` needs nothing.
- Random choices seed from `microcontroller.cpu.uid` + cycle so the sim is
  deterministic and a fleet does not move in lockstep.
- Page: Stealth card; `checks()`: decoys + hidden is pointless (hidden is
  unsupported anyway), `start.at` in the past is a warning, `start.at`
  without the RTC set at deploy is an error.
- Sim: MAC changes per cycle recorded; start gate; decoy cadence.

## Phase D — the fox as a server (`checkpoint`)

```
checkpoint:
  portal:  { "enabled": true, "title": "Fox 3", "body_md": "…", "code": "4471",
             "ask_callsign": true, "captive_dns": true, "log": true }
  ble:     { "enabled": true, "service_uuid": "…", "code": "4471" }
```

- **Portal**: `adafruit_httpserver` vendored under `firmware/foxlib/vendor/`
  (MIT; licence file alongside, noted in README/DESIGN). One page: title,
  body (a safe Markdown subset rendered on the fox — headings, paragraphs,
  bold, links — or plain text), the code, an optional callsign form.
  **Captive DNS**: a ~40-line UDP responder answering every A query with the
  fox's IP, so the phone pops its "sign in to network" sheet — that is the
  whole UX, no app, no typing an address. Tested per phone OS on the bench;
  `captive_dns: false` falls back to "open http://192.168.4.1".
- **Find log**: `finds.csv` on CIRCUITPY, one line per callsign submission
  (`ms_since_boot, cycle, callsign, client_mac`), append-only, capped at
  N lines. The page's Bench tab gains **Collect finds** (reads it over the
  REPL, merges into the fleet log with the fox's uid, offers a CSV). This
  is the "who found it and when" list a contest desk can use by hand; it
  is **not** a scored find (see the foxdash note above).
- **BLE service**: a connectable advertisement alongside the beacon
  (`_bleio.Service` + a read-only `Characteristic` carrying the code; a
  write characteristic for the callsign when `log` is on). Raw `_bleio`,
  no `adafruit_ble` dependency.
- Scheduling: a portal fox keeps the radio up for the whole wake window
  (the duty cycle still applies); `schedule.sleep = deep` with a portal is
  refused (the phone would lose the page mid-sheet).
- RAM: the C3 is the tight one; Phase D is tested on the C3 first and, if
  it does not fit, the portal is marked `radios: ["wifi24"]` + a
  `min_ram` note so the page offers it on S3/C6/C5 only.
- Sim: `socketpool` mock with a scripted client that GETs the page and
  POSTs a callsign; DNS mock; `finds.csv` content checked.

## Phase E — the fox that listens (`sense`)

```
sense:
  tags:    { "enabled": true, "match": "HUNT-", "log": true, "rssi_min": -80 }
           BLE scan between advertising bursts; every advertiser whose name starts with `match` (or whose
           address is in `allow`) is logged with RSSI and time → `near.csv`; the page's "Who is near" reads it
  relay:   { "enabled": true, "wait_for": "FOXBENCH Fox 2", "then": "up" | "down" | "rotate" }
           Wi-Fi scan each cycle; the fox stays silent until it hears the named SSID (chain hunts), or goes
           quiet when it does (hot/cold inverted)
  probes:  { "enabled": true, "channel": 6, "window_s": 2 }
           wifi.Monitor for a short window each cycle; counts probe requests (distinct senders) as a crude
           "hunters nearby" meter → banner line `near=<n>` and the LED pattern changes
```

- Hunter tags: what hunters carry is a decision (below). The fox side is
  the same whatever it is: a BLE advertiser with a known name prefix.
- `probes` uses the same parser as `tools/sniffer` (already in the repo,
  `firmware/sim/test_sniffer_parse.py`); monitor mode availability per
  chip is verified on the bench (the runbook already notes builds without
  `wifi.Monitor`).
- Scheduling: scanning and advertising/AP alternate inside the wake
  window (`sense.slot_ms`); the simulator proves the fox is still on the
  air the required fraction of the time.
- Page: Sense card; Bench "Who is near" (reads `near.csv`); the relay
  SSID can be picked from the fleet's other net foxes.
- Sim: `scenario.world.tags` / `.ssids` / `.probes` drive the mocks.

## Phase F — bench, docs, bridge

- `docs/network-fox-bench.md` gains a section per feature; hardware-log
  rows per board per feature; the templates' `boards_tested`.
- `tools/hw_smoke.py`: `--payload`, `--checkpoint` flags that exercise the
  portal with a Python client over the fox's AP (the laptop joins the AP),
  and the find log read-back.
- **foxdash bridge (optional)**: the portal/BLE code becomes a rolling
  code `HMAC(key, uid, counter)` shown with its counter, which foxdash's
  verifier could accept like an SDM tag read. Only if the contest wants
  foxes without NFC tags; otherwise the NFC tag on the fox stays the find
  and the fox's radio is the puzzle.

## Order and size

| phase | new code (est.) | hardware gate |
|---|---|---|
| A contract + scaffolding | firmware 150 · page 250 · sim 150 · tests | none (sim + demo) |
| B payloads | firmware 200 · page 200 · sim 100 | C3 + phone (Wi-Fi list, nRF Connect) |
| C stealth | firmware 120 · page 120 · sim 80 | C3 + phone; RTC check across deep sleep |
| D checkpoint | firmware 350 + vendored lib · page 200 · sim 200 | C3 then S3 (RAM); iPhone and Android captive sheets |
| E sense | firmware 250 · page 150 · sim 150 | two boards + a tag; a chip with `wifi.Monitor` |
| F bench + bridge | docs, tools | all boards |

B before C before D before E: each reuses the previous phase's plumbing
(B's frame builder → D's BLE service; C's RTC → E's timestamps). One patch
per phase, page minor version per phase (0.10 → 0.14), foxlib 1.3 → 1.7.

## Decisions needed before Phase A

1. **Hunter tag** (Phase E): a cheap BLE tag per team with a name set to
   `HUNT-<team>`, or the hunters' phones running an advertiser app
   (Android: nRF Connect can advertise a custom name; iOS cannot set the
   name freely). My recommendation: tags per team, handed out at
   registration — deterministic and OS-independent.
2. **Portal content**: plain text + the code, or the Markdown subset?
   Plain text is fifty lines less firmware and enough for "you found fox
   3, your code is 4471, next clue: …". Recommend plain text first.
3. **Vendoring `adafruit_httpserver`** (MIT) into `firmware/foxlib/vendor/`
   vs writing a 120-line HTTP responder of our own. The library is ~60 KB
   of Python on a C3 — real RAM. Recommend our own minimal responder (GET
   one page, POST one form), no dependency.
4. **Clock for `start.at`**: set the board RTC from the browser at deploy
   (simple, drifts minutes per day, fine for a one-day hunt) — yes/no.
5. **Find log hand-off**: CSV read back by the page into the fleet log,
   nothing networked — yes/no. (The rolling-code bridge is the networked
   alternative, Phase F, optional.)
6. **Template packaging**: the two new templates (`checkpoint`,
   `puzzle-beacon`) plus sections on the existing three — or sections only
   and no new templates. Recommend the two templates: they are what a
   contest organiser picks from the dropdown.
