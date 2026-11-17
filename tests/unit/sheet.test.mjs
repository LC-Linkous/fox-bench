// The event sheet: one line per board (uid) or per exported profile, latest wins, event filter, CSV and print view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onAir, sheetRows, sheetCsv, sheetHtml } from '../../js/model/sheet.js';

const row = (o) => ({ action: 'deploy', result: 'ok', board_number: '', profile: '', template: 'wifi-beacon/1.0.0', uid: '', owner: '', callsign: '', event: '', on_air: '', ...o });

test('latest deploy per uid; failed deploys do not count', () => {
  const log = [
    row({ uid: 'aa', timestamp: '2026-11-16T10:00:00Z', on_air: 'old', board_number: 2 }),
    row({ uid: 'aa', timestamp: '2026-11-16T11:00:00Z', on_air: 'new', board_number: 2 }),
    row({ uid: 'aa', timestamp: '2026-11-16T12:00:00Z', on_air: 'broken', result: 'fail', board_number: 2 }),
    row({ uid: 'bb', timestamp: '2026-11-16T09:00:00Z', on_air: 'b', board_number: 1 }),
    row({ action: 'flash', uid: 'cc', timestamp: '2026-11-16T09:00:00Z' }),
  ];
  const r = sheetRows(log);
  assert.deepEqual(r.map(x => x.on_air), ['b', 'new']);       // sorted by fox number
});

test('exports are keyed by profile: re-exporting replaces the line; a later deploy of that profile supersedes it', () => {
  const log = [
    row({ action: 'export-zip', profile: 'Fox 3', timestamp: '2026-11-16T08:00:00Z', on_air: 'e1' }),
    row({ action: 'export-zip', profile: 'Fox 3', timestamp: '2026-11-16T08:30:00Z', on_air: 'e2' }),
    row({ action: 'export-zip', profile: 'Fox 4', timestamp: '2026-11-16T08:30:00Z', on_air: 'e4' }),
  ];
  assert.deepEqual(sheetRows(log).map(x => x.on_air).sort(), ['e2', 'e4']);
  log.push(row({ uid: 'dd', profile: 'Fox 3', timestamp: '2026-11-16T09:00:00Z', on_air: 'deployed' }));
  assert.deepEqual(sheetRows(log).map(x => x.on_air).sort(), ['deployed', 'e4']);
});

test('event filter', () => {
  const log = [row({ uid: 'aa', event: 'spring', timestamp: '1' }), row({ uid: 'bb', event: 'bench', timestamp: '1' })];
  assert.equal(sheetRows(log, { event: 'spring' }).length, 1);
  assert.equal(sheetRows(log).length, 2);
});

test('onAir: a network fox and an FM fox', () => {
  const net = { net: { kind: 'wifi-ap', ssid: 'FOX-3', channel: 6, channels: [1, 6, 11], mac: 'F2:00:00:00:00:03', tx_power_dbm: 13, max_clients: 4, hidden: false, psk: '' },
    id: { callmessage: 'N0CALL', use_callsign_as_name: false }, schedule: { wake_s: 120, sleep_s: 10, sleep: 'off' },
    checkpoint: { enabled: true, stop_after_finds: 5, stop_at: '', portal: { enabled: true, code: '4471', log: true }, ble: { enabled: false } },
    fleet: { points_to: 2 } };
  const a = onAir(net);
  for (const want of ['AP "FOX-3"', 'ch 1/6/11 per wake', '4 clients', 'MAC F2:00:00:00:00:03', '13 dBm', 'portal code 4471, logs finds', 'stops after 5 finds', '120 s on / 10 s off', '→ 2']) assert.ok(a.includes(want), `${want} in ${a}`);
  const fm = { plan: { frequencies_mhz: [146.565, 147.42] }, id: { callmessage: 'W1ABC FOX' }, schedule: { kind: 'fixed', delay_ms: 30000 }, payload: { kind: 'songs' } };
  assert.equal(onAir(fm), 'FM 146.565 → 147.420 MHz · "W1ABC FOX" · fixed every 30 s · songs');
});

test('CSV quotes what it must and shortens the uid; the print view escapes', () => {
  const r = [row({ uid: '1011121314151617', profile: 'Fox, "three"', on_air: 'AP "X" <b>', timestamp: '2026-11-16T10:00:00Z' })];
  const csv = sheetCsv(r).split('\n');
  assert.equal(csv[0], 'board_number,profile,template,board,uid,owner,callsign,on_air,timestamp');
  assert.ok(csv[1].includes('"Fox, ""three"""') && csv[1].includes(',14151617,'));
  const html = sheetHtml(r, { event: 'x<y' });
  assert.ok(html.includes('x&lt;y') && html.includes('AP "X" &lt;b&gt;') && !html.includes('<b>'));
});
