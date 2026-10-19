# First hardware session with a board, module or CircuitPython build

The simulator and the page tests prove the code; this is the list for the
thing they cannot prove. Run it the first time a new board family, a new
radio module, a new carrier PCB or a new CircuitPython release crosses the
bench, and again before relying on a changed `foxlib`. It takes about
twenty minutes with the fox on a dummy load.

Everything here is also what `tools/hw_smoke.py` does automatically for
the templates; the manual steps are the ones that need eyes, ears or a
receiver.

## Before plugging in

- [ ] Antenna or dummy load on the module's RF connector. The fox keys
      within seconds of every reboot.
- [ ] Battery disconnected or known-charged; USB only for the session.
- [ ] Note the board, module, carrier revision and CircuitPython build
      (`os.uname().version`) in the fleet notes or the hardware report.
- [ ] Browser is Chrome or Edge on a laptop; the page is the current
      deploy (version in the top bar matches the repo tag you mean to test).

## Bare board → CircuitPython

- [ ] Bootloader entry works as the Board tab describes it (hold B, plug in).
- [ ] Flash the CircuitPython `.bin` for this board id; the board re-enumerates
      as a serial port (no CIRCUITPY drive on the C3; one on most others).
- [ ] **Connect** finds a prompt without a reset. If it needs the R button
      first, say so in the hardware report; that is a timing difference
      worth knowing per board.
- [ ] Connect tab shows the right board id, a UID, the CircuitPython
      version and "no fox firmware".

## First deploy (morse-songs, default frequency, real callsign)

- [ ] Deploy writes foxlib and the three files; every write logs a CRC.
- [ ] Banner: `cfg=ok radio=ok id=set`, and `freq=` is what the plan said.
      `radio=noreply` means the module did not answer on the UART: check
      PD is high, TX/RX not swapped, 9600 baud, module powered.
- [ ] Transmission audible on a handheld on the frequency: ID in Morse,
      then the song; no transmission between cycles.
- [ ] LED pattern matches what the About tab lists for a normal cycle.
- [ ] **Listen only** on a second tab/reconnect shows the fox's own output
      without stopping it; **Re-read board** stops it and reads the files;
      **Restart fox** brings the banner back.

## Bench tab

- [ ] Probe reports the band the module is fitted for, and only that band.
- [ ] RSSI reads with the handheld transmitting nearby, and drops when it stops.
- [ ] Battery reads within 0.05 V of a meter across the pack, with the
      divider the Board tab describes. If not: `battery.calibration`.
- [ ] Key test, 3 s: the handheld hears carrier; nothing after it ends.
      The first bench action after a reboot is slow (foxlib compiles) — note
      how slow; `hw_smoke.py` records it as `import_s`.

## Measurements (one template is enough; put numbers in the hardware report)

- [ ] Output power on low and high into the dummy load, in dBm. Enter the
      measured value on the Radio tab so profiles carry it.
- [ ] Peak deviation on a tone, in kHz. Set it on the Payload tab's
      spectrum panel so the occupied-bandwidth estimate matches reality.
- [ ] Current draw idle / keyed, for the battery-life note.
- [ ] Nothing audible on the adjacent channel with the handheld's squelch
      at the usual setting.

## Every other template, briefly

`python3 tools/hw_smoke.py --port … --call "…" --yes-antenna` does this:
each template deployed, banner read, a few seconds observed, probe/RSSI/
battery/key run on a fresh VM, memory and import time recorded, and the
previous files put back. Keep the JSON report next to the hardware report;
diff it against the last one the next time anything changes.

- [ ] All templates `ok` in the summary table.
- [ ] `free B` is not alarmingly low (under ~20 kB on a C3 means a future
      foxlib change could fail to import).
- [ ] SSTV: a decoder (phone app is fine) shows the test card from the
      handheld's speaker.
- [ ] QRSS: a single dit is the configured seconds long and the module
      stays keyed for all of it.
- [ ] Rotator: the handheld needs retuning after each cycle; with
      `announce_qsy` the next frequency is sent before the move.
- [ ] Popcorn / resurrection: the Schedule tab's timeline matches what the
      fox does for the first few events with the same seed.

## Afterwards

- [ ] Add the board id to `boards_tested` in each `template.json` that
      passed (the catalog lint checks the id exists).
- [ ] If the board is new: its descriptor in `boards/`, its row in
      `boards/index.json`, a defaults file per template, and the silkscreen
      note for the Board tab if the pin names differ from the printed ones.
- [ ] File a hardware report issue with the measurements, or add them to
      the module descriptor if they belong there (nominal power).
- [ ] Fleet log CSV downloaded; the UID will be the key for this board forever.
