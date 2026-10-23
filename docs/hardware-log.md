# Hardware log

What was verified on a real board, when, with which firmware — the evidence
behind a target's `status` and a template's `boards_tested`. One entry per
bench session. Record what was checked and how (by ear on a handheld, an
S-meter at distance, a power meter, a scope), not just "works". For
kitsune targets, say which kind of board, never which event's kits.

Commit hashes are the fox-bench commit the firmware was built from; the
Board tab shows them for the site's UF2 (`foxbench-picofox.json`).

| date | board | firmware | checked | how | result |
|---|---|---|---|---|---|
| 2026-10-18 | Seeed XIAO ESP32-C3 + SA868 (2 m and 70 cm modules) | foxlib 1.0.1–1.0.2, CircuitPython 10.2.1 | all seven FM templates deployed from the page; keying, ID, songs, SSTV, QRSS, popcorn/resurrection schedules, keydown limit; `tools/hw_smoke.py` end to end | handheld receiver; bench key test | ok on both bands |
| 2026-10-21 | AI6YM PicoFox rev 3 (vendor firmware) | vendor pfoxr3v1 | settings.txt, rendered audio.wav and .callsign.wav, marker file; cycle timing and carrier offsets as modelled; recovery image behaviour (reformats every boot) | handheld; drive contents | ok; recovery image demoted to a disclosure |
| 2026-10-21 | AI6YM PicoFox rev 3 | foxlib-c 0.1.0 → 0.1.2 | Si5351 tuning and keying, 8 kHz FM (`i2c_write_us` 88), AEN active low, live reload after a drive write, console bench (`id`, `tone 800 2`, `key 3`) mid-stream after the `cur` fix, 1200-baud touch into the bootloader and the firmware swap both ways | handheld; console `status`; drive | ok → target marked stable. Attenuator: codes 0 and 40 accepted, dB per step **not** measured (operator too close for an S-meter difference) |
| 2026-10-22 | AI6YM PicoFox rev 3 | foxlib-c 0.1.6, site build `fb5aac84…` (commit 9499077) | fetched image matched the site fingerprint; flashed via the touch while transmitting; `status`: `i2c_errors=0 core1=ok` with `keyed=1`; a changed Deploy during a cycle: `host_writes=112 i2c_errors=0`, carrier unchanged at 146565000.9; `CHG` appended to the ID while on charger; Fleet Audit `match · via drive · matched by uid`; morse-sstv deploy (`images.bin`, test card when no image) | handheld; console `status`; fleet log | ok. The bus-hold around flash writes holds under 112 host writes while keyed |
| 2026-10-22 | AI6YM PicoFox rev 3 | foxlib-c 0.1.6 | `bootsel` (and the page's Reboot into bootloader) while keyed: carrier drops before RPI-RP2 appears | handheld | ok — off the air before the reset |
| 2026-10-22 | AI6YM PicoFox rev 3 | foxlib-c 0.1.6–0.1.8 | soak across the session's firmware: repeated power cycles, `status` after each | console | ok — `reset=power_on` every time, never `watchdog`, `i2c_errors=0` throughout |
| 2026-10-22 | AI6YM PicoFox rev 3 | foxlib-c 0.1.8, site build (commit 5aa9529, sha `2e642520…`) | 0.1.8 flashed from the site via the touch (port ids `2e8a:000a` reported, "port gone"); deploy written; Fleet Audit `match` by uid after reconnect; `bootsel` from the drawer → RPI-RP2; vendor firmware `pfoxr3v1` flashed back via the touch (pinned sha `dfd60ffd…`), vendor files written, then fox-bench firmware flashed from the vendor side again — the swap holds both ways. Findings: the vendor firmware enumerates as `239a:cafe` (descriptor corrected, page 0.7.5); a `settings.txt.crswap` left by an editor on the drive; the drawer showed a typed command twice (page 0.7.6); `(player late on 1 samples)` once at boot, benign | handheld; console; drive; fleet log | ok |
| 2026-10-22 | AI6YM PicoFox rev 3 | foxlib-c 0.1.9, site build `c1c4496d…` (commit 433d7d6), page 0.7.7 | flashed from the site over the vendor firmware (touch on `239a:cafe`); a pre-0.1.9 UF2 loaded by hand is flagged as older than the site's build; deploy while running (`host_writes=87 i2c_errors=0 core1=ok`, reload ~1 s); bench `id`, `batt`, `status` (`reset=software version=0.1.9`); power cycle with the page connected and reconnect; eject and replug while keyed; Explorer browsing of the drive with and without the page connected; vendor ↔ fox-bench target switch with the drive open (page keeps the handle) | handheld; console; drive; Explorer | ok. `(player late on 2 samples)` after a long `status` reply — noted, sub-millisecond, left alone |
| 2026-10-22 | AI6YM PicoFox rev 3 (vendor firmware) | vendor pfoxr3v1, page 0.7.5–0.7.7 | vendor firmware flashed back from fox-bench's via the touch; its files written from the page; listen only; swapped to fox-bench firmware again. The vendor firmware enumerates as `239a:cafe` | handheld; drive; console | ok → vendor target and template marked stable |
| 2026-10-23 | AI6YM PicoFox rev 3 | foxlib-c 0.1.10, site build `c1cfb49b…` (commit 4db74b3), page 0.7.10 | flashed from the site via the touch over 0.1.9; `board.json` c-0.1.10; deploy while running (reload ~1 s); bench `id`/`tone 800 2`/`key 3` with `CHG` telemetry on the charger; **F15**: `atten 40` mid-cycle → `ok`, cycle restarted, `status attenuation=40`, back to 0 the same way (0.1.9 printed `ok` and dropped the value); power cycle → `reset=power_on`, `i2c_errors=0`, `i2c_write_us=104`; unknown command → `err: unknown command … (help)`. The callsign gate on bench actions (F15) was not reached from the page — the page refuses to deploy a placeholder callsign — and is host-tested. F13 (49.7-day wrap) and F14 (Si5351 absent at boot) are host-tested only | handheld; console; drive | ok → PicoFox signed off on 0.1.10; no further firmware work planned except F10 (attenuator, needs a meter) |

## Not yet verified on hardware

- foxlib-c: attenuator dB per step (needs an S-meter at distance or a power
  meter) **and** the attenuator word format (`player.c atten_write` sends 8
  bits; the datasheet reading in `docs/picofox-hardware.md` describes a
  longer word — possibly the same question); `radio.correction_ppm` (applied
  since 0.1.8, not measured against a counter); `i2c_errors` recovery path exercised only by construction, never
  seen to fire; watchdog timeout path (a hang has not been provoked).
- Templates on the PicoFox other than morse-songs and morse-sstv: the
  firmware runs them in the host simulation, not yet on air.
- Every `compiled` (kitsune) target: descriptors come from public
  documentation; nothing has been flashed or listened to from this page
  (the firmware card's flash path has run only against the simulated
  esptool).
  The ESP32-C5 bootloader offset `0x2000` is the chip's convention, to be
  confirmed. Serial on the AtomS3 Lite / StampS3 is noted as not working by
  kitsune; to be tried.
