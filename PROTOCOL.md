# PROTOCOL.md — how the page talks to the board

Transport: Web Serial, 115200 8N1 (the ESP32-C3's USB-JTAG/serial CDC
ignores the baud rate). No USB vendor filter: the chooser shows every port.

## Raw REPL (js/device/repl-link.js)

| step | page sends | expects |
|---|---|---|
| interrupt | `\r\x03\x03` (up to 3×, with `\r` and `\x02` fallbacks) | `>>> ` |
| enter raw | `\r\x01` | `raw REPL; CTRL-B to exit\r\n>` |
| exec | code in 128-byte chunks, 8 ms apart, then `\x04` | `OK` · stdout · `\x04` · stderr · `\x04` · `>` |
| exit raw | `\r\x02` | `>>> ` |
| soft reboot | `\x04` at the friendly prompt | boot output until a line starting `FOX ` (15 s max) |

A non-empty stderr is raised as an error unless the call is marked soft.

Bytes that arrive while no operation is in progress are the fox's own
output (it prints while it runs) and go to the console as *unsolicited*
text. Bytes that arrive *between two waits of one operation* — the board
answering faster than the page gets to its next wait — are kept for that
wait; they are never treated as fox output. Waits are registered before
the bytes that provoke them are sent, for the same reason. During a soft
reboot everything is collected as the boot log.

The protocol layer is tested without hardware against a fake board
(`tests/unit/fake-board.mjs`) that reproduces the quirks seen on real
XIAO ESP32-C3s: a transmitting fox that swallows the first Ctrl-C, ANSI
clear-line and title-bar sequences, output split into small USB packets,
a dropped final prompt, a slow first `import foxlib`.

## Files (js/device/repl-device.js)

- **list**: `os.listdir` + `os.stat` per entry, printed `name size d|f`.
- **read**: `open(p,'rb')` read in 512-byte blocks, printed as hex; `__MISSING__` on OSError.
- **write**: `f=open(p,'wb')`, then `f.write(b'…')` with a Python bytes
  literal per 384-byte chunk, then `f.close()`, then **verify**: the board
  prints `os.stat(p)[6]` and `binascii.crc32` of the file (read back in
  512-byte pieces, so no RAM is needed for large files). Size and CRC must
  both match what was sent or the write is reported as failed. A size
  mismatch is a truncated write; a CRC mismatch with the right size is a
  corrupted one (bad USB, failing flash).
- **mkdir/remove**: `os.mkdir` / `os.remove`, OSError ignored.

CircuitPython's REPL can write the filesystem only when no host has the
USB drive mounted. On the XIAO ESP32-C3 there is no drive, so this always
works. Boards that mount `CIRCUITPY` need `fs-drive.js` (File System
Access API), declared in DESIGN.md and not yet implemented.

## Identity

```
import board, microcontroller, os
print(board.board_id)
print(''.join('%02x' % b for b in microcontroller.cpu.uid))
print(open('foxlib/VERSION').read().strip())     # '' if missing
print(os.uname().release)
```

## Bench (after interrupt)

CircuitPython starts a fresh VM for the REPL, so `code.py`'s objects are
gone. Bench actions build a new `foxlib.Fox('fox.json', defaults='defaults.json', quiet=True)`
and call `fox.radio.probe(...)`, `fox.radio.key(n)`, `fox.radio.rssi()`,
`fox.batt.read()`. `quiet=True` suppresses the banner and never keys PTT.

## Boot banner

See CONFIG.md. The page parses the first line matching `^FOX ` into
`key=value` pairs; parenthesised values (`cfg=partial(a,b)`) are kept whole.

## foxlib-c console (fox-bench's native firmware, e.g. the PicoFox)

Boards of the `foxlib-c` family have no REPL. The page configures them by
writing `fox.json` and `defaults.json` to their `FOXBENCH` USB drive
(`js/device/drive-device.js`, every write read back); the firmware reloads
about 1.5 s after the host's last write. Their USB serial port is a plain
text console (115200, rate ignored):

- The `FOX …` banner (same fields as foxlib's, `foxlib=c-<version>`,
  `board=picofox-foxlibc`, `uid=` the RP2040 unique id) is printed at boot,
  whenever a terminal opens the port, and after every reload, followed by
  the `cfg:` notes and the fox log (`cycle N @ f`, `morse: …`, `song: …`).
  **Listen only** parses it like any other banner.
- Commands are lines; every command is answered with `ok` or `err: …`:
  `help`, `status`, `key <s>`, `tone <hz> <s>`, `id`, `freq <mhz>`,
  `atten <0-127>`, `batt`, `files`, `reload`, `stop`, `uid`, `version`,
  `reboot`, `bootsel` (jump to the UF2 bootloader). Ctrl-C stops a bench
  action. A bench action pauses the cycle and the cycle resumes a second
  after it ends. The console drawer sends what you type as such a line
  when a foxlib-c board is selected.
