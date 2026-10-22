# Plan: RFHS kitsune foxes on the bench

Status: October 2026 — Phase 0 (§3) is in the page as the `compiled`
family (five hardware descriptors and targets, five templates, the
`challenge` / `wifi` / `ble` / `bt` / `zigbee` / `schedule.duty` sections
in CONFIG.md, header export and import, fleet columns); catalog packs
(§6) are not. Phases 1 and 2 are the plan to discuss with the RF Hackers
Sanctuary people before they are built.
Source studied: `github.com/rfhs/kitsune` at `cdfc0ce` (2026-10-17).

kitsune is the work of its authors at https://github.com/rfhs/kitsune and
belongs to them; this document describes it only to plan how the bench
could work alongside it. Nothing of kitsune is copied here. Where the plan
says the bench's CI would build kitsune images, that happens only with the
project's agreement, from a commit they name, with the images marked as
theirs and linking to their repository — their repository carries no
licence file at the time of writing, so nothing of theirs is redistributed
until they say how.

## 1. What kitsune is

kitsune is the RF CTF's fox firmware: PlatformIO/Arduino C++ for ESP32-family
boards, one project per challenge kind, built for several boards each:

| challenge | radio | boards (per their README) | what a hunter looks for |
|---|---|---|---|
| WiFi AP (2.4 GHz; 5 GHz on the C5) | Wi-Fi | Atom-lite, AtomS3-lite, StampS3, Nano ESP32, XIAO ESP32C5 | SSID, BSSID (spoofed MAC), channel |
| WiFi client | Wi-Fi | same | a station probing/associating with a given MAC |
| BLE iBeacon | BLE | all but the C5 | UUID / major / minor / device name / MAC |
| BT Classic discoverable | BR/EDR | Atom-lite only (original ESP32; pinned to core 2.x) | device name, MAC |
| Zigbee coordinator | 802.15.4 | XIAO ESP32C5 only | PAN, EUI-64, channel |
| "FM fox" | FM broadcast | a store-bought transmitter (not firmware) | a carrier — only a stub so the paperwork generator covers it |

Everything that makes one fox different from another is a **compile-time
`#define`** in a per-conference header (`src/conferences/<year><name>.h`,
symlinked to `current_conf.h`): SSID/PSK, spoofed MAC (`0xF2…`, locally
administered), channel (0 = random, worldwide 1–11; a 5 GHz list on the C5),
hidden, max clients, TX power (an enum per radio), and the duty cycle
`TIME_TO_WAKE` / `TIME_TO_SLEEP` (deep sleep between). Difficulty tiers
(EASY / HARD / MEDIUM / FIVE*) pick one block of defines; `platformio.ini`
multiplies board × difficulty × mode into build environments.

Around the firmware there is a paper workflow the bench does not have yet:
`make_conference` rolls fresh random MACs/UUIDs into a new header for every
challenge; `make_conference_full` also writes `<conf>.txt` — challenge name,
the key phrase a hunter must say, SSID/MAC/channel, and a three-word flag
per fox — the sheet that goes in the fox kit. `switch_conference` re-points
the symlinks; CI builds the demo and skeleton headers on every PR.

At runtime a kitsune fox has no interface. It prints a few lines on serial
("boot count", "Awake and screaming"), self-checks that the spoofed MAC,
channel and SSID took (red/yellow blink = fatal), shows state on one LED,
and sleeps. Three of their boards (AtomS3, StampS3, Nano ESP32) use native
USB CDC and two of those are noted "serial isn't working".

Hardware is mix-and-match in a way the current bench is not: five boards,
three ESP32 variants (ESP32, S3, C5), three LED arrangements (WS2812 on a
pin, three analog RGB pins, a single yellow LED), and radios that exist only
on some chips. ESP32-C2 was mentioned as a possibility; it is not in their
list today, has no native USB, and would need a serial adapter for flashing.

## 2. How that maps onto the bench

The bench's contract is `fox.json` over `defaults.json`, validated the same
way on the page and in the firmware, carried by some transport, with a `FOX`
banner on serial for identity and status. kitsune has the same *information*
(a configuration per fox, a board, a radio, a duty cycle, a self-check
result) but bakes it in at compile time and has no transport. So the
integration question is not "can the forms express a WiFi fox" — they can,
with new sections — but **where the configuration crosses from the page to
the board**. Three answers, each a phase; each is useful on its own.

