// Phase H: the shell game's page half — seats never collide, every fox wears every name, MACs are locally administered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityAt, table, collisionFree, randomMac, boardSeconds } from '../../js/model/shellgame.js';

const ids = ['A', 'B', 'C', 'D'].map((name, i) => ({ name, mac: `F2:00:00:00:00:0${i}` }));

test('identityAt advances with the clock and is offset by the seat', () => {
  assert.equal(identityAt(4, 0, 60, 0), 0); assert.equal(identityAt(4, 0, 60, 59), 0); assert.equal(identityAt(4, 0, 60, 60), 1);
  assert.equal(identityAt(4, 2, 60, 60), 3); assert.equal(identityAt(4, 3, 60, 60), 0);
});

test('table: no two seats share a name in any period, and each seat wears every name', () => {
  const rows = table(ids, 1800, [0, 1, 2, 3]);
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(new Set(r.names).size, 4);
  for (let seat = 0; seat < 4; seat++) assert.deepEqual(rows.map(r => r.names[seat]).sort(), ['A', 'B', 'C', 'D']);
  assert.ok(collisionFree(ids, [0, 1, 2])); assert.ok(!collisionFree(ids, [0, 0])); assert.ok(!collisionFree(ids, [0, 1, 2, 3, 4]));
});

test('randomMac is locally administered unicast', () => {
  for (let i = 0; i < 50; i++) { const m = randomMac(); const b0 = parseInt(m.slice(0, 2), 16); assert.equal(b0 & 0x02, 2); assert.equal(b0 & 0x01, 0); assert.match(m, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/); }
  assert.equal(randomMac(() => 0), '02:00:00:00:00:00');
});

test('boardSeconds matches the firmware sum (zone-less local components since 2000-01-01)', () => {
  // 2026-08-08 09:00:00 local: the firmware's civil-date sum
  const d = new Date(2026, 7, 8, 9, 0, 0);
  const days = (() => { let n = 0; for (let y = 2000; y < 2026; y++) n += (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365; return n + 31 + 28 + 31 + 30 + 31 + 30 + 31 + 7; })();
  assert.equal(boardSeconds(d), days * 86400 + 9 * 3600);
});
