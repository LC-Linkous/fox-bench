// uf2.test.mjs — UF2 structure / family / pin checks before a copy to the bootloader drive (js/model/uf2.js).
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectUf2, checkImage, RP2040_FAMILY, sha256hex } from '../../js/model/uf2.js';

function block(i, n, { family = RP2040_FAMILY, withFamily = true } = {}) {
  const b = new Uint8Array(512), dv = new DataView(b.buffer);
  dv.setUint32(0, 0x0A324655, true); dv.setUint32(4, 0x9E5D5157, true); dv.setUint32(8, withFamily ? 0x2000 : 0, true);
  dv.setUint32(12, 0x10000000 + i * 256, true); dv.setUint32(16, 256, true); dv.setUint32(20, i, true); dv.setUint32(24, n, true);
  dv.setUint32(28, withFamily ? family : 0, true); dv.setUint32(508, 0x0AB16F30, true);
  return b;
}
const image = (n, opts) => { const out = new Uint8Array(512 * n); for (let i = 0; i < n; i++) out.set(block(i, n, opts), i * 512); return out; };

test('a well-formed RP2040 UF2 passes', async () => {
  const img = image(3);
  assert.deepEqual(inspectUf2(img), { ok: true, blocks: 3, family: RP2040_FAMILY, rp2040: true });
  const c = await checkImage(img, { sha256: await sha256hex(img), size: img.length });
  assert.equal(c.ok, true); assert.equal(c.blocks, 3);
});

test('another chip family is named and refused', async () => {
  const c = await checkImage(image(2, { family: 0x1e1f432d }));   // RP2350 ARM-S
  assert.equal(c.ok, false); assert.match(c.problems[0], /family 0x1e1f432d, not the RP2040/);
});

test('a UF2 with no family id is refused too (the RP2040 bootloader wants one)', async () => {
  const c = await checkImage(image(2, { withFamily: false }));
  assert.equal(c.ok, false); assert.match(c.problems[0], /no family id/);
});

test('not a UF2: wrong length, wrong magic', async () => {
  assert.equal(inspectUf2(new Uint8Array(100)).ok, false);
  const bad = image(2); bad[512 + 5] ^= 0xff;   // second block, inside its magic
  assert.match(inspectUf2(bad).error, /block 1 has no UF2 magic/);
});

test('a pinned sha256 or size that differs is a problem, with the real one named', async () => {
  const img = image(2);
  const c = await checkImage(img, { sha256: 'ab'.repeat(32), size: 512 });
  assert.equal(c.ok, false);
  assert.ok(c.problems.some(p => /size 1024 B, expected 512 B/.test(p)));
  assert.ok(c.problems.some(p => /does not match the pinned abababababab/.test(p)));
});

test('the vendor descriptor pins a commit, a sha256 and a size for every file', async () => {
  const fs = await import('node:fs');
  const b = JSON.parse(fs.readFileSync(new URL('../../boards/picofox-vendor.json', import.meta.url)));
  const pin = b.firmware.stock_firmware_pinned_commit;
  assert.match(pin, /^[0-9a-f]{40}$/);
  for (const f of b.firmware.stock_firmware_files) { assert.ok(f.url.includes(pin), f.url); assert.match(f.sha256, /^[0-9a-f]{64}$/); assert.equal(f.size % 512, 0); }
});
