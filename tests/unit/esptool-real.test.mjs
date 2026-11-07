// esptool-real.test.mjs — the vendored esptool-js itself, driven through flasher.flash() against a fake ESP32-C3
// ROM on a fake Web Serial port (fake-rom-port.mjs). The other flasher tests use demoEsptool(), a stand-in; this
// one loads flasher/vendor/esptool-js/bundle.js, so a vendor bump that changes the API the wrapper relies on, or
// the reset strategy it picks for a native-USB chip, fails here instead of on the bench.
//
// Two fakes. The ROM-only one reaches port open, the reset sequence, SYNC, GET_SECURITY_INFO, chip identification,
// eFuse reads (MAC, revision, features), CHANGE_BAUD and the port reopen, then refuses the stub upload — so the
// wrapper's failure path is asserted from there. The stub-mode one (`stub: true`) also plays the flasher stub:
// erase, the compressed write (inflated into an in-memory flash) and SPI_FLASH_MD5 over it, so esptool-js's own
// MD5 verification runs for real — a byte-exact write passes it and a corrupted one fails it. What stays
// bench-only is the physical side: USB enumeration, the real reset timing, the chip's actual flash.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as flasher from '../../flasher/flasher.js';
import { FakeRomPort } from './fake-rom-port.mjs';

const lib = await import('../../flasher/vendor/esptool-js/bundle.js');
const quiet = () => {};

test('the vendored bundle exports what the wrapper uses', () => {
  for (const k of ['Transport', 'ESPLoader']) assert.equal(typeof lib[k], 'function', k);
  assert.ok(lib.ESPRESSIF_VID && lib.USB_JTAG_SERIAL_PID, 'vendor and USB-JTAG product ids are exported');
});

test('real esptool-js against a fake C3 ROM: sync, identify, read eFuses, change baud — then the stub upload is refused and the facts say so', async () => {
  flasher.setImage('adafruit-circuitpython-seeed_xiao_esp32c3-en_US-10.3.1.bin', new Uint8Array(4096));
  const port = new FakeRomPort({ chip: 'esp32c3' });
  const phases = [], log = [];
  let err;
  try { await flasher.flash({ offset: 0, expectChip: 'esp32c3', impl: lib, port, onPhase: p => phases.push(p), onLog: l => log.push(l), onProgress: quiet }); }
  catch (e) { err = e; }
  assert.ok(err, 'the fake ROM has no stub, so the flash must fail at the upload');
  assert.ok(err.facts, 'the error carries the facts gathered before the failure');
  assert.equal(err.facts.chip.split(' (')[0], 'ESP32-C3', JSON.stringify(err.facts));
  assert.equal(err.facts.mac, '7c:9e:bd:a1:0f:20');
  assert.match(err.facts.features, /Wi-Fi/);
  assert.equal(err.facts.crystal, '40MHz');
  assert.ok(err.facts.erase_ok === '' || err.facts.erase_ok === 'no', 'the erase was refused by the fake, so nothing was erased: ' + err.facts.erase_ok);
  assert.equal(err.facts.flash_ok, 'no');
  assert.ok(port.refused, 'the fake refused the first command past identification (stub upload or erase): 0x' + (port.refused || 0).toString(16));
  // the wire: a SYNC burst, the security-info query, then eFuse reads; no erase (ERASE_FLASH 0xd0) ever sent
  const names = port.commands.map(c => c.name);
  assert.equal(names[0], 'SYNC');
  assert.ok(names.includes('GET_SECURITY_INFO') && names.includes('READ_REG'), names.join(' '));
  assert.ok(!names.includes('FLASH_BEGIN'), 'no write command reached the port');
  // the port was reopened at the working baud rate after CHANGE_BAUD
  assert.deepEqual(port.baudRates.slice(0, 2), [115200, 460800]);
  assert.ok(phases.some(p => /connecting/.test(p)), phases.join(' | '));
  assert.ok(log.some(l => /Chip is ESP32-C3/.test(l)), log.join(' | '));
});

