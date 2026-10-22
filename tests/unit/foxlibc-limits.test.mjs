// foxlibc-limits.test.mjs — the page refuses what the C firmware cannot hold (js/model/foxlibc-limits.js).
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, countNodes, stringifyFoxJson, foxlibcLimitIssues } from '../../js/model/foxlibc-limits.js';

const song = (name, n) => ({ name, tempo: 120, notes: Array.from({ length: n }, (_, i) => [60 + (i % 12), 4]) });
const base = () => ({ schema: 1, template: 'morse-songs', board: 'picofox-foxlibc', radio: { ranges_mhz: [[144, 148]], itu_zone: 2 }, plan: { frequencies_mhz: [146.565] }, id: { callmessage: 'KY4ZR FOX', placeholder: 'N0CALL' }, payload: { kind: 'songs', playlist: [song('A', 20)] }, schedule: { kind: 'fixed' }, limits: {} });

test('a small config has no limit issues', () => { assert.deepEqual(foxlibcLimitIssues(base()), []); });

test('countNodes counts like the firmware: one per value, fractional numbers apart', () => {
  const { nodes, doubles } = countNodes({ a: [1, 2.5, 'x'], b: { c: null } });
  assert.equal(nodes, 7); assert.equal(doubles, 1);   // root, a, 1, 2.5, 'x', b, c
});

test('17 songs, a 300-note song and a long name are reported', () => {
  const c = base(); c.payload.playlist = Array.from({ length: 17 }, (_, i) => song('S' + i, 10)); c.payload.playlist[0] = song('x'.repeat(40), 300);
  const keys = foxlibcLimitIssues(c).map(i => i.key + ':' + i.level);
  assert.ok(keys.includes('payload.playlist:err')); assert.ok(keys.includes('payload.playlist[0]:err')); assert.ok(keys.includes('payload.playlist[0]:warn'));
});

test('a playlist that would exhaust the parser pool is blocking', () => {
  const c = base(); c.payload.playlist = Array.from({ length: 16 }, (_, i) => song('S' + i, 120));   // 16 × 120 notes × 3 nodes ≈ 5800
  const iss = foxlibcLimitIssues(c);
  assert.ok(iss.some(i => i.key === 'fox.json' && i.level === 'err' && /JSON values/.test(i.msg)), JSON.stringify(iss));
});

test('17 frequencies, 5 ranges and a 70-byte callsign are reported', () => {
  const c = base(); c.plan.frequencies_mhz = Array.from({ length: 17 }, (_, i) => 146 + i / 100); c.radio.ranges_mhz = [[144, 145], [145, 146], [146, 147], [147, 148], [144, 148]]; c.id.callmessage = 'K'.repeat(70);
  const keys = foxlibcLimitIssues(c).map(i => i.key);
  assert.deepEqual(keys.sort(), ['id.callmessage', 'plan.frequencies_mhz', 'radio.ranges_mhz']);
});

test('stringifyFoxJson keeps scalar arrays on one line and parses back identically', () => {
  const c = base(); c.id.callmessage = 'KY4ZR "FOX" [1, 2]';
  const s = stringifyFoxJson(c);
  assert.deepEqual(JSON.parse(s), c);
  assert.match(s, /\[60, 4\]/); assert.ok(!/\[\n\s+60,/.test(s));
  assert.ok(s.length < JSON.stringify(c, null, 1).length * 0.75);   // the saving grows with the playlist; this base has one short song
});

test('LIMITS has every constant the firmware parity test reads', () => {
  for (const k of ['JSON_MAX_NODES', 'JSON_MAX_DOUBLES', 'FILE_MAX_BYTES', 'PLAYLIST_MAX', 'SONG_MAX_NOTES', 'SONG_NAME_MAX', 'CFG_MAX_FREQS', 'CFG_MAX_RANGES', 'CALLMESSAGE_MAX']) assert.equal(typeof LIMITS[k], 'number', k);
});
