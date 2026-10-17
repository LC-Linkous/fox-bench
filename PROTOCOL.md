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

## Files (js/device/repl-device.js)

- **list**: `os.listdir` + `os.stat` per entry, printed `name size d|f`.
- **read**: `open(p,'rb')` read in 512-byte blocks, printed as hex; `__MISSING__` on OSError.
- **write**: `f=open(p,'wb')`, then `f.write(b'…')` with a Python bytes
  literal per 384-byte chunk, then `f.close()` and `os.stat(p)[6]` which
  must equal the byte count or the write is reported as failed.
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