| | where config crosses | kitsune change | bench change |
|---|---|---|---|
| Phase 0 | a conference header exported from the page | none | templates + export/import |
| Phase 1 | a prebuilt binary per board × challenge × tier, flashed from the page | CI publishes binaries with a manifest | flasher for ESP32/S3/C5, a `compiled` family |
| Phase 2 | `fox.json` written into a flash partition the firmware reads at boot | read a JSON partition, print the banner | write a partition with esptool-js; everything else already exists |

A fourth strand — their own versions later — is addressed by keeping the
*data* (hardware, targets, templates, binaries) loadable from their
repository while the *mechanism* (families, flasher, validator) lives here.

## 3. Phase 0 — same forms, their build

Goal: a kitsune conference can be prepared on the bench and the result
dropped into their repository with no change to kitsune. Mostly data and one
exporter; a week or so.

**Hardware and targets.** `hardware/m5stack_atom_lite.json`,
`m5stack_atoms3_lite.json`, `m5stack_stamps3.json`, `arduino_nano_esp32.json`,
`seeed_xiao_esp32c5.json` with the chip (`esp32` / `esp32s3` / `esp32c5`),
flash size, USB IDs, bootloader entry (hold the button while plugging in;
the Atom's button is GPIO39), the LED arrangement, and which radios the chip
has (`wifi24`, `wifi5`, `ble`, `btclassic`, `ieee802154`). One target per
board for a new family `compiled` (`boards/<hw>-kitsune.json`), `status:
planned` until Phase 1 can flash it — the lint already enforces that.

**Templates** in a new family `compiled`, one per challenge kind:
`wifi-ap`, `wifi-client`, `ble-ibeacon`, `bt-classic`, `zigbee-coordinator`.
`template.json` gains `radios: ["wifi24"]` etc. so the page offers a template
only on hardware that has the radio (BT Classic → Atom-lite only, Zigbee →
C5 only), the same way `families` filters today.

**Config sections** (CONFIG.md additions; validated in `schema.js` and, in
Phase 2, in the firmware):

```json
{
  "template": "wifi-ap", "board": "m5stack_atom_lite-kitsune",
  "challenge": { "name": "WiFi AP Easy Fox", "keyphrase": "Are you the WiFi AP Easy Fox?", "tier": "easy" },
  "wifi":  { "ssid": "Hiro WiFi AP Easy Fox", "psk": "0123456789", "mac": "F2:F4:90:22:0D:0F",
             "band": "2.4", "channel": 1, "hidden": false, "max_clients": 1, "tx_power_dbm": 17 },
  "ble":   { "device_name": "…", "uuid": "…", "major": 5, "minor": 88, "signal_power": -59, "mac": "…", "tx_power_dbm": 9, "interval_ms": 43 },
  "schedule": { "kind": "duty", "wake_s": 15, "sleep_s": 5 },
  "led": { "enabled": true }
}
```

Rules the page would enforce that the headers only document: SSID ≤ 32
bytes, PSK 8–63 or empty, MAC locally administered and unicast (bit 1 set,
bit 0 clear of the first byte — their `0xF2` convention), channel 1–11 for
2.4 GHz unless a regulatory domain says 1–13, the C5's 5 GHz list, TX power
from the enum the chip offers, `max_clients` 1–4, wake ≥ a few seconds so
the self-check has time to run (their comment), sleep that fits the
battery note (no low-power-cutoff packs). `challenge.tier` is a label, not
behaviour: the page writes one explicit configuration, where kitsune picks
a block by `-D EASY`.

**What our existing tabs mean here.** ID → the challenge card (name, key
phrase, SSID/device name); Plan → channel/band; Radio → TX power and the
chip's radios; Schedule → the `duty` kind (the timeline preview works
unchanged: on for `wake_s`, off for `sleep_s`); Payload → nothing (hidden
for the family); Bench → nothing until Phase 2. The amateur-radio gates
(callsign set, Part 97 band table) are off for the family — these are
Part 15 devices and the forms must not demand a callsign.

