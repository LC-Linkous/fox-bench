// profiles.test.mjs — saved configs and the fleet log in browser storage (js/model/profiles.js): CSV quoting, image
// packing, and what happens when storage refuses.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';

// a localStorage with a size limit, like a browser's quota
const store = new Map(); let limit = Infinity;
globalThis.localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { if (String(v).length > limit) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; } store.set(k, String(v)); },
  removeItem: k => store.delete(k),
};
const { profiles, fleet, FLEET_FIELDS, StorageError, packProfileImages, unpackProfileImages } = await import('../../js/model/profiles.js');

test('fleet CSV: every field, quoting of commas, quotes and newlines', () => {
  fleet.clear();
  fleet.append({ action: 'deploy', callsign: 'KY4ZR "FOX", DE KY4ZR', notes: 'line one\nline two', result: 'ok' });
  const csv = fleet.toCsv(), lines = csv.trim().split('\n');
  assert.equal(lines[0], FLEET_FIELDS.join(','));
  assert.ok(csv.includes('"KY4ZR ""FOX"", DE KY4ZR"')); assert.ok(csv.includes('"line one\nline two"'));
  assert.ok(FLEET_FIELDS.includes('challenge') && FLEET_FIELDS.includes('keyphrase'));
});

test('profile images are stored as base64 and come back as Uint8Array; old number-array profiles still load', () => {
  const px = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
  profiles.save({ name: 'p1', cfg: { a: 1 }, images: [{ name: 'img', width: 20, height: 15, pixels: px }] });
  const raw = JSON.parse(localStorage.getItem('fox-bench.profiles'))[0];
  assert.equal(typeof raw.images[0].pixels, 'string');
  const back = unpackProfileImages(profiles.all()[0].images);
  assert.ok(back[0].pixels instanceof Uint8Array); assert.deepEqual([...back[0].pixels], [...px]);
  const old = unpackProfileImages([{ name: 'legacy', pixels: [1, 2, 3] }]);
  assert.deepEqual([...old[0].pixels], [1, 2, 3]);
  assert.ok(packProfileImages([{ pixels: [1, 2, 3] }])[0].pixels.length < 10);
});

test('storage refusing a write is an error the caller sees, not a silent success', () => {
  limit = 200;
  assert.throws(() => profiles.save({ name: 'big', cfg: { pad: 'x'.repeat(500) }, images: [] }), e => e instanceof StorageError && /storage is full/.test(e.message));
  const seen = []; fleet.onError = m => seen.push(m);
  fleet.append({ action: 'deploy', notes: 'y'.repeat(500) });
  assert.equal(seen.length, 1); assert.match(seen[0], /fleet row NOT recorded \(deploy\)/);
  fleet.onError = null; limit = Infinity;
  assert.throws(() => { limit = 10; fleet.append({ action: 'x' }); }, StorageError);
  limit = Infinity;
});
