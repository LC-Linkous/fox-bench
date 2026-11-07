# tools/sniffer — a probe-request sniffer on a second board

The `wifi-probe` fox is a station that keeps probing for a network that
does not exist. Its probe requests carry the SSID and the spoofed MAC — and
nothing a phone shows will tell you they went out. This is the receiver: a
second XIAO ESP32-C3 (or C6) running `code.py` here, printing one line of
JSON per probe request it hears.

```
{"t":"hello","role":"sniffer","proto":1,"channels":[1,6,11]}
{"t":"probe","mac":"f2:b0:00:00:00:05","ssid":"W1ABC FOX DE W1ABC","rssi":-48,"ch":6,"ms":12345}
{"t":"idle","ms":15345}
```

`mac` is the sender (addr2), lower-case; `ssid` the SSID information
element (empty for a wildcard probe, hex if it is not UTF-8); `rssi` in dBm;
`ch` the channel the monitor was on. It hops 1 / 6 / 11, half a second each.

## Putting it on the board

It is a different `code.py` from the fox's, so the page's Deploy is not
the tool. Either:

- **Thonny**: Tools → Options → Interpreter → *CircuitPython (generic)*,
  pick the sniffer board's port, open `tools/sniffer/code.py`, File → Save
  as… → *CircuitPython device* → `code.py`.
- **From the bench script's REPL helper**, in Python:
  `from tools.hw_smoke import Repl; r = Repl('/dev/ttyACM1'); r.interrupt(); r.write_file('code.py', open('tools/sniffer/code.py','rb').read()); r.reboot_and_capture(until=rb'"role":"sniffer"')`

The board needs no foxlib and no `fox.json`. Any CircuitPython build for
the ESP32 family with `wifi.Monitor` (8.1 and later) will do; the one the
fox runs is fine.

## Using it

```
python3 tools/hw_smoke.py --port /dev/ttyACM0 --sniffer /dev/ttyACM1 --board esp32c3 --call "W1ABC FOX DE W1ABC" --yes-antenna --templates wifi-probe
```

While the fox runs its observe window, the script reads the sniffer and
reports `N probe(s) from <fox MAC>, N with SSID <callsign>, N from others`.
`wifi-probe` passes only if at least one probe from the fox's MAC carried
the SSID. The counts go in the JSON report under `templates.wifi-probe.sniffer`.
Without `--sniffer` the report says `"sniffer": "not used"` and the
template is judged by its banner alone, as before.

By hand: `screen /dev/ttyACM1 115200` and watch for the fox's MAC with
the callsign as SSID, once per cycle.

## Without a board

`python3 firmware/sim/pty_sniffer.py --mac F2:B0:00:00:00:05 --ssid "W1ABC FOX DE W1ABC"`
prints a port that emits synthetic probe lines; CI runs `hw_smoke.py
--sniffer` against it, and against one for a different MAC to check that
a silent sniffer fails the template. `firmware/sim/test_sniffer_parse.py`
tests the 802.11 parser in `code.py` on hand-built frames.

## What is parsed

Only what the check needs: frame control type 0 subtype 4 (probe request),
addr2 (the station's MAC), and the SSID information element (tag 0) found
by walking the IEs. The layout is in comments at the top of `code.py`.
The `wifi.Monitor` API (`channel=`, `.packet()` → `Packet.RAW / RSSI / CH`)
is CircuitPython's documented one for the ESP32 family; it has not yet
been run on a board here — the first session with two C3s is where that
gets a hardware-log row.
