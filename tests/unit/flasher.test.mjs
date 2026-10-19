// flasher.test.mjs — md5, image-name parsing, and the flash flow against the demo esptool.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5 } from '../../flasher/md5.js';
import * as flasher from '../../flasher/flasher.js';

test('md5 matches RFC 1321 vectors and handles odd lengths', () => {
  const e = new TextEncoder();
  assert.equal(md5(new Uint8Array(0)), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5(e.encode('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5(e.encode('message digest')), 'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(md5(e.encode('12345678901234567890123456789012345678901234567890123456789012345678901234567890')), '57edf4a22be3c955ac49da2e2107b67a');
  assert.equal(md5(new Uint8Array(55).fill(0x61)), 'ef1772b6dff9a122358552954ad0df65');   // 55 bytes: padding straddles the block
});

test('parseBinName reads the CircuitPython download file name', () => {
  assert.deepEqual(flasher.parseBinName('adafruit-circuitpython-seeed_xiao_esp32c3-en_US-10.2.1.bin'), { boardId: 'seeed_xiao_esp32c3', lang: 'en_US', version: '10.2.1' });
  assert.deepEqual(flasher.parseBinName('adafruit-circuitpython-raspberry_pi_pico-fr-9.2.0-beta.1.bin'), { boardId: 'raspberry_pi_pico', lang: 'fr', version: '9.2.0-beta.1' });
  assert.equal(flasher.parseBinName('firmware.bin'), null);
  assert.equal(flasher.parseBinName(''), null);
});

test('flash() with the demo esptool: phases, progress, MD5 verification, facts for the fleet log', async () => {
  const bytes = new Uint8Array(70000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) & 0xff;
  flasher.setImage('adafruit-circuitpython-seeed_xiao_esp32c3-en_US-10.2.1.bin', bytes);
  const phases = [], logs = [], progress = [];
  const facts = await flasher.flash({ impl: flasher.demoEsptool({ ms: 50 }), offset: 0, eraseAll: true, onPhase: p => phases.push(p), onLog: l => logs.push(l), onProgress: f => progress.push(f) });
  assert.match(facts.chip, /ESP32-C3/);
  assert.equal(facts.mac, '84:f7:03:12:34:56');
  assert.equal(facts.erase_ok, 'yes'); assert.equal(facts.flash_ok, 'yes'); assert.equal(facts.flash_size, '4MB');
  assert.ok(phases.some(p => /erasing/.test(p)) && phases.some(p => /writing .*68 kB.*0x0/.test(p)) && phases.some(p => /resetting/.test(p)), phases.join(' | '));
  assert.equal(progress.at(-1), 1);
  assert.ok(logs.some(l => l.includes('Hash of data verified: ' + md5(bytes))), 'MD5 of the image handed to esptool-js');
});

test('flash() without an erase skips it and says so; a failure carries the facts gathered so far', async () => {
  flasher.setImage('x.bin', new Uint8Array(10));
  const facts = await flasher.flash({ impl: flasher.demoEsptool({ ms: 10 }), eraseAll: false });
  assert.equal(facts.erase_ok, 'skipped');
  const impl = flasher.demoEsptool({ ms: 10 });
  const Orig = impl.ESPLoader;
  impl.ESPLoader = class extends Orig { async writeFlash() { throw new Error('Timed out waiting for packet header'); } };
  await assert.rejects(flasher.flash({ impl }), e => { assert.match(e.message, /Timed out/); assert.equal(e.facts.flash_ok, 'no'); assert.match(e.facts.chip, /ESP32-C3/); return true; });
});

test('flash() refuses with no image', async () => {
  flasher.setImage('', null);
  await assert.rejects(flasher.flash({ impl: flasher.demoEsptool() }), /no CircuitPython image/);
});
