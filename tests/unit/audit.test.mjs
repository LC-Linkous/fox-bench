// audit.test.mjs — matching a connected fox against the fleet log (js/model/audit.js).
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observe, match, auditRow, firmwareText } from '../../js/model/audit.js';

const log = [
  { timestamp: '2026-10-21T18:00:00Z', board_number: 1, uid: 'aaaa1111', board: 'seeed_xiao_esp32c3', action: 'flash', result: 'ok' },
  { timestamp: '2026-10-21T18:02:00Z', board_number: 1, uid: 'aaaa1111', board: 'seeed_xiao_esp32c3', action: 'deploy', template: 'morse-songs/1.1.0', profile: 'Fox 1', callsign: 'W1ABC FOX DE W1ABC', freq: '146.565', result: 'ok' },
  { timestamp: '2026-10-21T18:10:00Z', board_number: 3, uid: 'e4654c16431b2321', board: 'picofox-foxlibc', action: 'deploy', template: 'morse-songs/1.1.0', profile: 'Pico', callsign: 'W1ABC PICO', freq: '146.565', result: 'written' },
  { timestamp: '2026-10-21T18:20:00Z', board_number: 2, uid: '', board: 'picofox-vendor', action: 'deploy', template: 'picofox/0.1.2', profile: 'Vendor', callsign: 'W1ABC/3 FOX', freq: '146.565', result: 'written' },
  { timestamp: '2026-10-21T18:30:00Z', board_number: 1, uid: 'aaaa1111', board: 'seeed_xiao_esp32c3', action: 'deploy', template: 'popcorn/1.1.0', profile: 'Fox 1 popcorn', callsign: 'W1ABC FOX DE W1ABC', freq: '146.565 147.42', result: 'ok' },
];

const replApp = (cfg, uid = 'aaaa1111') => ({ device: { kind: 'repl' }, boardId: 'seeed_xiao_esp32c3', family: 'foxlib', info: { uid }, onBoard: { cfg, template: cfg?.template, foxlibVersion: '1.0.2' }, lastBanner: { cfg: 'ok', radio: 'ok', id: 'set' } });