test('a native-USB ESP32-C3 (Espressif VID, USB-JTAG PID) gets the USB-JTAG reset, not a DTR/RTS classic reset', async () => {
  flasher.setImage('x.bin', new Uint8Array(1024));
  const port = new FakeRomPort({ usbVendorId: lib.ESPRESSIF_VID, usbProductId: lib.USB_JTAG_SERIAL_PID });
  try { await flasher.flash({ offset: 0, impl: lib, port, onLog: quiet, onPhase: quiet, onProgress: quiet }); } catch {}
  // The USB-JTAG sequence (esptool reset.ts UsbJtagSerialReset): RTS=0,DTR=0 · DTR=1,RTS=0 · RTS=1,DTR=0 · RTS=0,DTR=0
  // The classic one would drive DTR high first with RTS high (EN low) and wait 100 ms+.
  const sig = port.signals.map(s => `${'requestToSend' in s ? 'R' + +s.requestToSend : ''}${'dataTerminalReady' in s ? 'D' + +s.dataTerminalReady : ''}`).join(' ');
  assert.match(sig, /^R0 D0 D0 D1 R0 D1 R1 D1 D0 R1 D0 R0 D0 D0/, 'USB-JTAG reset shape, got: ' + sig);
  assert.ok(port.signals.length >= 10, 'the reset actually toggled the lines');
});

test('a UART-bridge port (a CP2102, not Espressif\'s own USB) gets the classic DTR/RTS reset with its 100 ms hold', async () => {
  flasher.setImage('x.bin', new Uint8Array(1024));
  const port = new FakeRomPort({ usbVendorId: 0x10c4, usbProductId: 0xea60 });
  try { await flasher.flash({ offset: 0, impl: lib, port, onLog: quiet, onPhase: quiet, onProgress: quiet }); } catch {}
  const first = port.signals.slice(0, 4);
  // ClassicReset: DTR=0,RTS=1 (EN low, IO0 high) → wait ≥100 ms → DTR=1,RTS=0 (IO0 low, EN high) → wait 50 ms → DTR=0
  assert.ok(first.some(s => s.requestToSend === true) && first.some(s => s.dataTerminalReady === true), JSON.stringify(first));
  const tEnLow = port.signals.find(s => s.requestToSend === true)?.t, tEnHigh = port.signals.find(s => s.requestToSend === false && s.t > tEnLow)?.t;
  assert.ok(tEnHigh - tEnLow >= 90, `EN held low ≥100 ms (got ${tEnHigh - tEnLow} ms)`);
});

test('the wrong chip on the port is refused by the wrapper before anything is erased, with the real detector', async () => {
  flasher.setImage('adafruit-circuitpython-seeed_xiao_esp32s3-en_US-10.3.1.bin', new Uint8Array(1024));
  const port = new FakeRomPort({ chip: 'esp32c3' });
  await assert.rejects(
    flasher.flash({ offset: 0, expectChip: 'esp32s3', impl: lib, port, onLog: quiet, onPhase: quiet, onProgress: quiet }),
    e => /port belongs to an ESP32-C3.*ESP32-S3/.test(e.message) && e.facts.erase_ok === '' && e.facts.flash_ok === 'no');
  assert.ok(!port.commands.some(c => c.name === '0xd0'), 'no erase command reached the port');
});

test('a board that never answers SYNC (not in download mode) surfaces as "Failed to connect", with the port closed again', async () => {
  flasher.setImage('x.bin', new Uint8Array(1024));
  const port = new FakeRomPort({ answerSync: false });
  await assert.rejects(flasher.flash({ offset: 0, impl: lib, port, onLog: quiet, onPhase: quiet, onProgress: quiet }), /Failed to connect/);
  assert.ok(port.commands.filter(c => c.name === 'SYNC').length >= 5, 'it kept trying');
  assert.equal(port.closed, true, 'the wrapper disconnected the transport in finally');
});

