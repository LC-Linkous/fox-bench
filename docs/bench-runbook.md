# Bench runbook

The one page to have open at the bench. It is the order `tools/bench_queue.py`
prints, with the exact commands, what each one should print, and what to do
when it does not. Everything here is what the catalog claims and has not been
re-run on a board since: the point of the session is to make the rows in
`docs/hardware-log.md` true again.

## Before plugging anything in

```
git pull && python3 tools/bench_queue.py          # the order below, derived from the catalog
pip install pyserial                              # hw_smoke's only dependency
ls /dev/ttyACM*                                   # Linux; on Windows use COMx everywhere below
```

Each CircuitPython run below writes `hw_smoke-<uid>-<time>.json` (the report)
and, with `--record`, a replay fixture. Keep both; the report drives
`tools/session_close.py`, the fixture becomes a CI test. The page version is
the footer of the deployed site (tag first so the row names a release,
not a build; the numbers below are the current ones — `bench_queue.py`
prints them).

## 1. PicoFox re-run (foxlib-c 0.1.11 / page 0.12.0)

This one is from the page, not the script (foxlib-c is compiled firmware).
Board tab → connect over the touch → flash `foxbench-picofox-0.1.11.uf2` from
the site → Behavior tab deploy one template → listen on a handheld. Then write
its row by hand in the 0.1.10 row's shape (`session_close.py` only reads
`hw_smoke` reports). Row date, board `AI6YM PicoFox rev 3`, firmware
`foxlib-c 0.1.11, site build <id from the console>, page 0.12.0`.

## 2. XIAO ESP32-C3 + SA868 re-run (foxlib 1.5.0 / page 0.12.0)

Antenna or dummy load on the SA868 first. Then:

```
python3 tools/hw_smoke.py --port /dev/ttyACM0 --board seeed_xiao_esp32c3 --module sa868_dual \
    --call "W1ABC FOX DE W1ABC" --yes-antenna \
    --record tests/fixtures/bench/c3-sa868-foxlib-1.5.0.json --report c3-sa868.json
```

Expected: seven lines of the table, every `ok`; the FOX banner for each
template within ~3 s of the reboot; the key test audible on the handheld on
the template's default frequency. The script restores whatever `code.py` /
`fox.json` were on the board at the end.

If it stops short:

- **no banner, `boot_log` shows an import error** — foxlib did not land whole.
  Re-run; the write verifies size + CRC32, so a second failure is the board,
  not the transfer. Note it in the row.
- **`radio=…` in the bench actions** — the module is not answering (PD pin,
  TX/RX swap, 9600 baud). Templates still pass; the row's result says
  "module not answering", no status change.
- **replay later says `ReplayError`** — fine, that is what the fixture is for;
  the recording is of what the board did today.

Close it:

```
python3 tools/session_close.py c3-sa868.json --page 0.12.0 --recording tests/fixtures/bench/c3-sa868-foxlib-1.5.0.json
python3 tools/session_close.py c3-sa868.json --page 0.12.0 --recording tests/fixtures/bench/c3-sa868-foxlib-1.5.0.json --apply
python3 tools/bench_queue.py --check && python3 tools/check_catalog.py --since origin/main
```

The dry run first so you can read the row before it is written. Add
`--note "…"` for anything the handheld told you that the script cannot know.
Then `docs/bench-recordings.md`: list the new fixture in the table and drop
`pty-c3-all-fm.json`'s "should replace" note.

## 3. Bare XIAO ESP32-C3 (`esp32c3`, network foxes, first session)

The same board, module unplugged (or a second C3). Two boards on the bench:
the fox on ACM0, the sniffer on ACM1. Put the sniffer on first (its `code.py`
is not a template, so not from the page):

```
python3 -c "from tools.hw_smoke import Repl; r = Repl('/dev/ttyACM1'); r.interrupt(); \
  r.write_file('code.py', open('tools/sniffer/code.py','rb').read()); print(r.reboot_and_capture(until=rb'\"role\":\"sniffer\"'))"
```

Expected: the `{"t":"hello","role":"sniffer",…}` line. If instead the boot log
ends in `AttributeError: … 'Monitor'`, the build on that board has no monitor
mode: the Seeed C3 10.3.1 build does (checked against the build's module
list), so that is an older CircuitPython — reflash it from the page's Board
tab (10.3.1) and try again. `ImportError: wifi` is the same answer.

Then the fox:

```
python3 tools/hw_smoke.py --port /dev/ttyACM0 --sniffer /dev/ttyACM1 --board esp32c3 \
    --call "W1ABC FOX DE W1ABC" --yes-antenna --templates wifi-beacon,wifi-probe,ble-beacon,puzzle-beacon \
    --record tests/fixtures/bench/c3-net-foxlib-1.5.0.json --report c3-net.json
```

Expected per template: banner, then for `wifi-probe` a line like
`sniffer: N probe(s) from f2:b0:…, N with SSID 'W1ABC FOX DE W1ABC', M from others`.
`wifi-beacon` you check on a phone's Wi-Fi list; `ble-beacon` with nRF
Connect. The C3 has no LED, so "stays dark" is right.

- **`no probe request from the fox … reached the sniffer`** — before blaming
  the fox, hold a phone's Wi-Fi settings page open next to the sniffer: its
  own probes should show up as `others`. None at all → the sniffer is not
  hearing anything (monitor mode returns packets but the parse rejects them —
  frames with FCS shift nothing, but a radiotap-like prefix would; paste one
  `RAW` line into `firmware/sim/test_sniffer_parse.py`). Phone seen, fox not →
  the fox's probes are not going out; that is a real finding for the row.
- **`ble-beacon` fails to import** — the C3 build may lack `_bleio`; the
  template's `boards_tested` stays as is, the row says so.

Close it the same way (`session_close.py c3-net.json --page 0.12.0 …`). The
script will offer `esp32c3 experimental -> stable`; the rule in
`docs/network-fox-bench.md` is a clean row for every variant, and the C3 has
one, so if all four passed, flip it in `boards/esp32c3.json` and add a
CHANGELOG line. Then `wifi-probe` needs a note in `docs/bench-recordings.md`:
replaying a sniffer run needs `firmware/sim/pty_sniffer.py` on the second pty.

## 4 onward: C6 ×2, S3, C5 pair, nRF52840

Same shape as 3 with `--board esp32c6` etc. and `--variant` where the chip
has several boards (`--variant dfrobot_firebeetle2_esp32c5`). The per-board
gotchas (inverted LED on the C6, DevKit pin names on the C5, `bossac` for the
Nano 33) are in `docs/network-fox-bench.md` under *Per-board notes*. A chip
target flips to stable only when every variant has its row.

## When the bench is packed up

1. `git status` — the reports and recordings; commit the fixtures under
   `tests/fixtures/bench/`, not the reports (they carry the uid).
2. `python3 tools/replay_check.py` so CI replays what you recorded.
3. `python3 tools/check_docs.py && python3 tools/bench_queue.py --check`.
4. Bump `VERSION` in `js/main.js` by hand if a template's `boards_tested`
   changed (the Behavior tab reads it) and add the CHANGELOG line; the
   version lint does not watch `firmware/templates/`, so it will not remind
   you.
