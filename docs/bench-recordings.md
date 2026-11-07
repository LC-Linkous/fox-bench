# Bench recordings

A bench run on a real board, saved so it can be repeated without one.

```
python3 tools/hw_smoke.py --port /dev/ttyACM0 --call "W1ABC FOX DE W1ABC" --yes-antenna --record bench.json
python3 tools/replay_check.py bench.json
```

`--record` writes every REPL exchange of the run to a JSON file: each
raw-mode command and the board's reply, each soft reboot and the boot text
up to the banner, and what the fox printed while the script listened. The
file also carries the board id, uid, CircuitPython and foxlib versions, and
the arguments the run was made with.

`firmware/sim/pty_board.py --replay bench.json` is the pty board answering
from that file instead of running code: a command is looked up by its
text and gets the recorded reply, a soft reboot gets the recorded boot
text. Timing and chunking do not matter; only the text does. A command the
recording never saw gets a `ReplayError` reply naming it, so a changed
`hw_smoke.py` fails loudly instead of hanging.

`tools/replay_check.py` ties the two together — starts the replay board,
runs `hw_smoke.py` with the recorded arguments, and exits 1 unless every
template passed, every command was found, and the uid matches. CI runs it
on every file under `tests/fixtures/bench/`.

## What a recording is for

- **A board you no longer have on the desk.** The first session with a
  new board records; from then on the run is a CI test of the script and
  the catalog against that board's actual replies.
- **A bench finding.** When a session finds a bug (2026-10-25: two of
  them), the recording of the failing run, committed before the fix, is
  the regression test; after the fix it is re-recorded.
- **A change to `hw_smoke.py`.** Replay all recordings: a miss shows which
  command changed.

## What it is not

The board's replies are fixed text. A replay cannot find a firmware bug —
it finds script and catalog regressions against replies a real board once
gave. Nor does it cover the serial layer's timing (partial reads, the
swallowed first Ctrl-C), which `tests/unit/repl-link.test.mjs` covers for
the page and the live pty board covers for the script.

## Files

| | |
|---|---|
| `tests/fixtures/bench/pty-c3-all-fm.json` | all seven FM templates against the pty board itself (so CI has one from day one; a real-board recording should replace it after the first session) |

Name real-board recordings `<board>-<what>-<date>.json`, e.g.
`seeed_xiao_esp32c3-all-fm-2026-11-12.json`, and say in
`docs/hardware-log.md` which recording a row produced.
