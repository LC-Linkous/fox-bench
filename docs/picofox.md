# PicoFox — the hardware and the vendor firmware, as the bench needs them

Two halves of one subject: the hardware (from its schematic) that fox-bench's
own firmware is written against, and what the vendor firmware on the drive
reads and does — the basis of the drive family.

## Hardware — what fox-bench's own firmware is written against

This document is the clean-room boundary for `firmware/foxlib-c/picofox`.
It records the hardware facts taken from the published schematic
(`PicoFox-PCB`, rev 2, 2025-06-09, AI6YM.radio, CC BY-NC-SA 4.0) and from
component datasheets. The vendor's firmware source was read earlier to
understand what the firmware *has to do* (docs/picofox.md); nothing
from it is reproduced here or in our firmware. Credit for the hardware
design belongs to AI6YM.radio.

### Block diagram

```
USB-C ──► BQ21040 charger ──► LiPo (BT2) ──► SW3 (power switch) ──► Q1 P-FET ──► SWITCHED_VBATT
                                                                                   │
                                                                   ME6217C33 LDO ──┴──► +3V3 (RP2040, SI5351, TCXO)
RP2040 ──I2C0──► SI5351A-B-GT (25 MHz TCXO on XA) ──CLK0──► 3 dB pad ──► LPF ──► BVA1761 amp/attenuator ──► LPF ──► SMA J4
        ──GPIO2──────────────────────────────────────────────────────────────────► AEN (amp enable)
        ──GPIO4──────────────────────────────────────────────────────────────────► LE  (attenuator latch)
```

### RP2040 pin map

| GPIO | net | direction | notes |
|---|---|---|---|
| 0 | `I2C0 SDA` | I²C0 SDA | 2.2 kΩ pull-ups (R9/R10) to +3V3. Also the BVA1761 `DATA` line |
| 1 | `I2C0 SCL` | I²C0 SCL | also the BVA1761 `CLK` line |
| 2 | `AMP_EN` | out | → R6 1 kΩ → BVA1761 `AEN` |
| 3 | — | | unused (TP) |
| 4 | `ATTN_LE` | out | BVA1761 `LE` (latch enable) |
| 14 | `GPIO14` | in | on the IO header J3; vendor firmware uses it as a factory test strap (pull-down, high = test) |
| 15 | `ChgSense` | in | charger `/CHG` via 1N4148 + 10 kΩ pull-up: **low while charging** |
| 16–21 | `GPIO16…21` | | IO header J3 |
| 22 | `ID0` | in | board revision; rev 2: all four low (NC), rev 3: ID0 high, others low. Use internal pull-downs |
| 23, 24, 25 | `ID1`, `ID2`, `ID3` | in | revision bits (see above) |
| 26 | `GPIO26_ADC0` | | IO header J3 (free ADC) |
| 27 | `CC1Sense` | ADC1 | USB-C CC1 through 5.11 kΩ (cable orientation / source current) |
| 28 | `GPIO28_ADC2` | | IO header J3 (free ADC) |
| 29 | `CC2Sense` | ADC3 | USB-C CC2 |
| — | `RUN` | | SW1 reset button; on J3 |
| — | `USB_BOOT` | | SW2 BOOTSEL (QSPI_SS) — **inside the enclosure**; the side switch is SW3 power. Firmware is changed through the Arduino 1200-baud touch on the serial port instead (both firmwares answer it) |

There is **no LED on a GPIO**: D2 "LED" is on +3V3 via R12 (power indicator),
D5 is the regulator's, D4 the charger's. There is **no battery-voltage divider
to an ADC**; the only battery-related input is `ChgSense`. VBUS presence is not
on a GPIO either (CC sense gives an indirect indication when a source is attached).

Flash: W25Q128JVS, 16 MB QSPI. Crystal: 12 MHz ABM8 (standard RP2040 clocking).
USB: Type-C with USBLC6 ESD, 5.11 kΩ CC pull-downs (sink). Power switch SW3
drives Q1 (AO3407A) — with it off the RP2040 is unpowered, so the drive only
appears with the switch on (matches observed behaviour).

### Si5351A-B-GT (U4)

- 10-pin MSOP: outputs CLK0 (→ RF chain), CLK1, CLK2 (→ IO header J3 "CLK1/CLK2").
- I²C address 0x60 (7-bit). SCL/SDA on I2C0.
- Reference: **TCXO Y2, TG2016SMN 25.0000 MHz**, CMOS output into XA through a
  coupling capacitor; XB is left open. Datasheet: with an external clock on XA,
  set the crystal load register (183) to the value for the lowest load /
  "external" setting and treat the reference as 25 MHz. No frequency-correction
  constant is in the vendor firmware; the TCXO's own accuracy (±2 ppm class)
  is what you get. A `radio.correction_ppm` in fox.json can refine it later.
- Frequency plan for 144–148 MHz: PLLA fed by the 25 MHz reference,
  MultiSynth0 as an **even integer divider of 6** (integer mode, MS0_INT),
  so the VCO runs at 864–888 MHz — inside the 600–900 MHz range. Fine
  frequency, and the FM deviation per sample, is set by rewriting the PLLA
  feedback fraction (registers 26–33: `MSNA_P1..P3` from `a + b/c`,
  c = 2^20 − 1) and leaving the output MultiSynth alone. Resolution at the
  output: 25e6 / (2^20 − 1) / 6 ≈ 4 Hz.
- A PLL fraction rewrite is 8 register bytes (one I²C transaction of 10 bytes
  with address + register). At 1 MHz I²C that is ~100 µs, which bounds the
  audio update rate at ~10 kHz; **8 kHz** leaves margin. Writing the feedback
  fraction does not require a PLL reset (reset only after the initial
  configuration or when changing the integer part / output dividers).
