# Proposal to kitsune: Seeed XIAO ESP32C6 support

Text to offer the kitsune project (https://github.com/rfhs/kitsune) once a
C6 has run their Wi-Fi fox from fox-bench's build. Their README: "We will
accept PRs to extend support to other platformio supported hardware."
Nothing here is applied to their tree by fox-bench; it is the proposed
change, kept with the evidence that it works.

## What the board brings

ESP32-C6: Wi-Fi 2.4 GHz, BLE, **802.15.4** — so the Wi-Fi AP/client and
the Zigbee coordinator challenges, and a second 802.15.4 board to pair with
the XIAO ESP32C5. Native USB (the serial console drops during sleep, like
the C5). Yellow user LED on GPIO 15, active low — a single LED like the C5's,
so the C5's LED treatment applies. Needs the pioarduino platform fork, as
their C5 does.

## The change (two files)

Their LED macro header (`rfhsledmacros.h` under their `include` directory) — the C6 is a single active-low LED like the C5:

```c
 #elif defined(ARDUINO_XIAO_ESP32C5)
 #define DATA_PIN 27
+#elif defined(ARDUINO_XIAO_ESP32C6)
+#define DATA_PIN 15
 #endif
```

and in `ledcolor()`:

```c
-#elif defined(ARDUINO_XIAO_ESP32C5)
+#elif defined(ARDUINO_XIAO_ESP32C5) || defined(ARDUINO_XIAO_ESP32C6)
   // ON when any color except red, OFF when red
```

(`rfhsledinit()` has the matching `#if` for the single-LED boards; the
same `|| defined(ARDUINO_XIAO_ESP32C6)` there.)

Their Wi-Fi project's `platformio.ini` — a board section and four envs, in
the shape of the C5's:

```ini
[seeed-xiao-esp32c6]
board = seeed_xiao_esp32c6
; using the fork from pioarduino
platform = https://github.com/pioarduino/platform-espressif32/releases/download/stable/platform-espressif32.zip
board_flags = -DARDUINO_USB_CDC_ON_BOOT=1

[env:seeed-xiao-esp32c6-easy-ap]
extends = seeed-xiao-esp32c6
build_flags = ${difficulty.easy} ${mode.ap} ${seeed-xiao-esp32c6.board_flags}
[env:seeed-xiao-esp32c6-easy-client]
extends = seeed-xiao-esp32c6
build_flags = ${difficulty.easy} ${mode.client} ${seeed-xiao-esp32c6.board_flags}
[env:seeed-xiao-esp32c6-hard-ap]
extends = seeed-xiao-esp32c6
build_flags = ${difficulty.hard} ${mode.ap} ${seeed-xiao-esp32c6.board_flags}
[env:seeed-xiao-esp32c6-hard-client]
extends = seeed-xiao-esp32c6
build_flags = ${difficulty.hard} ${mode.client} ${seeed-xiao-esp32c6.board_flags}
```

The Zigbee coordinator project would take the same board section with its
two coordinator envs, once a C6 coordinator has been seen on the air. The
README's support table gains a row: `Seeed XIAO ESP32C6 | ❌ | ❌ | ✅ | ✅ | (✅)`
with "Serial console during sleep: ❌".

## Evidence to attach

The hardware-log row from `docs/hardware-log.md` for the C6: kitsune
commit, what the serial showed, the SSID seen, sleep/wake timing — and the
note that fox-bench's interim build passed `-DDATA_PIN=15` because the LED
header did not know the board, which is exactly what the first hunk fixes.

## Not in the proposal

Anything about fox-bench: the proposal is a board, not a tool. If they ask
how it was built and tested, the answer is PlatformIO on their tree at
commit `<sha>`, with a bench conference header; the page is a separate
conversation.
