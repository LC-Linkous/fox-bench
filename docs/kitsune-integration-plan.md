# Plan: RFHS kitsune foxes on the bench

Status: 2026-10-23 — Phase 0 (§3), catalog packs (§6) and the page side of
Phase 1 (§4) are in; nothing has been flashed on a kitsune board from the
page yet. Hardware on fox-bench's bench: a XIAO ESP32C5 (a board kitsune
builds for), a Waveshare ESP32-S3-Nano (stands in for the Arduino Nano
ESP32) and a XIAO ESP32C6 (not a kitsune board; fox-bench carries an env for
it) — targets `*-kitsune` for all three, behind "Show experimental targets".
(A FireBeetle 2 ESP32-C5 stood in for the XIAO C5 until 2026-10-24.)
The first images come from the `kitsune` CI job on the `kitsune` branch as
a **run artifact** (`KITSUNE_BUILD`), built with fox-bench's bench
conference (§10) — nothing hosted (`KITSUNE_HOST` stays unset, §7). Phase 2
waits on §8.
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
https://github.com/rfhs/kitsune — with their agreement (§7). The target descriptor says where the image comes from (a site path, or
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

**Both modes, layered.** A *conference build* is what kitsune produces
today: a binary for one board, one challenge kind, one tier, with that
tier's values compiled in — its identity is the challenge, and every board
flashed with it is the same fox (spares are interchangeable). *Per-fox
configuration* is the same binary with the tier block's values read from
`foxcfg` — its identity is the device. The partition layers the second on
the first: the compiled defaults are the conference's values, so a kit
with an empty partition is a conference build byte for byte, and the
partition holds only what differs for this kit — a fresh MAC after a hunter
kept the old kit, a different channel for a venue, a quieter tier on a
spare, or, for a board of one's own, every value. Neither mode asks the
other to change.

**The partition's state is visible and controllable, three ways:**

| state | banner | Board tab | how it gets there |
|---|---|---|---|
| erased (all `0xFF`) | `cfg=default(missing)` | "conference build" | never written, or **Clear per-fox config** (erases the partition; no reflash) |
| written, `"enabled": false` | `cfg=disabled` | "per-fox config present, disabled" | the toggle for A/B at the bench: flip, power-cycle, flip back, without rewriting |
| written, enabled | `cfg=ok` / `partial(…)` | "per-fox config, N values overridden" | **Write** on the Deploy tab |

The audit records the state with the rest of the banner, so a kit that was
supposed to be overridden and is still a conference build shows up as a
mismatch before it leaves the table.

## 6. Their own versions later

Two things make a fork or a parallel bench cheap, and both are worth doing
in Phase 0 so the shape is right from the start:

- **Catalog packs** (done). `loaders.js` takes pack URLs
  (`?pack=https://…/bench/`, or the list saved on the Board tab), fetches
  each pack's `pack.json` and merges its hardware, targets, templates and
  modules over the built-in catalog — a pack entry with a built-in id
  replaces it, every entry is marked with the pack's name, a pack supplies
  defaults for its own targets even for templates it does not re-publish,
  and image paths resolve relative to the pack. Packs are data only: a
  target may name one of the page's vendor models, never code of its own.
  So kitsune's repository can own its descriptors and release manifests and
  update them without a fox-bench release, while the families, flasher,
  validator and audit stay here. `python3 tools/check_catalog.py --pack
  <dir>` lints a pack as the page will see it, for their CI;
  `tests/fixtures/pack/` is a worked example.
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

## 7. Attribution and their distribution

fox-bench never produces an official kitsune image. Anything its CI builds
is labelled as *fox-bench's build of kitsune at commit X*, links to their
repository, and carries that commit in its fingerprint, so a fox flashed
from the page is traceable to their source and distinguishable from their
own releases. When they publish releases, the target descriptors point at
those (pinned by tag, sha256 recorded) and the build job goes away; if they
would rather no builds were hosted here at all, the descriptor loses its
image and the family falls back to exporting the header, which is where it
stands today. None of this needs them to change their process, and nothing
hosted here competes with or overrides a decision they make about their own
distribution. Until there is an agreement and a licence file in their
repository, the build job exists but does not run.

The hardware this family describes is *what the firmware can run on* — the
boards in kitsune's public support table, with their radios — not what any
event fields. Nothing that would help a contestant (rolled addresses,
names, key phrases, which kit got which build) is in this repository: it
lives in profiles and the fleet log, in the operator's browser. Hardware
notes and `boards_tested` for these targets say "verified on an Atom Lite",
never which boards an event uses.

