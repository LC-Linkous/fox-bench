// finds.test.mjs — the checkpoint desk's rollup (js/model/finds.js).
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollup, foxLabel, rollupCsv } from '../../js/model/finds.js';

const dep = (uid, n, event = 'Fall hunt', extra = {}) => ({ action: 'deploy', result: 'ok', uid, board_number: n, profile: `Fox ${n}`, template: 'checkpoint/1.0.0', event, timestamp: `2026-11-24T08:0${n}:00Z`, ...extra });
const find = (uid, call, t) => ({ action: 'find', uid, callsign: call, timestamp: t, template: 'checkpoint', notes: 'via portal' });
const log = [
  dep('a1', 1), dep('b2', 2), dep('c3', 3), dep('d4', 4, 'Other day'),
  find('a1', 'W1XYZ', '2026-11-24T10:00:00Z'), find('b2', 'W1XYZ', '2026-11-24T10:20:00Z'), find('b2', 'w1xyz', '2026-11-24T10:21:00Z'),   // the same fox twice, case-insensitive
  find('a1', 'N0CALL', '2026-11-24T10:05:00Z'), find('zz', 'N0CALL', '2026-11-24T10:06:00Z'),                                                 // a find on a fox not on the sheet
  find('c3', 'W1ABC', '2026-11-24T09:30:00Z'), find('a1', 'W1ABC', '2026-11-24T09:40:00Z'), find('b2', 'W1ABC', '2026-11-24T09:50:00Z'),
];

test('finds per hunter against the sheet, most found first, earliest finish breaks ties', () => {
  const r = rollup(log, { event: 'Fall hunt' });
  assert.deepEqual(r.foxes.map(f => [f.label, f.finds]), [['#1', 3], ['#2', 2], ['#3', 1]]);     // #4 is another event
  assert.deepEqual(r.hunters.map(h => h.callsign), ['W1ABC', 'W1XYZ', 'N0CALL']);
  const xyz = r.hunters[1];
  assert.deepEqual(xyz.found, ['#1', '#2']); assert.deepEqual(xyz.missing, ['#3']); assert.equal(xyz.n, 3);   // three rows, two foxes
  const n0 = r.hunters[2];
  assert.deepEqual(n0.found, ['#1']); assert.equal(n0.other, 1);                                            // the unknown uid counted, not listed
  assert.equal(r.hunters[0].last, '2026-11-24T09:50:00Z');
});

test('no event: every deployed fox counts; a fox is named by number, profile, or template + uid tail', () => {
  const r = rollup(log);
  assert.equal(r.foxes.length, 4);
  assert.equal(foxLabel({ board_number: '', profile: 'Red', template: 'x' }), 'Red');
  assert.equal(foxLabel({ board_number: '', profile: '', template: 'checkpoint/1.0.0', uid: '01db3aecc98c' }), 'checkpoint …c98c');
});

test('the CSV has one line per hunter with the foxes found and missing', () => {
  const csv = rollupCsv(rollup(log, { event: 'Fall hunt' }));
  assert.match(csv, /^callsign,found,of,foxes_found,missing,first,last\n/);
  assert.match(csv, /\nW1XYZ,2,3,#1 #2,#3,2026-11-24T10:00:00Z,2026-11-24T10:21:00Z\n/);
});
