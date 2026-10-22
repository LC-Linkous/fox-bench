// audit.test.mjs — matching a connected fox against the fleet log (js/model/audit.js).
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observe, match, auditRow } from '../../js/model/audit.js';

const log = [
  { timestamp: '2026-10-21T18:00:00Z', board_number: 1, uid: 'aaaa1111', board: 'seeed_xiao_esp32c3', action: 'flash', result: 'ok' },
  { timestamp: '2026-10-21T18:02:00Z', board_number: 1, uid: 'aaaa1111', board: 'seeed_xiao_esp32c3', action: 'deploy', template: 'morse-songs/1.1.0', profile: 'Fox 1', callsign: 'KY4ZR FOX DE KY4ZR', freq: '146.565', result: 'ok' },
  { timestamp: '2026-10-21T18:10:00Z', board_number: 3, uid: 'e4654c16431b2321', board: 'picofox-foxlibc', action: 'deploy', template: 'morse-songs/1.1.0', profile: 'Pico', callsign: 'KY4ZR PICO', freq: '146.565', result: 'written' },
  { timestamp: '2026-10-21T18:20:00Z', board_number: 2, uid: '', board: 'picofox-vendor', action: 'deploy', template: 'picofox/0.1.2', profile: 'Vendor', callsign: 'KY4ZR/3 FOX', freq: '146.565', result: 'written' },
  { timestamp: '2026-10-21T18:30:00Z', board_number: 1, uid: 'aaaa1111', board: 'seeed_xiao_esp32c3', action: 'deploy', template: 'popcorn/1.1.0', profile: 'Fox 1 popcorn', callsign: 'KY4ZR FOX DE KY4ZR', freq: '146.565 147.42', result: 'ok' },
];

const replApp = (cfg, uid = 'aaaa1111') => ({ device: { kind: 'repl' }, boardId: 'seeed_xiao_esp32c3', family: 'foxlib', info: { uid }, onBoard: { cfg, template: cfg?.template, foxlibVersion: '1.0.2' }, lastBanner: { cfg: 'ok', radio: 'ok', id: 'set' } });

test('REPL fox matching its last deploy (the latest row for that UID wins)', () => {
  const obs = observe(replApp({ template: 'popcorn', id: { callmessage: 'KY4ZR FOX DE KY4ZR' }, plan: { frequencies_mhz: [146.565, 147.42] } }));
  const m = match(obs, log);
  assert.equal(m.by, 'uid'); assert.equal(m.row.profile, 'Fox 1 popcorn'); assert.equal(m.result, 'match');
  assert.deepEqual(m.checks.map(c => c.key), ['template', 'callsign', 'frequencies', 'cfg', 'radio', 'callsign set']);
  const row = auditRow(obs, m, 'box A');
  assert.equal(row.action, 'audit'); assert.equal(row.board_number, 1); assert.match(row.notes, /matched by uid/); assert.match(row.notes, /box A/);
});

test('a fox carrying a different config than its last deploy is a mismatch with the differences named', () => {
  const obs = observe(replApp({ template: 'morse-songs', id: { callmessage: 'W1ABC FOX' }, plan: { frequencies_mhz: [146.565] } }));
  const m = match(obs, log);
  assert.equal(m.result, 'mismatch');
  const bad = m.checks.filter(c => !c.ok).map(c => c.key);
  assert.deepEqual(bad, ['template', 'callsign', 'frequencies']);
  assert.match(auditRow(obs, m).notes, /callsign: expected KY4ZR FOX DE KY4ZR, found W1ABC FOX/);
});

test('an unknown UID is unmatched (no row), and is recorded as such', () => {
  const obs = observe(replApp({ template: 'morse-songs', id: { callmessage: 'X' }, plan: { frequencies_mhz: [146.565] } }, 'ffff0000'));
  const m = match(obs, log);
  assert.equal(m.result, 'unmatched'); assert.equal(m.row, null);
  assert.match(auditRow(obs, m).notes, /no deploy on record/);
});

test('foxlib-c over the console: identity from the banner, no callsign text to compare', () => {
  const app = { device: { kind: 'console' }, boardId: 'picofox-foxlibc', family: 'foxlib-c', info: { uid: 'e4654c16431b2321' }, onBoard: { foxlibVersion: 'c-0.1.2', template: 'morse-songs' },
    lastBanner: { template: 'morse-songs/0.1.2', foxlib: 'c-0.1.2', board: 'picofox-foxlibc', uid: 'e4654c16431b2321', cfg: 'ok', radio: 'ok', id: 'set', freq: '146.565' } };
  const obs = observe(app);
  assert.equal(obs.source, 'console'); assert.equal(obs.callsign, null); assert.deepEqual(obs.freqs, [146.565]);
  const m = match(obs, log);
  assert.equal(m.by, 'uid'); assert.equal(m.row.board_number, 3); assert.equal(m.result, 'match');
  assert.ok(!m.checks.some(c => c.key === 'callsign'));
});

test('vendor drive: no UID, matched by board; CALLSIGN compared as the firmware reduces it', () => {
  const app = { device: { kind: 'drive' }, boardId: 'picofox-vendor', family: 'drive', info: { uid: '' }, onBoard: { settings: { CALLSIGN: 'KY4ZR3', FREQ_MHZ: '146.565000' }, template: 'picofox' }, lastBanner: null };
  const obs = observe(app);
  const m = match(obs, log);
  assert.equal(m.by, 'board'); assert.equal(m.row.board_number, 2); assert.equal(m.result, 'match', JSON.stringify(m.checks));
});

test('nothing connected observes null and matches to unmatched', () => {
  assert.equal(observe({ device: null }), null);
  assert.equal(match(null, log).result, 'unmatched');
});
