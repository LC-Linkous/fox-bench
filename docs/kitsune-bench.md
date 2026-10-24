# kitsune on the bench — first flash from the page

The checklist for the first time kitsune firmware goes onto a board from
fox-bench. One section per board on the bench; each ends with what goes in
`docs/hardware-log.md`. Read `docs/kitsune-integration-plan.md` §10 for
what the images are (kitsune's code, fox-bench's bench configuration).

## Before the bench

1. On the `kitsune` branch, the repository variables `KITSUNE_BUILD=true`
   and `KITSUNE_COMMIT=<sha>` are set and the `kitsune` CI job is green.
   Download the run's **kitsune-images** artifact and unzip it: a folder
   with `manifest.json` and one merged `.bin` per environment.
2. Board tab → tick **Show experimental targets**.
3. **Open artifact folder…** on the firmware card and pick that folder. The
   console says how many images it holds and which commit of kitsune they
   are from; the card offers one button per tier/mode for the selected
   board × template. Each image is checked against the manifest's sha256
   when fetched, exactly as a hosted manifest would be.
4. A phone with Wi-Fi scanning (and a BLE scanner app for the iBeacon
   images; a Zigbee sniffer or a second 802.15.4 board for the coordinator).
5. **Power.** kitsune foxes sleep between transmissions. A USB power bank
   with a low-current auto-off cuts power during the sleep and the fox
   never wakes; on the bench, power from the computer's USB, and for the
   field use a pack without auto-off (kitsune's README names two).

What to expect from serial: kitsune prints `ESP32 boot count`, `Awake and
screaming`, `Going to sleep` and, on a self-check failure, `PANIC`. On
boards with **native USB** (every one below) the port disappears while the
chip sleeps and comes back when it wakes — the page's "serial port dropped"
line every cycle is that, not a fault; only a board with a USB bridge chip
(the ATOM Lite) keeps a console through sleep. Listen only works between
sleeps; reconnect after each.

## Waveshare ESP32-S3-Nano (target `waveshare_esp32s3_nano-kitsune`)

Flashes kitsune's **Arduino Nano ESP32** build (Waveshare's board is
pin-compatible, RGB LED included).

1. Hold **BOOT**, plug in USB-C, release. The port is the chip's own
   USB-JTAG-serial (303a:1001).
2. Board tab: select the target; Behavior: **Wi-Fi access point**; firmware
   card: **Get easy wifi-ap** (`arduino-nano-esp32-easy-ap.bin`).
3. **Flash**. Expect in the console: `Chip is ESP32-S3`, the erase, the
   write at `0x0`, "Hard resetting", a fleet row `flash … ok` with the efuse
   MAC as uid. A refusal "the port belongs to an ESP32-xx, but the selected
   board is an ESP32-S3" means the wrong board is on the port — nothing was
   erased.
4. After the reset: **Listen only**. Expect `ESP32 boot count: 1`, `Awake
   and screaming`; the RGB LED lights (violet, then the tier colour). After
   `TIME_TO_WAKE` (15 s) `Going to sleep` and the port drops.
5. Phone: an open network **FOXBENCH WiFi AP Easy** on channel 1 while
   awake, gone while asleep.
6. Then `arduino-nano-esp32-easy-client.bin` (the fox tries to join
   `FOXBENCH WiFi Client Easy` — it will not find it; the point is that it
   boots, sleeps and wakes), and the `hard` AP (hidden SSID, channel 6:
   the phone's scanner shows a hidden network).
7. Hardware-log row: date · "Waveshare ESP32-S3-Nano (Arduino Nano ESP32
   build)" · kitsune commit + manifest `built` + page version · what was
   seen (serial lines, LED, SSID on the phone, sleep/wake timing) · result.
   This row is evidence for the **Waveshare** target only; the Arduino Nano
   ESP32 target stays experimental until a real one is on the bench.

## DFRobot FireBeetle 2 ESP32-C5 (target `dfrobot_firebeetle2_esp32c5-kitsune`)

Flashes kitsune's **XIAO ESP32C5** build (same chip and module class). The
FireBeetle's LED is on GPIO 15; the build drives GPIO 27, so **no status
colours on this board** — expected, not a fault.

1. Hold **BOOT** (GPIO 28), plug in, release (or hold BOOT, tap RST).
2. Target, **Wi-Fi access point**, **Get easy wifi-ap**
   (`seeed-xiao-esp32c5-easy-ap.bin`), **Flash**. Expect `Chip is
   ESP32-C5`. This is also the test of the C5's `0x2000` bootloader offset:
   the merged image is written at `0x0` with the bootloader inside it at
   0x2000; if the board does not boot afterwards (no serial at all after
   the reset, no SSID), the offset in `hardware/dfrobot_firebeetle2_esp32c5.json`
   (and the XIAO's) is wrong — record exactly that.
3. Listen only: the ROM banner `ESP-ROM:esp32c5-eco2-…` then kitsune's
   lines. Phone: **FOXBENCH WiFi AP Easy**.
4. **5 GHz**: `seeed-xiao-esp32c5-fiveeasy-ap.bin` → **FOXBENCH WiFi 5GHz
   AP Easy** on channel 36 — a 5 GHz-capable phone sees it, a 2.4-only one
   does not. Then `fivehard` (channel 149, hidden).
5. **Zigbee**: `seeed-xiao-esp32c5-easy-coordinator.bin`. Serial should show
   the coordinator forming a network on channel 15. Seeing it over the air
   needs a sniffer or the C6 (below); without one, "boots, sleeps, wakes" is
   the result.
6. Hardware-log row as above, for the **FireBeetle** target. The 5 GHz and
   Zigbee templates get `boards_tested: dfrobot_firebeetle2_esp32c5-kitsune`
   once seen on air.

## Seeed XIAO ESP32C6 (target `seeed_xiao_esp32c6-kitsune`)

Not a board kitsune builds for: the images are kitsune's code built with
fox-bench's own environments (`fb-` prefix, `firmware/kitsune/extra/`).
The first thing this board tests is whether that build exists at all —
check the CI log for `fb-seeed-xiao-esp32c6-easy-ap` before the bench.

1. Hold **BOOT**, plug in, release.
2. Target, **Wi-Fi access point**, **Get easy wifi-ap**
   (`fb-seeed-xiao-esp32c6-easy-ap.bin`), **Flash**. Expect `Chip is
   ESP32-C6`.
3. Listen only; phone: **FOXBENCH WiFi AP Easy**. The yellow LED will not
   show colours (a digital-LED driver on a plain LED; on/off flicker at
   best) — expected until kitsune's LED header knows the board
   (`docs/kitsune-c6-proposal.md`).
4. Hardware-log row says "fox-bench build (fb- env), not a kitsune
   release". If it works, the proposal document is what goes to the kitsune
   project.

## As a Zigbee pair (C5 + C6), later

With a coordinator image on one and a second 802.15.4 build on the other
(not in kitsune yet), the C6 could confirm the C5's network over the air.
Not for the first session.

## What a finding looks like

- Flash refused with the chip message → the right behaviour; swap boards.
- Flash ok, no serial, no SSID → the image or the offset; note which board
  and which image, try the `.bin` with `esptool.py write_flash 0x0` from a
  terminal to separate the page from the image.
- Serial ok, no SSID → the configuration (the bench header); report the
  serial lines.
- SSID ok, LED wrong → expected on the FireBeetle and the C6; a finding on
  the S3-Nano.
