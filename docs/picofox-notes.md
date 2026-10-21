# PicoFox — what the bench needs to know

Notes from reading the unit's drive and the published firmware
(https://github.com/ai6ym/PicoFox, `PicoFox-Firmware.ino` at 4 commits),
October 2026. The firmware and hardware are **CC BY-NC-SA 4.0**, Giorgi
Enterprises LLC dba AI6YM.radio; fox-bench does not include or modify
any of it — it only writes the files the firmware already reads. Keep it
that way.

## The device

- RP2040 + SI5351 (TCXO) + amplifier; **FM on 2 m**, 144–148 MHz
  (144–146 in ITU zone 1). The RP2040 retunes the SI5351 PLL once per
  audio sample to make FM: 5 kHz sample rate, deviation = sample ×
  10 kHz / 32767, so full-scale audio is ±10 kHz and a 50 % peak is the
  usual ±5 kHz NBFM. Modulation bandwidth 2.5 kHz by Nyquist.
- Output "above 18 dBm" at attenuation 0; rev 3 boards have a BVA1761
  attenuator, 0–127 steps of ~0.25 dB (→ about −14 dBm). Rev 2 boards
  ignore `ATTENUATION`. The firmware reads the revision from ID pins;
  the page cannot, so the user tells it (or the Serial log says).
- Internal LiPo, charged over USB **only with the power switch on**; the
  USB drive also only enumerates with the switch on.
- USB: composite **mass storage** (`AI6YM PicoFox 2.0`, FAT16 on the
  15 MB filesystem partition of the 16 MB flash) **plus a CDC serial
  port** at 115200 that prints boot and change messages
  (`Revision: 3`, `Detected settings change, generating new callsign
  audio`, `si5351 setup complete.`). No command interface.
- **While the host has the drive mounted the fox does not transmit**
  (`hostMounted` stops playback). Changes take effect after eject +
  power cycle. The page therefore cannot observe a transmission while
  it is connected; it can only write files and, over CDC, watch the
  boot log after the user power-cycles.
- Firmware updates are UF2 (`releases/pfoxr3v1.uf2` → `RPI-RP2` drive).
  BOOTSEL (SW2) is inside the enclosure; the Arduino core the vendor
  firmware is built on reboots into the bootloader when the serial port
  is opened at 1200 baud and DTR dropped — the page's "Reboot into
  bootloader" button. `pfoxr3-forceformat.uf2` reformats the filesystem.

## Files on the drive

| file | written by | meaning |
|---|---|---|
| `settings.txt` | user / page | `KEY=VALUE` lines, upper-cased on read |
| `audio.wav` | user / page | played each cycle before the ID; **5000 Hz, mono, signed 16-bit PCM**. Header is read for `RIFF`/`WAVE` only; the firmware plays to end of file regardless of declared sizes |
| `.callsign.wav` | firmware (or page) | the Morse ID, same format; regenerated from settings when the CRC file does not match |
| `.settings_crc.bin` | firmware (or page) | `int32` little-endian **sum of the bytes of `settings.txt`** (not a CRC). Equal → `.callsign.wav` is kept as is |

A missing `settings.txt` or `audio.wav` is recreated from defaults at
boot (and a default unit does not transmit until a callsign is set). The
README says unexpected files are removed; the published `flashCleanup()`
only recreates missing ones, so stray files are left alone.

Because the firmware keeps `.callsign.wav` when the byte-sum matches,
the page can write **its own ID audio** (full "KY4ZR FOX DE KY4ZR",
proper word spacing, chosen tone and level) together with a matching
`.settings_crc.bin`, and the firmware will play it unchanged. Writing a
stale/absent CRC file instead makes the firmware regenerate its own
12-character ID.

## settings.txt

| key | firmware rule | default |
|---|---|---|
| `CALLSIGN` | up to 12 chars, **only A–Z 0–9 are keyed**; anything else (`/`, `-`, space) is silently dropped from the ID. Empty → transmitter disabled | `""` |
| `ITU_ZONE` | 1 → 144–146 MHz, else 144–148 | 2 |
| `FREQ_MHZ` | must sit 20 kHz inside the band edges (2 × deviation margin) or the transmitter is disabled | 146.565 |
| `DUTY_CYCLE` | 0–100 %; >100 → default; 0 → never transmits | 100 |
| `ATTENUATION` | 0–127, clamped | 0 |
| `MORSE_WPM` | 1–30 else default | 15 |
| `MORSE_FARNSWORTH_WPM` | character spacing speed; < WPM → set equal to WPM | 10 |
| `MORSE_TONE` | 100–2499 Hz else default | 600 |
| `MORSE_TONE_VOL` | 1–100 % of full scale (= % of ±10 kHz deviation) | 70 |

## Cycle timing (what the preview must draw)

```
repeat:
  carrier at f + offset[k]      k steps through 0,+1,+3,+5,+3,+1,0,−1,−3,−5,−3,−1 kHz
  play audio.wav                (length A)
  carrier at f + offset[k+1]
  play .callsign.wav            (length I)
  if DUTY_CYCLE < 100:
      carrier off for (100−DUTY)% × (A+I)
      attenuation := base + {0, 40, 20}[n % 3]   (rev 3 only; ~0 / −10 / −5 dB)
```

So: the carrier **wanders ±5 kHz segment by segment** and, with a duty
cycle below 100 %, the **power steps** through three levels. Both are
firmware behaviour, not settings. Silence inside `audio.wav` is an
unmodulated carrier, still on the air; only the duty-cycle gap is
actually off. The unit as received: 28.8 s default audio + 9.9 s ID
(`K0HRV/LOCK` keyed as `K0HRVLOCK`, 70 % level), 100 % duty.

The firmware's ID generator: dit = 1.2/WPM s, inter-character gap =
3 × 1.2/Farnsworth s, no extra word gap, 1/3-dit raised-cosine-ish ramps,
one dit of silence between elements, leading and trailing inter-character
gaps.

## Audio rendering notes (from the first on-air test)

- The segment-by-segment carrier offsets are audible on a 12.5 kHz
  receiver: segments on the ±5 kHz steps sound off-tune/distorted until
  the next segment. Firmware behaviour; a 25 kHz receiver hears it flat.
- The firmware applies **no pre-emphasis**: deviation is proportional to
  the sample. A receiver's de-emphasis then makes low notes dull compared
  with the SA868 fox (which pre-emphasises and plays a PWM square wave).
  The page renders with 6 dB/octave pre-emphasis relative to the highest
  tone in the stream (floored at −8 dB) and a "bright" tone shape (odd
  harmonics within 2.4 kHz) by default; both are switchable on the Radio
  tab.

## What fox-bench can and cannot do with it

Can: set every key with validation stronger than the firmware's
(callsign characters, band edges per zone, duty/attenuation ranges);
render `audio.wav` from the same event stream the Payload tab previews
(songs, QRSS-style slow Morse, any tone sequence up to 2.5 kHz — SSTV is
at the edge and untested); render `.callsign.wav` + byte-sum so the ID
is exactly what the page played; draw the true cycle (offsets, duty,
power steps); write it all through the File System Access API; log the
drive's serial number into the fleet log; listen on the CDC port for
the boot log after the power cycle.

Cannot: verify a transmission while connected (it does not transmit
with the drive mounted); schedule anything other than a fixed duty
cycle (no popcorn/resurrection — only unmodulated-carrier "silence");
change power finer than the attenuator or at all on rev 2; bench
(no REPL); flash from the page except by copying a UF2 to `RPI-RP2`.