test('REPL fox matching its last deploy (the latest row for that UID wins)', () => {
  const obs = observe(replApp({ template: 'popcorn', id: { callmessage: 'W1ABC FOX DE W1ABC' }, plan: { frequencies_mhz: [146.565, 147.42] } }));
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
  assert.match(auditRow(obs, m).notes, /callsign: expected W1ABC FOX DE W1ABC, found W1ABC FOX/);
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

test('a UID no deploy carries falls back to the board\'s last UID-less deploy (drive deploys before board.json), never to another fox\'s', () => {
  const log2 = [
    ...log,
    { timestamp: '2026-10-22T00:39:00Z', board_number: '', uid: '', board: 'picofox-foxlibc', action: 'deploy', template: 'morse-songs/1.1.0', profile: '', callsign: 'W1ABC PICO', freq: '146.565', result: 'written' },
    { timestamp: '2026-10-22T01:00:00Z', board_number: 5, uid: 'bbbb2222', board: 'picofox-foxlibc', action: 'deploy', template: 'popcorn/1.1.0', profile: 'other pico', callsign: 'W1ABC/5', freq: '147.42', result: 'written' },
  ];
  const app = { device: { kind: 'console' }, boardId: 'picofox-foxlibc', family: 'foxlib-c', info: { uid: '0123456789abcdef' }, onBoard: { foxlibVersion: 'c-0.1.3', template: 'morse-songs' },
    lastBanner: { template: 'morse-songs/0.1.3', foxlib: 'c-0.1.3', board: 'picofox-foxlibc', uid: '0123456789abcdef', cfg: 'ok', radio: 'ok', id: 'set', freq: '146.565' } };
  const m = match(observe(app), log2);
  assert.match(m.by, /^board/); assert.equal(m.row.callsign, 'W1ABC PICO'); assert.equal(m.result, 'match');
  assert.match(auditRow(observe(app), m).notes, /logged without a UID/);
  // with no UID-less deploy on that board at all, it stays unmatched rather than borrowing the other fox's row
  assert.equal(match(observe(app), log2.filter(r => r.uid !== '' || r.action !== 'deploy')).result, 'unmatched');
});

test('foxlib-c over the drive with board.json: UID known, matched by uid', () => {
  const app = { device: { kind: 'drive' }, boardId: 'picofox-foxlibc', family: 'foxlib-c', info: { uid: 'e4654c16431b2321' }, onBoard: { cfg: { template: 'morse-songs', id: { callmessage: 'W1ABC PICO' }, plan: { frequencies_mhz: [146.565] } }, template: 'morse-songs', ident: { uid: 'e4654c16431b2321' } }, lastBanner: null };
  const obs = observe(app); assert.equal(obs.uid, 'e4654c16431b2321'); assert.equal(obs.callsign, 'W1ABC PICO');
  const m = match(obs, log); assert.equal(m.by, 'uid'); assert.equal(m.result, 'match');
});

test('vendor drive: no UID, matched by board; CALLSIGN compared as the firmware reduces it', () => {
  const app = { device: { kind: 'drive' }, boardId: 'picofox-vendor', family: 'drive', info: { uid: '' }, onBoard: { settings: { CALLSIGN: 'W1ABC3', FREQ_MHZ: '146.565000' }, template: 'picofox' }, lastBanner: null };
  const obs = observe(app);
  const m = match(obs, log);
  assert.equal(m.by, 'board'); assert.equal(m.row.board_number, 2); assert.equal(m.result, 'match', JSON.stringify(m.checks));
});

test('nothing connected observes null and matches to unmatched', () => {
  assert.equal(observe({ device: null }), null);
  assert.equal(match(null, log).result, 'unmatched');
});

test('a network fox is compared on what it shows on the air; a wrong SSID is a mismatch even with template and callsign right', () => {
  const netRow = { timestamp: '2026-11-24T09:00:00Z', board_number: 5, uid: 'c6c6c6', board: 'esp32c6', action: 'deploy', template: 'wifi-beacon/1.0.0', profile: 'Fox 5', callsign: 'W1ABC FOX DE W1ABC',
    freq: '', on_air: 'AP "W1ABC FOX DE W1ABC" · ch 1 · MAC F2:B0:00:00:00:01 · 17 dBm · 15 s on / 5 s off', firmware: 'foxlib 1.11.3 · CircuitPython 10.3.2' };
  const cfg = (ssid) => ({ template: 'wifi-beacon', id: { callmessage: 'W1ABC FOX DE W1ABC', use_callsign_as_name: !ssid }, net: { kind: 'wifi-ap', ssid: ssid || '', mac: 'F2:B0:00:00:00:01', channel: 1, tx_power_dbm: 17 },
    schedule: { kind: 'duty', wake_s: 15, sleep_s: 5 } });
  const appFor = c => ({ device: { kind: 'repl' }, boardId: 'esp32c6', family: 'foxlib', info: { uid: 'c6c6c6', cpVersion: '10.3.2' }, onBoard: { cfg: c, template: 'wifi-beacon', foxlibVersion: '1.11.3' }, lastBanner: null });
  const good = match(observe(appFor(cfg(null))), [netRow]);
  assert.equal(good.result, 'match');
  assert.ok(good.checks.some(c => c.key === 'on the air' && c.ok));
  const obs = observe(appFor(cfg('FOXBENCH WiFi Beacon')));
  const bad = match(obs, [netRow]);
  assert.equal(bad.result, 'mismatch');
  assert.deepEqual(bad.checks.filter(c => !c.ok).map(c => c.key), ['on the air']);
  assert.match(auditRow(obs, bad).notes, /on the air: expected AP "W1ABC FOX DE W1ABC"/);
  assert.equal(auditRow(obs, bad).firmware, 'foxlib 1.11.3 · CircuitPython 10.3.2');
});

test('firmwareText: foxlib + CircuitPython, foxlib-c from the banner form, empty when unknown', () => {
  assert.equal(firmwareText('1.11.3', '10.3.2'), 'foxlib 1.11.3 · CircuitPython 10.3.2');
  assert.equal(firmwareText('c-0.1.11'), 'foxlib-c 0.1.11');
  assert.equal(firmwareText('', ''), '');
});