## 8. Things to settle with RFHS

1. ~~Per-fox configuration or conference builds?~~ Both, layered (§5):
   decided on this side; the partition design costs them nothing when it is
   empty, so it can be offered as a PR before they decide to use it.
2. A licence file in their repository, and whether they will publish
   release assets (merged binaries + manifest) from their CI and pin a
   release per event. The page never fetches a moving branch (the vendor
   PicoFox lesson). Can take weeks; nothing here blocks on it.
3. The `foxcfg` partition: offset and size they are happy with across their
   partition tables (the Zigbee table is custom); whether the C5's 5 GHz
   channel list and regulatory domain belong in config or stay compiled.
4. Serial on the S3 boards: their notes say it isn't working on AtomS3 /
   StampS3. Phase 2's banner needs it; Phase 1 does not. To be tried on a
   board here: Listen only is the whole test.
5. The flag words and the kit sheet: generated on the page, or left to
   `make_conference_full` with the page exporting what it needs? The fleet
   log can carry either.
6. ESP32-C2, if it is real: no native USB (serial adapter for flashing and
   Listen), 2 MB/4 MB flash, Wi-Fi 2.4 and BLE only — fine for WiFi and
   iBeacon, needs its own hardware descriptor and a `foxcfg` offset that
   fits a smaller table.

## 9. Order of work

1. ✓ Phase 0 (bench only): hardware descriptors, `compiled` family, the five
   templates with CONFIG.md sections and validation, duty schedule, the
   header exporter/importer, fleet columns.
2. ✓ Catalog packs (§6).
3. ✓ Phase 1 (bench): the flasher checks the detected chip against the
   descriptor before any erase (esptool-js already speaks ESP32 / S3 / C5),
   the firmware card for the family takes the site's manifest images or a
   merged image from a local PlatformIO build, the fleet row carries the
   efuse MAC as UID, Listen parses their boot lines; the CI build job
   (`tools/build_kitsune.py`, environments mapped per target in
   `firmware.envs`) is present and gated by the repository variables
   `KITSUNE_BUILD` / `KITSUNE_COMMIT`, off until §7's agreement. Unverified
   on hardware: no kitsune board has been flashed from the page.
4. One `pio run` of an exported header in a kitsune checkout — the check
   that the exporter is right; an S3 board on the bench for the serial
   question.
5. kitsune PR: `foxcfg` partition + banner (Phase 2 input), behind
   "partition empty → unchanged", with the reader offered under a
   permissive licence so it can be dropped into their tree.
6. Phase 2 (bench): partition write / erase / `enabled` toggle, the
   three-state badge, then the existing audit/compat machinery over it.

## 10. The bench conference and fox-bench's own envs

An image fox-bench builds must never carry an event's configuration:
kitsune's checkouts have `src/current_conf.h` pointing at whichever
conference was last switched to. `tools/build_kitsune.py --conf-dir
firmware/kitsune/bench` installs fox-bench's own header in each project
before building. Those headers are **generated by the page's exporter**
(`node tools/kitsune_bench_conf.mjs`, from the templates' defaults; CI checks
they are current) with values that say what they are — SSIDs and names
`FOXBENCH …`, MACs `F2:B0:00:00:00:xx` — one section per tier/mode the
project's envs select by build flag, exactly the shape of their
`conferences/*.h`. So a bench image is kitsune's code with fox-bench's
configuration, and the manifest says so (`conference`).

Boards kitsune does not list get envs from `firmware/kitsune/extra/<project>.ini`,
passed as `pio run -c`; kitsune's `platformio.ini` is merged in unchanged
(`extra_configs`), so their `[env]`, `[difficulty]` and `[mode]` sections
apply and their tree is not edited. Env names carry an `fb-` prefix. Their
LED macro header knows five boards by `ARDUINO_*` define; for any other
board `DATA_PIN` is passed in and the digital-LED path is used — no colours
on a plain LED. The right fix is an entry in their `rfhsledmacros.h`, which
is the kind of PR their README invites; until then the C6's LED is cosmetic.

Branch convention: `main` carries what the hardware log vouches for and is
what Pages deploys; kitsune work goes on the `kitsune` branch (tests run,
no deploy) and merges to `main` when a board has been on the bench. On the
branch, `KITSUNE_BUILD=true` and `KITSUNE_COMMIT=<sha>` (repository
variables) make the job build; the images are in the run's `kitsune-images`
artifact, loaded on the Board tab with "Load merged .bin…". `KITSUNE_HOST`
stays unset.
