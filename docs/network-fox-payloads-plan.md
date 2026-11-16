# Network-fox payloads for a contest — build plan

Status: approved 2026-11-14. **Phase A built** (page 0.10.0, foxlib 1.3.0): the four
sections validate on both sides, the Payload tab has the cards, the Deploy
tab sets the clock, templates can declare `needs`, the simulator has the
hooks and an `rtc` mock. **Phase B built** (page 0.11.0, foxlib 1.4.0):
`netpayload.py`, the `puzzle-beacon` template, the card's on-the-air
preview; bench steps 12–14 in `network-fox-bench.md`. **Phase C built**
(page 0.12.0, foxlib 1.5.0): `netstealth.py`; bench steps 15–19. **Phase D
built** (page 0.14.0, foxlib 1.7.0) — see "Status 2026-11-16" below for D
and the second round of features (phases G, H, E′, J).
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
`netcheckpoint.py`, `netsense.py`. Page: the **Payload** tab comes back for net
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
  portal:  { "enabled": true, "title": "Fox 3", "body": "…", "code": "4471",
             "ask_callsign": true, "captive_dns": true, "log": true }
  ble:     { "enabled": true, "service_uuid": "…", "code": "4471" }
```

- **Portal**: our own minimal responder (decision 3): one page — title,
  plain-text body, the code, an optional callsign form — served to every
  GET. **Captive DNS**: a ~40-line UDP responder answering every A query
  with the fox's IP, so the phone pops its "sign in to network" sheet —
  that is the whole UX, no app, no typing an address. Tested per phone OS
  on the bench; `captive_dns: false` falls back to "open http://192.168.4.1".
- **Find log**: `finds.csv` on CIRCUITPY, one line per callsign submission
  (`fox_uid, template, cycle, ms_since_boot, callsign, client_mac`),
  append-only, capped at 200 lines. The page's Bench tab gains **Collect
  finds** (reads it over the REPL, merges into the fleet log with the fox's
  uid, offers a CSV). This is the "who found it and when" list a contest
  desk can use by hand; it is **not** a scored find (see the foxdash note
  above).
- **BLE service**: a connectable advertisement alongside the beacon
  (`_bleio.Service` + a read-only `Characteristic` carrying the code; a
  write characteristic for the callsign when `log` is on). Raw `_bleio`,
  no `adafruit_ble` dependency.
- Scheduling: a portal fox keeps the radio up for the whole wake window
  (the duty cycle still applies); `schedule.sleep = deep` with a portal is
  refused by page and firmware (the phone would lose the page mid-sheet).
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
           (superseded by honeypot / crowd in Phase E′ below)
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

- The bench runbook gains a section per feature; hardware-log
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
| D checkpoint | firmware 350 · page 200 · sim 200 | C3 then S3 (RAM); iPhone and Android captive sheets |
| E sense | firmware 250 · page 150 · sim 150 | two boards + a tag; a chip with `wifi.Monitor` |
| F bench + bridge | docs, tools | all boards |

B before C before D before E: each reuses the previous phase's plumbing
(B's frame builder → D's BLE service; C's RTC → E's timestamps). One patch
per phase, page minor version per phase (0.10 → 0.14), foxlib 1.3 → 1.7.

## Decisions (2026-11-14)

1. **Hunter tag** (Phase E): a cheap **BLE tag per team**, name `HUNT-<team>`,
   handed out at registration. The firmware ships in every build; the
   template says what must be provided — `template.json` gets a `needs`
   list, shown under the description on the Behavior tab, above the Deploy
   button, and again on the Sense card when `tags` is on. Nothing about
   phone apps anywhere.
2. **Portal content**: plain text + the code first (`portal.body`, ≤ 512
   bytes); Markdown later if wanted.
3. **No vendored HTTP library**: our own minimal responder (GET one page,
   POST one form, the captive DNS answer) — smaller on the C3, no
   dependency.
4. **Clock**: a "Set the board clock" checkbox on the Deploy tab with two
   sources, *browser time now* or *a fixed time* (date-time field),
   remembered in the browser so a whole fleet can be given one identical
   time (built in phase A). `stealth.start.at` with the clock not set is a
   blocking error.
5. **Find log hand-off**: `finds.csv` on every fox, one format across all
   templates (`fox_uid, template, cycle, ms_since_boot, callsign,
   client_mac`); *Collect finds* on any fox merges into the one fleet log,
   so a mixed fleet reads as one list. `near.csv` (Phase E) uses the same
   columns plus `kind`.
6. **Templates**: two new ones, `checkpoint` and `puzzle-beacon`
   (`puzzle-beacon` shipped in phase B), in the Behavior tab's dropdown
   next to the three beacons on the chip targets (nowhere else); optgroups
   if the list grows past five.

## Status 2026-11-16

**Phase D built** (page 0.14.0, foxlib 1.7.0; patch 0123): `netcheckpoint.py`
(portal, captive DNS, `finds.csv`, BLE service), the `checkpoint` template,
*Collect finds*; runbook steps 20–26. Page 0.14.1 added `fleet.owner`
(the Operator field) and the *Write safemode.py* switch. Phase E waits on
the per-chip `wifi.Monitor` check. The hardware gates for 1.6 (watchdog,
safe mode) and D (captive sheet on iPhone/Android, C3 RAM) are open.

## Second round (decided 2026-11-16) — more options than a compiled-in fox

Why: kitsune is an established, compiled-per-fox firmware whose operators
keep their answers offline. The way to have *more* options than that is not
one more fox type but behaviour that is **drawn at deploy and changes over
the day**, so nothing about fox 3 follows from fox 2 and a watcher cannot
enumerate what we might be doing. Chosen from the brainstorm:

| area | decision |
|---|---|
| channel per wake, fixed list or any | **build** |
| event sheet (assignment summary, exportable) | **build** |
| mode rotation (AP / probe / BLE across wakes) | **build** |
| variable power (tx power drawn per wake or per slot) | **build** |
| shell game (foxes trade identities on a schedule) | **build** |
| probe-client SSID lists | **build** |
| data in Eddystone-TLM | **build** |
| honeypot log, crowd control, stop after N finds | **build** (sense / checkpoint) |
| Net → FM handoff | **build** (page-level, with the sheet) |
| personas by time of day, identity pools + shuffle | **shelved**: too much to keep track of at an event |
| rotating / first-N codes, riddle tree, PSK chaining, hot/cold, gating | **not now** (rotating code stays the Phase F bridge) |

Hunter verification (keyphrase, keyword sheets) is a game/venue matter and
is not part of the firmware or the page.

### Phase G — channels, probe lists, power variation, TLM data, the sheet

Small contract additions, one patch.

```
net:
  channel:      6                      as today (fixed)
  channels:     [] | [1, 6, 11] | "any"   wifi-ap: one drawn per wake from the list ("any" = every channel the
                                        board's region allows, from the catalog); [] = channel as fixed
  probe_ssids:  []                     wifi-probe: several networks sought in turn (one per wake, or within the wake
                                        every probe_ssid_s seconds); [] = net.ssid only
  probe_ssid_s: 0                      0 = one per wake
stealth:
  variable_power: { "min_dbm": 2, "max_dbm": 13, "per": "wake" | "slot", "slot_s": 10 }
                                        tx power drawn per wake, or re-drawn every slot_s inside the wake;
                                        null = fixed net.tx_power_dbm.  (named 2026-11-16: "variable power")
payload:
  eddystone:    { "tlm": true, "tlm_data": { "batt_mv": 1234, "temp_c": 42.0, "count": 7, "uptime_s": 1965 } }
                                        any field given replaces the measured one; the TLM frame carries a clue
                                        (a phone's beacon scanner shows the fields as numbers)
```

- Draws seed from chip uid + cycle (as in C) so the fleet does not hop in
  lockstep and the simulator is deterministic. Log lines per wake:
  `channel this cycle 6`, `tx power this cycle 8 dBm`, `probing for <ssid>`.
- Region: `channels: "any"` resolves at validation from the target's region
  (FCC 1–11 / ETSI 1–13); the firmware receives the resolved list.
- Page: Radio tab — channel chips under the channel field; probe SSID list
  editor (one per line, byte counter); Stealth card — power variation
  fields with a hint on RSSI-only hunting; Payload card — TLM data fields.
  The on-air preview says "ch 1/6/11, one per wake", "power 2–13 dBm".
- **Event sheet**: at deploy, each fleet row gets an `on_air` column — a
  compact summary of what a hunter can observe plus the code: name/SSID (or
  the rotation), MAC (or "per cycle"), channel(s), probe list, iBeacon
  UUID/major/minor, payload kind, Eddystone frames, schedule, portal code,
  owner, points_to (Phase J). The Fleet tab gains **Event sheet**: the
  latest deploy row per chip uid, one line per fox, filtered by
  `fleet.event`, with *Export CSV* and a print view (a plain table that
  fits a page). Regenerable from the fleet log alone — a laptop with the
  log prints the sheet without the boards. It is the field document; the
  fleet log stays the audit trail. No keyphrases, no passwords: there are
  none.
- Sim: `net_contains` for the channel/power/probe lines; distinct-channel
  and distinct-power counts over N cycles; TLM golden with overridden
  fields. Schema corpus +8.

### Phase H — mode rotation and the shell game

Bigger: a fox becomes several foxes over time.

```
stealth:
  modes:        [] | ["wifi-ap", "wifi-probe", "ble"]   the radio kind per wake, in order ("random": drawn);
                                                         [] = net.kind only. Needs the hardware's radios.
  shell_game:   { "identities": [ { "name": "FOX-A", "mac": "F2:..." }, ... ], "period_s": 1800, "index": 0 }
                                        every period_s (board clock) each fox advances one identity: fox with
                                        index i shows identities[(i + floor(clock / period_s)) % n]. Every fox in
                                        the game carries the same list and period; index is its seat.
```

- **Mode rotation**: the fox keeps one radio object per kind
  (`netradio.make` for each in `modes` at setup; RAM check on the C3 —
  AP + BLE already run together in a split clue). `before_up` picks the
  kind for the cycle; the payload/checkpoint/stealth hooks already branch
  on `fox.radio.kind`, so they follow. The name for each kind comes from
  the existing fields (`net.ssid`, `net.name`, `probe_ssids`).
- **Shell game**: needs the board clock (template `needs`: *set the board
  clock at deploy*, blocking without it — same rule as `start.at`). The
  page's Fleet tab gets a **Shell game** helper: pick the foxes, enter the
  identities (name + MAC per seat, MACs generated), period; *Deploy fleet*
  writes the same list to each with its seat index; the sheet prints the
  rotation table (which fox shows which name when). Deep sleep keeps the
  RTC; drift across a day is minutes at most, fine for a 30-minute period.
- Page checks: `modes` entries the hardware lacks → error; shell game with
  `payload.kind = rotate` or `stealth.rotate_mac` → error (two things
  changing the name/MAC); shell game without the clock → error.
- Sim: a two-fox scenario (two runs of the same list with seats 0 and 1,
  same clock) proving the names never collide at any time; mode rotation
  scenario with `net_events` per kind.

### Phase E′ — sense, revised (honeypot, crowd control) + stop after N finds

Replaces the `probes` item of Phase E with what was chosen; `tags` and
`relay` stay as written.

```
sense:
  honeypot: { "enabled": true, "log": true }     wifi-ap: every station that joins (wifi.radio.stations_ap — MAC,
                                                  RSSI, time) → near.csv kind=join. With wifi.Monitor on the chip:
                                                  probe requests for our SSIDs too → kind=probe (not on chips
                                                  without it; the card says which)
  crowd:    { "enabled": true, "max": 8, "quiet_s": 120, "window_s": 3 }
                                                  a BLE scan each cycle counts distinct advertisers above rssi_min;
                                                  more than max → the fox goes quiet for quiet_s (radio down, LED
                                                  'armed' pattern) so a swarm following one team gets nothing.
                                                  BLE scanning exists on every chip; Wi-Fi probe counting only
                                                  where wifi.Monitor does.
checkpoint:
  stop_after_finds: 0                             0 = never; N = after the N-th callsign logged this boot the fox
                                                  goes silent (radio down, LED 'done' = long slow blink) until
                                                  power-cycled; the console says so; the sheet shows N
  stop_at:          null | "2026-08-08T16:00:00"   the same silence at a wall-clock time (board clock, set at
                                                  deploy; blocking without it, as start.at). The 'done' state is one
                                                  mechanism with two triggers, so later designs (a finds quota per
                                                  hour, a stop on a relay signal) reuse it.
```

- `near.csv`: `fox_uid, template, cycle, ms_since_boot, kind, mac, rssi,
  name` (the finds format plus kind/rssi/name). Bench **Who is near**
  reads it into the fleet log like finds.
- Hardware gate: the `wifi.Monitor` check per chip (`import wifi;
  hasattr(wifi, "Monitor")` at the REPL on C3, C5, C6, S3) decides whether
  honeypot `kind=probe` is offered per target; `stations_ap` and BLE
  scanning need no check.
- Sim: `scenario.world.stations`, `.probes`, `.advertisers` (counts over
  time) drive the mocks; crowd-control scenario proves quiet_s and the
  return; stop-after-N scenario with the scripted phone.

### Phase J — Net → FM handoff (page-level)

No new firmware: both fleets already carry text. What is missing is the
link and the fill-in.

```
fleet:
  points_to:   "<chip uid or fleet board_number>"      the fox this one leads to (any family)
```

- Payload / portal / callmessage text accepts placeholders filled at
  deploy from the target fox's profile: `{{to.freq}}` (an FM fox's first
  frequency), `{{to.name}}` (a net fox's SSID / BLE name), `{{to.code}}`
  (its portal code), `{{to.number}}`. A net fox's portal body "Next: listen
  on {{to.freq}} MHz"; an FM fox's Morse `id.callmessage`
  "… QSY {{to.name}}". Unfilled placeholders are a blocking check.
- The sheet gets a `points to` column and prints the chain; the Fleet tab
  draws it as a list (A → B → C), flags loops and dead ends.
- Both directions: an FM fox pointing at a net fox and the reverse; a net
  fox pointing at a net fox is the relay of Phase E by content instead of
  radio.

### Order and size (second round)

| phase | new code (est.) | hardware gate |
|---|---|---|
| G channels, probe lists, power, TLM data, sheet | firmware 120 · page 350 · sim 100 | C3 + phone (channel seen changing; power on a scanner) |
| H mode rotation, shell game | firmware 200 · page 250 · sim 150 | two boards + clock; RAM on the C3 with three radios |
| E′ honeypot, crowd, stop-after-N | firmware 220 · page 150 · sim 150 | per-chip wifi.Monitor answer; a phone to join; a few BLE advertisers |
| J handoff | page 150 | none (sim + demo); then one FM + one net fox |

G first (the sheet is wanted for every later phase and adds columns as
they land), then J (cheap, page-only, exercises the sheet), then H, then
E′ when the Monitor answers are in. One patch per phase; page 0.15 → 0.18,
foxlib 1.8 → 1.10.

Named 2026-11-16: *variable power* (`stealth.variable_power`). `checkpoint.stop_at` added beside `stop_after_finds`. Nothing open before G.
