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

test('fleet CSV: a cell a spreadsheet would evaluate (= + - @) is neutralised; plain numbers are not', () => {
  fleet.clear();
  fleet.append({ action: 'deploy', callsign: '=HYPERLINK("x")', notes: '@sum', freq: '146.565', power: '-7', result: '+ok' });
  const csv = fleet.toCsv();
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'formula cell quoted and prefixed');
  assert.ok(csv.includes(",'@sum"), '@ prefixed'); assert.ok(csv.includes(",'+ok"), '+ prefixed');
  assert.ok(csv.includes(',146.565,') && csv.includes(',-7,'), 'numbers untouched');
});

// ---- fromCsv / importCsv: the CSV comes back ----
const { fromCsv } = await import('../../js/model/profiles.js');
const norm = r => Object.fromEntries(FLEET_FIELDS.map(f => [f, r[f] == null ? '' : String(r[f])]));   // a file turns every value into a string

test('fleet CSV round trip: every value kind the log stores comes back equal (as strings)', () => {
  fleet.clear();
  fleet.append({ board_number: 1, uid: 'abc', action: 'deploy', callsign: 'KY4ZR "FOX", DE KY4ZR', notes: 'line one\nline two\r\nthree', freq: 146.565, power: -7, seed: 0, result: true, challenge: '' });
  fleet.append({ board_number: 2, uid: 'def', action: 'flash', callsign: '=HYPERLINK("x")', notes: '@sum', result: '+ok', profile: '-dash', template: "'already quoted", crystal: '\tTab' });
  const before = fleet.all().map(norm);
  const { rows, rejected } = fromCsv(fleet.toCsv());
  assert.deepEqual(rejected, []);
  assert.deepEqual(rows.map(norm), before);
  assert.equal(rows[1].callsign, '=HYPERLINK("x")', 'the apostrophe the writer added is taken off');
  assert.equal(rows[1].template, "'already quoted", 'an apostrophe the user typed stays');
  assert.equal(rows[0].notes, 'line one\nline two\r\nthree', 'a cell with a bare CR is quoted by the writer and survives');
});

test('fromCsv tolerates what a spreadsheet does to the file: BOM, CRLF, trailing blank line, Excel re-quoting every cell', () => {
  const text = '﻿"timestamp","uid","action","notes"\r\n"2026-11-07T10:00:00Z","abc","deploy","a, ""b"""\r\n"2026-11-07T10:01:00Z","abc","audit",""\r\n\r\n';
  const { rows, rejected } = fromCsv(text);
  assert.equal(rejected.length, 0); assert.equal(rows.length, 2);
  assert.equal(rows[0].notes, 'a, "b"'); assert.equal(rows[0].callsign, '', 'a column the file lacks is empty');
  assert.equal(rows[1]._line, 3, 'rows carry their line number');
});

test('fromCsv rejects what it cannot take, naming the problem', () => {
  assert.throws(() => fromCsv('timestamp,uid,colour\n2026-11-07T10:00:00Z,abc,red\n'), /unknown column\(s\) "colour"/);
  assert.throws(() => fromCsv('uid,action\nabc,deploy\n'), /needs at least the uid and timestamp/);
  assert.throws(() => fromCsv('timestamp,uid\n"2026-11-07T10:00:00Z,abc\n'), /line 2: a quoted cell is never closed/);
  assert.throws(() => fromCsv('\n\n'), /empty file/);
  const { rows, rejected } = fromCsv('timestamp,uid,action\n2026-11-07T10:00:00Z,abc,deploy,extra\n2026-11-07T10:01:00Z,abc\n2026-11-07T10:02:00Z,abc,audit\n');
  assert.equal(rows.length, 1);
  assert.deepEqual(rejected, [{ line: 2, why: '4 cells, header has 3' }, { line: 3, why: '2 cells, header has 3' }]);
});

test('importCsv merges by uid+timestamp: new rows added, the same event counted not duplicated, bad rows reported with their line', () => {
  fleet.clear();
  fleet.append({ uid: 'abc', action: 'deploy', result: 'ok' });
  const mine = fleet.toCsv();
  const again = fleet.importCsv(mine);
  assert.deepEqual(again, { added: 0, present: 1, rejected: [] });
  assert.equal(fleet.all().length, 1, 'nothing duplicated');
  const other = 'timestamp,uid,action,result\n2026-11-07T09:00:00Z,zzz,flash,ok\n,zzz,audit,ok\n2026-11-07T09:00:00Z,zzz,flash,ok\n';
  const r = fleet.importCsv(other);
  assert.equal(r.added, 1); assert.equal(r.present, 1, 'the same row twice in the file counts as present the second time');
  assert.deepEqual(r.rejected, [{ line: 3, why: 'no timestamp' }]);
  assert.equal(fleet.all().length, 2);
  assert.equal(fleet.all()[1].uid, 'zzz'); assert.equal(fleet.all()[1]._line, undefined, 'line numbers are not stored');
  // an edited copy of my own row (same uid+timestamp, different notes) does not overwrite
  const edited = mine.replace(/ok(\r?\n)$/, 'EDITED$1');
  const e = fleet.importCsv(edited);
  assert.equal(e.present, 1); assert.equal(fleet.all()[0].result, 'ok', 'never silently overwrites');
});

test('fleet CSV: a note that itself begins with an apostrophe and a formula character survives the round trip', () => {
  fleet.clear();
  fleet.append({ uid: 'a1', timestamp: '2026-11-07T00:00:00Z', notes: "'=not a formula, a quote", board: 'x' });
  const { rows } = fromCsv(fleet.toCsv());
  assert.equal(rows[0].notes, "'=not a formula, a quote");
  // and the plain case still loses nothing
  fleet.clear(); fleet.append({ uid: 'a2', timestamp: '2026-11-07T00:00:01Z', notes: '=SUM(1)', board: 'x' });
  assert.equal(fromCsv(fleet.toCsv()).rows[0].notes, '=SUM(1)');
});

test('fleet import rejects a row with no uid instead of merging it with every other uid-less row', () => {
  fleet.clear();
  const r = fleet.importCsv('uid,timestamp,board\n,2026-11-07T00:00:00Z,x\n,2026-11-07T00:00:00Z,y\nz9,2026-11-07T00:00:00Z,x\n');
  assert.equal(r.added, 1); assert.equal(r.rejected.length, 2);
  assert.match(r.rejected[0].why, /no uid/);
});
