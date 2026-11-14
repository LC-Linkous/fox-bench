# flasher/ — CircuitPython flashing for fox-bench

A self-contained component that puts a CircuitPython `.bin` onto an ESP32
family board from the browser over Web Serial. It is **licensed separately
from the rest of fox-bench, under the Apache License 2.0** (`LICENSE`,
`NOTICE`), because it bundles Espressif's esptool-js, which is Apache-2.0
and cannot be shipped inside a GPL-2.0-only tree. The page loads it as an
ES module; nothing in here depends on anything outside this directory.

| | |
|---|---|
| `flasher.js` | the API: `setImage()`, `flash()`, `parseBinName()`, `chipId()`, `loadEsptool()`, `demoEsptool()` |
| `md5.js` | MD5 for esptool-js's image verification |
| `vendor/esptool-js/` | the upstream bundle, unmodified, with its licence and version |

## API

```js
import * as flasher from './flasher/flasher.js';
flasher.setImage(fileName, uint8array);              // the image to write
const facts = await flasher.flash({
  offset: 0x0, eraseAll: true, baud: 460800,
  expectChip: '',            // e.g. 'esp32c5': refuse to write when the chip reports another family (the compiled family's safety check)
  port: null, impl: null,    // an already granted SerialPort instead of the chooser; a stand-in esptool (demoEsptool())
  onPhase: text => {}, onProgress: fraction => {}, onLog: line => {},
});
// facts: { chip, revision, features, crystal, mac, flash_size, erase_ok, flash_ok, seconds }
```

`flash()` asks the browser for a port (`navigator.serial.requestPort()`,
unless `port` is given), connects with esptool-js, runs the stub, checks
the detected chip against `expectChip` when set (`chipId()` maps the
reported name to a family: `esp32`, `esp32c3`, …), optionally erases the
whole flash, writes the image at `offset` with MD5 verification,
hard-resets, and closes the port. Errors carry the facts gathered so far
in `e.facts`. `loadEsptool()` loads the vendored bundle and falls back to
the pinned jsDelivr copy only if the local one fails; `esptoolSource` says
which loaded.
`demoEsptool()` returns a simulated esptool with the same surface so the
flow can run without hardware.

## Updating esptool-js

```
npm pack esptool-js@<version>
tar xzf esptool-js-<version>.tgz
cp package/bundle.js vendor/esptool-js/bundle.js
cp package/LICENSE  vendor/esptool-js/LICENSE
echo <version> > vendor/esptool-js/VERSION
```

`flasher.js` reads the version from `VERSION` for display. The bundle is
imported from this directory first; if that fails (a deployment that left
the directory out) it falls back to the same version on jsDelivr.