- Output enable register 3 (bit = 1 disables) is the carrier on/off; CLK0
  control register 16: PLLA source, MS0 integer mode, drive strength
  **2 mA** (the lowest; higher drive raises harmonic spurs through the
  amplifier and gains little). Power-down the unused outputs' control bits
  (CLK1, CLK2 PDN) unless the IO header is used.

### RF chain after the Si5351

- 3 dB resistive pad (R15 17.4 Ω series, R13/R14 294 Ω shunt), then a 3-element
  LPF (68/75/68 nH, 24/43/43/24 pF — cutoff above 148 MHz, below the 2nd harmonic).
- **BVA1761 (U1)** — amplifier with an integrated digital step attenuator.
  Supply from `SWITCHED_VBATT` through FB3 ("amp tolerates up to 5.5 V; P1dB
  improves with voltage"), digital supply from +3V3. Pins used: `AEN` (enable,
  from GPIO2 via R6), `CLK`/`DATA` shared with the I²C bus, `LE` (GPIO4),
  `P/S` and `A0..A2` strapped on the board (serial mode, address 0). RF in
  `RF1`, RF out `RF3/RF4` with L7 270 nH bias feed, C24 output coupling.
  Rev 2 boards do not have the attenuator (rev detect pins above).
  **Attenuator interface (BVA1761, serial mode):** the datasheet reading this
  was written from describes a word clocked in on `CLK`/`DATA` — attenuation
  code in 0.25 dB steps (0–127 → 0–31.75 dB) with the device address bits —
  latched by a pulse on `LE`. **What the firmware actually sends**
  (`picofox/player.c atten_write`, marked UNVERIFIED in the code): 8 bits,
  MSB first, `code << 1` (D7..D1 = code, D0 = 0), address 0 assumed
  strapped, clocked on the rising edge of CLK with LE low, then an LE pulse.
  Whether that is the datasheet's 16-bit framing or a shorter variant has
  not been checked against the timing diagram, and the dB per step has not
  been measured — the two may be the same question. The I²C peripheral is
  released (pins as plain GPIO) while bit-banging, then re-enabled; SCL is
  held low before SDA moves so the Si5351 does not see an I²C START. The
  write happens on every config reload on a rev 3 board, attenuation 0
  included.
  Amplifier enable polarity: `AEN` active **low** — confirmed on the air with
  the fox-bench firmware (October 2026, rev 3 board).
- Post-amp LPF (same values), then JP1/JP2 jumpers (standalone: both fitted),
  D1 H5VU06B ESD diode, SMA J4.

### Power and USB

- Charger BQ21040, ISET 1 kΩ (≈ 500 mA class), charges only when the switch is
  on (Q1 passes battery to the regulator; the charger's OUT is the battery
  net). `ChgSense` low = charging.
- LDO ME6217C33: 3.3 V for everything digital and the Si5351/TCXO. Battery
  life budget: vendor quotes ~5 h at 100 % duty.
- Mass storage: the 16 MB flash minus the program image is the file system.
  Our firmware keeps the program in the first 1 MB and a FAT file system in
  the remaining space, same split as the vendor's, so a unit can move between
  the two firmwares; neither understands the other's files, and each
  recreates what it needs.

### What this means for the foxlib-c firmware

| foxlib concept | PicoFox implementation |
|---|---|
| key / unkey | Si5351 CLK0 output enable + `AEN`; both change together |
| tone events (Morse, songs, SSTV) | FM: at 8 kHz, deviation = sample × `radio.deviation_hz`, written as a PLLA fraction; pre-emphasis and tone shape applied in firmware |
| retune (plan rotation, QSY) | new PLLA integer+fraction; same divider /6 across the band |
| power high/low, `power_dbm` | attenuator code (rev 3); rev 2 has one level |
| LED patterns | none available (no GPIO LED) — the CDC log carries the status; a header LED is possible later |
| battery telemetry | not available (`ChgSense` only reports charging) |
| bench: key test | yes; rssi: no receiver; batt: reports charging/not |
| files | `fox.json`, `defaults.json`, `images.bin` on the FAT drive; `code.py` has no meaning — the template id is in fox.json |
| banner | same `FOX template=… foxlib=… board=picofox-foxlibc uid=<RP2040 unique id> cfg=… radio=… id=… freq=…` on the CDC port |

## Vendor firmware — what the bench needs to know

Notes from reading the unit's drive and the published firmware
(https://github.com/ai6ym/PicoFox, `PicoFox-Firmware.ino` at 4 commits),
October 2026. The firmware and hardware are **CC BY-NC-SA 4.0**, Giorgi
Enterprises LLC dba AI6YM.radio; fox-bench does not include or modify
any of it — it only writes the files the firmware already reads. Keep it
that way.

### The device

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
  bootloader" button. `pfoxr3-forceformat.uf2` reformats the filesystem **at every boot** — files written to it vanish at the next power cycle (and an empty CALLSIGN means silence); flash `pfoxr3v1.uf2` after it before writing anything.

Switching to fox-bench's own firmware and back is a page operation
(`firmware/foxlib-c/README.md`, "Switching between the two firmwares");
the vendor's `.uf2` is fetched from their GitHub by the browser, never
hosted here.

### Files on the drive

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

### settings.txt

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

### Cycle timing (what the preview must draw)

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
(a 9-character callsign with a `/` suffix, keyed without the slash, 70 % level), 100 % duty.

The firmware's ID generator: dit = 1.2/WPM s, inter-character gap =
3 × 1.2/Farnsworth s, no extra word gap, 1/3-dit raised-cosine-ish ramps,
one dit of silence between elements, leading and trailing inter-character
gaps.

### Audio rendering notes (from the first on-air test)

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

### What fox-bench can and cannot do with it

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