test('a whole flash through the real esptool-js: erase, compressed write, its MD5 check against what landed in flash, reset', async () => {
  const img = new Uint8Array(70000); for (let i = 0; i < img.length; i++) img[i] = (i * 7 + 3) & 0xff; img[0] = 0xe9;   // ESP image magic
  flasher.setImage('adafruit-circuitpython-seeed_xiao_esp32c3-en_US-10.3.1.bin', img);
  const port = new FakeRomPort({ chip: 'esp32c3', stub: true });
  const phases = [], log = []; let progress = 0;
  const facts = await flasher.flash({ offset: 0, expectChip: 'esp32c3', impl: lib, port, onPhase: p => phases.push(p), onLog: l => log.push(l), onProgress: f => { progress = f; } });
  assert.equal(facts.erase_ok, 'yes'); assert.equal(facts.flash_ok, 'yes');
  assert.equal(port.erased, true, 'the chip erase came first');
  assert.deepEqual(port.lastWrite, { address: 0, length: img.length });
  assert.equal(progress, 1);
  // what landed in flash is the image (past the 16-byte header esptool-js may rewrite with flash mode/size)
  const w = port.flashImage(0, img.length);
  for (let i = 16; i < img.length; i++) if (w[i] !== img[i]) assert.fail(`flash differs from the image at byte ${i}`);
  assert.ok(log.some(l => /Hash of data verified/.test(l)), 'esptool-js verified its MD5 against the flash: ' + log.filter(l => /Hash|MD5/.test(l)).join(' | '));
  assert.ok(log.some(l => /Hard resetting/.test(l)));
  assert.ok(phases.some(p => /erasing whole flash/.test(p)) && phases.some(p => /writing .*68 kB.*0x0/.test(p)) && phases.some(p => /resetting/.test(p)), phases.join(' | '));
  const names = port.commands.map(c => c.name);
  assert.ok(names.indexOf('ERASE_FLASH') < names.indexOf('FLASH_DEFL_BEGIN'), 'erase before write');
  assert.ok(names.includes('SPI_FLASH_MD5'), 'the MD5 was asked of the flash');
});

test('a write that lands corrupted is caught by esptool-js\'s MD5 check; the wrapper reports flash_ok no', async () => {
  const img = new Uint8Array(20000).fill(0x5a); img[0] = 0xe9;
  flasher.setImage('x.bin', img);
  const port = new FakeRomPort({ stub: true });
  const set = port.flash.set.bind(port.flash);
  port.flash.set = (a, o) => { const b = Uint8Array.from(a); b[100] ^= 0xff; set(b, o); };   // one bit wrong in flash
  await assert.rejects(flasher.flash({ offset: 0, impl: lib, port, onLog: quiet, onPhase: quiet, onProgress: quiet }),
    e => /MD5 of file does not match/.test(e.message) && e.facts.erase_ok === 'yes' && e.facts.flash_ok === 'no');
});

test('the write address follows the offset through the real stub protocol (a classic-ESP32 image at 0x1000)', async () => {
  const img = new Uint8Array(8192).fill(1); img[0] = 0xe9;
  flasher.setImage('x.bin', img);
  const port = new FakeRomPort({ stub: true });
  const facts = await flasher.flash({ offset: 0x1000, impl: lib, port, onLog: quiet, onPhase: quiet, onProgress: quiet });
  assert.equal(facts.flash_ok, 'yes');
  assert.deepEqual(port.lastWrite, { address: 0x1000, length: 8192 });
  assert.equal(port.flashImage(0, 0x1000).every(b => b === 0xff), true, 'nothing below the offset was written');
});

test('eraseAll: false skips the chip erase on the real protocol', async () => {
  flasher.setImage('x.bin', new Uint8Array(4096).fill(2));
  const port = new FakeRomPort({ stub: true });
  const facts = await flasher.flash({ offset: 0, eraseAll: false, impl: lib, port, onLog: quiet, onPhase: quiet, onProgress: quiet });
  assert.equal(facts.erase_ok, 'skipped'); assert.equal(port.erased, false);
  assert.ok(!port.commands.some(c => c.name === 'ERASE_FLASH'));
});
