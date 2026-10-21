# PicoFox hardware — what fox-bench's own firmware is written against

This document is the clean-room boundary for `firmware/foxlib-c/picofox`.
It records the hardware facts taken from the published schematic
(`PicoFox-PCB`, rev 2, 2025-06-09, AI6YM.radio, CC BY-NC-SA 4.0) and from
component datasheets. The vendor's firmware source was read earlier to
understand what the firmware *has to do* (docs/picofox-notes.md); nothing
from it is reproduced here or in our firmware. Credit for the hardware
design belongs to AI6YM.radio.

## Block diagram

```
USB-C ──► BQ21040 charger ──► LiPo (BT2) ──► SW3 (power switch) ──► Q1 P-FET ──► SWITCHED_VBATT
                                                                                   │
                                                                   ME6217C33 LDO ──┴──► +3V3 (RP2040, SI5351, TCXO)
RP2040 ──I2C0──► SI5351A-B-GT (25 MHz TCXO on XA) ──CLK0──► 3 dB pad ──► LPF ──► BVA1761 amp/attenuator ──► LPF ──► SMA J4
        ──GPIO2──────────────────────────────────────────────────────────────────► AEN (amp enable)
        ──GPIO4──────────────────────────────────────────────────────────────────► LE  (attenuator latch)
```

## RP2040 pin map

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

## Si5351A-B-GT (U4)

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

## RF chain after the Si5351

- 3 dB resistive pad (R15 17.4 Ω series, R13/R14 294 Ω shunt), then a 3-element
  LPF (68/75/68 nH, 24/43/43/24 pF — cutoff above 148 MHz, below the 2nd harmonic).
- **BVA1761 (U1)** — amplifier with an integrated digital step attenuator.
  Supply from `SWITCHED_VBATT` through FB3 ("amp tolerates up to 5.5 V; P1dB
  improves with voltage"), digital supply from +3V3. Pins used: `AEN` (enable,
  from GPIO2 via R6), `CLK`/`DATA` shared with the I²C bus, `LE` (GPIO4),
  `P/S` and `A0..A2` strapped on the board (serial mode, address 0). RF in
  `RF1`, RF out `RF3/RF4` with L7 270 nH bias feed, C24 output coupling.
  Rev 2 boards do not have the attenuator (rev detect pins above).
  **Attenuator interface, per the BVA1761 datasheet (serial mode):** a 16-bit
  word clocked in on `CLK`/`DATA`, attenuation code in 0.25 dB steps
  (0–127 → 0–31.75 dB) followed by the device address bits, latched by a
  pulse on `LE`. The I²C peripheral must be released (pins as plain GPIO)
  while bit-banging, then re-enabled; SCL is held low before SDA moves so the
  Si5351 does not see an I²C START. *The bit order and word layout must be
  confirmed against the datasheet before use; this is the one interface we
  have not verified from a primary source.*
  Amplifier enable polarity: `AEN` active **low** per the vendor's observed
  behaviour (carrier appears when GPIO2 is driven low) — confirm on the bench
  with the attenuator at 0 and a power meter before relying on it.
- Post-amp LPF (same values), then JP1/JP2 jumpers (standalone: both fitted),
  D1 H5VU06B ESD diode, SMA J4.

## Power and USB

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

## What this means for the foxlib-c firmware

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