**Exporter / importer.** Deploy tab, family `compiled`, Phase 0 offers:
"Export kitsune header" — a `src/conferences/<year><name>.h` for the
chosen challenge with the tier block filled from the form (and the
`RFHS_CHALLENGE_NAME` / `FOX_KEYWORDS` comments their report scripts grep
for), plus the line `make_conference_full` would have produced; and "Import
header" — parse a header back into the form, so their existing conferences
become profiles. The fleet log gets `challenge` and `flag` columns; the
three-word flag can be rolled on the page (their `threewords` is a
dictionary pick — the page has no dictionary; a short word list in `songs/`
style, or leave the flag to their script and record it after). Profiles
then hold a whole conference: one profile per fox, loaded and exported in
turn.

What Phase 0 does *not* do: compile, flash, or know which binary a fox runs.
Its value is one set of forms, validation, previews, profiles and a fleet
log for both teams' foxes, and a bridge into their workflow that costs them
nothing.

## 4. Phase 1 — flash from the page

Goal: a kitsune fox goes from a blank board to transmitting from the Board
tab, the way the XIAO and the PicoFox do now.

**Where the images come from.** While the bench is being tested against
kitsune, the images are built by the bench's own CI from a commit of their
repository pinned by hash (the way pico-sdk is pinned), staged under
`firmware/kitsune/` on the site with a manifest, and attributed to
https://github.com/rfhs/kitsune — with their agreement, see the note at the
top. The target descriptor says where the image comes from (a site path, or
later a URL pinned to one of their releases with a sha256), so moving to
their own release assets is a descriptor change, never a code change, and
the page never fetches a branch.

**kitsune side (small, in their CI, later):** publish the build matrix as release
assets — for each `env:` the merged image (`bootloader + partitions + app`
at the right offsets; `pio run -t` can produce it, or `esptool merge_bin`)
and a `manifest.json` naming board, challenge, tier/mode, conference header
used, sha256 and size. Their CI already builds every environment on PRs;
this is the same build, kept.

**bench side:**
- `flasher/`: today it knows the ESP32-C3 at offset `0x0`. esptool-js 0.7.0
  already speaks ESP32, S3, C5 and C6; the hardware descriptor supplies
  `flash.chip`, `flash.offset` (`0x1000` for the original ESP32, `0x0` for
  S3/C3/C5/C6), mode/frequency, and whether the board's USB is a native CDC
  (S3, C5 — hold BOOT while plugging in) or a bridge (Atom-lite's CH9102).
  The audit's M13 (compare the detected chip with `flash.chip` before
  erasing) becomes mandatory here because several chips are in play.
- A firmware card for the `compiled` family: choose challenge and tier, the
  page fetches the pinned asset for this board (same machinery as the vendor
  PicoFox: URL pinned to a release tag, sha256 in a descriptor or the
  manifest, checked before anything is written), flashes it, logs a fleet
  row with the chip's efuse MAC as the UID (esptool reports it — it is the
  one identity a kitsune fox has) and the image hash.
- Listen only on the serial port reads their existing lines ("ESP32 boot
  count", "Awake and screaming", "PANIC") the way it reads the vendor
  PicoFox's boot log, so the self-check result reaches the page.

Configuration is still baked into the binary in Phase 1: the page picks
*which* conference build to flash. That is enough for a conference where
the headers were rolled once; it is not per-fox configuration.

## 5. Phase 2 — per-fox configuration without recompiling

Goal: one binary per board × challenge, configured per fox from the page —
the bench's actual contract — and the audit / compatibility / fleet
machinery working for kitsune foxes unchanged.

**kitsune side (modest, a PR we can write):**
- A dedicated flash partition `foxcfg` (16 KB, fixed offset, in their
  partition tables — they already carry a custom table for Zigbee) holding
  `fox.json`. At boot: read it, validate the fields the challenge uses with
  the compiled defines as defaults (ArduinoJson or a small reader), print
  one line `FOX template=wifi-ap/<ver> foxlib=k-<ver> board=<id>
  uid=<efuse mac> cfg=ok|partial(...)|default(parse) radio=ok|mac_failed|…
  id=set|unset freq=<channel>` — the same banner grammar the page already
  parses — and carry on exactly as today. Missing or empty partition →
  current behaviour, byte for byte.
- Optionally the self-checks report into `radio=` (their MAC/channel/SSID
  checks map onto it directly) so the fatal blink has words on serial.

**bench side:** writing a 16 KB partition at a fixed offset with esptool-js
is the same call the flasher already makes with a different offset and no
erase of the rest; reading it back (`read_flash`) verifies. So the Deploy
tab's "Write" for this family becomes: enter the bootloader, write
`foxcfg`, reset, Listen for the banner. From there everything the bench
grew this month applies without new code: the deploy row carries the UID,
Audit compares the banner with the log, `compat.js` compares `foxlib=k-x.y`
with the version the page was built against, `FOXLIBC_SINCE`-style tables
say which `fox.json` keys a given kitsune build understands.

The cost on the fox side is one JSON read at boot (tens of milliseconds;
their timing budget subtracts fixed delays already) and one partition in
the table. Deep sleep is untouched: the config is in flash, not RTC RAM.

## 6. Their own versions later

Two things make a fork or a parallel bench cheap, and both are worth doing
in Phase 0 so the shape is right from the start:

- **Catalog packs.** Today `loaders.js` reads `hardware/`, `boards/`,
  `modules/`, `templates/` from the page's own origin. Let it take a second
  base URL (`?catalog=https://rfhs.github.io/kitsune/bench/` or a setting)
  and merge that pack's index files over the built-in ones. Then kitsune's
  repository can own its hardware descriptors, targets, templates, song-less
  defaults and release manifests — and update them without a fox-bench
  release — while the families, flasher, validator and audit stay here. The
  lint runs in their CI against their pack (`check_catalog.py --pack`).
- **Family code in one place.** The `compiled` family's transport (esptool
  partition write), banner parsing and exporter are generic; nothing in them
  is RFHS-specific. Their challenge kinds are templates (data) and their
  boards are descriptors (data). If they want a differently branded page,
  the page is static files under GPL-2.0-only: a fork with its own
  `index.html` and catalog pack keeps pulling the mechanism from upstream.

Governance to agree on: descriptors and templates for their hardware live
in their repository (they know the boards); the family code, the flasher's
chip support and CONFIG.md sections live here and take PRs; versions of the
`fox.json` sections they read are declared in their manifest so
`compat.js` can tell a fox from 2025 apart from one from 2026.

## 7. Things to settle with RFHS first

1. Is per-fox configuration (Phase 2) wanted, or is "pick a conference
   build and flash it" (Phase 1) their actual workflow? Their scripts
   suggest conferences are rolled once per event; per-fox config matters
   more for ad-hoc hunts and for reusing kits.
2. Will they publish release assets (merged binaries + manifest) from their
   CI, and pin a release per event? The page must never fetch a moving
   branch (the vendor PicoFox lesson).
3. The `foxcfg` partition: offset and size they are happy with across their
   partition tables (the Zigbee table is custom); whether the C5's 5 GHz
   channel list and regulatory domain belong in config or stay compiled.
4. Serial on the S3 boards: their notes say it isn't working on AtomS3 /
   StampS3. Phase 2's banner needs it; Phase 1 does not. Worth a look at
   `ARDUINO_USB_CDC_ON_BOOT` / `USBSerial` before counting on Listen there.
5. The flag words and the kit sheet: generated on the page, or left to
   `make_conference_full` with the page exporting what it needs? The fleet
   log can carry either.
6. ESP32-C2, if it is real: no native USB (serial adapter for flashing and
   Listen), 2 MB/4 MB flash, Wi-Fi 2.4 and BLE only — fine for WiFi and
   iBeacon, needs its own hardware descriptor and a `foxcfg` offset that
   fits a smaller table.

## 8. Order of work, if agreed

1. Phase 0 (bench only): hardware descriptors, `compiled` family, the five
   templates with CONFIG.md sections and validation, duty schedule, the
   header exporter/importer, fleet columns, catalog-pack loading. Reviewable
   as data plus one module; the smoke test gets a kitsune walk against the
   demo.
2. kitsune PR A: release assets + manifest from their CI (Phase 1 input).
3. Phase 1 (bench): flasher chip support, the firmware card for the family,
   efuse-MAC UIDs, Listen parsing their boot lines.
4. kitsune PR B: `foxcfg` partition + banner (Phase 2 input), behind
   "partition empty → unchanged".
5. Phase 2 (bench): partition write/read, then the existing audit/compat
   machinery over it.
