// Phase J: one fox leads to another — placeholders filled from the target profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, targetOf, valuesFor, chain, placeholdersIn } from '../../js/model/handoff.js';

const fm = { name: 'Fox 2 — songs', cfg: { fleet: { number: 2 }, plan: { frequencies_mhz: [146.565] }, id: { callmessage: 'W1ABC FOX' } } };
const net = { name: 'Fox 3 — checkpoint', cfg: { fleet: { number: 3, points_to: 2 }, net: { kind: 'wifi-ap', ssid: 'FOX-3' }, id: { callmessage: 'N0CALL', use_callsign_as_name: false },
  checkpoint: { enabled: true, portal: { enabled: true, code: '4471', body: 'Next: listen on {{to.freq}} MHz, call {{to.callsign}}' } } } };
const ble = { name: 'Fox 4 — beacon', cfg: { fleet: { number: 4, points_to: 3 }, net: { kind: 'ble', name: 'go to {{to.name}} code {{to.code}}' }, payload: { enabled: true, code: { major: 7, minor: 9 } } } };
const all = [fm, net, ble];

test('targetOf: by number first, then by name', () => {
  assert.equal(targetOf(2, all), fm); assert.equal(targetOf('2', all), fm);
  assert.equal(targetOf('Fox 4 — beacon', all), ble);
  assert.equal(targetOf(9, all), null); assert.equal(targetOf('', all), null);
});

test('valuesFor: an FM fox offers freq and callsign; a net fox name and code', () => {
  assert.deepEqual(valuesFor(fm), { freq: '146.565', number: '2', callsign: 'W1ABC FOX' });
  const v = valuesFor(net); assert.equal(v.name, 'FOX-3'); assert.equal(v.code, '4471'); assert.equal(v.freq, undefined);
  assert.equal(valuesFor(ble).code, '7/9');
});

test('resolve fills text outside fleet and leaves the input alone', () => {
  const r = resolve(net.cfg, all);
  assert.equal(r.cfg.checkpoint.portal.body, 'Next: listen on 146.565 MHz, call W1ABC FOX');
  assert.equal(net.cfg.checkpoint.portal.body.includes('{{to.freq}}'), true);
  assert.deepEqual(r.used.sort(), ['callsign', 'freq']); assert.equal(r.unresolved.length, 0); assert.equal(r.target, fm);
  assert.equal(placeholdersIn(net.cfg).length, 2);
});

test('resolve reports what it cannot fill', () => {
  const r = resolve(ble.cfg, all);           // ble -> net: name and code exist
  assert.equal(r.cfg.net.name, 'go to FOX-3 code 4471'); assert.equal(r.unresolved.length, 0);
  const lost = resolve({ fleet: { points_to: 42 }, net: { ssid: '{{to.name}} {{to.bogus}}' } }, all);
  assert.equal(lost.unresolved.length, 3);     // no target, needs target, unknown key
  assert.ok(lost.unresolved.some(u => u.path === 'fleet.points_to'));
  assert.ok(lost.unresolved.some(u => u.key === 'bogus'));
  const nofreq = resolve({ fleet: { points_to: 3 }, id: { callmessage: 'QSY {{to.freq}}' } }, all);
  assert.equal(nofreq.unresolved.length, 1); assert.match(nofreq.unresolved[0].why, /has no freq/);
  const none = resolve({ net: { ssid: 'plain' } }, all);
  assert.equal(none.cfg.net.ssid, 'plain'); assert.equal(none.target, null);
});

test('chain lists links and finds loops and dead ends', () => {
  const c = chain(all);
  assert.deepEqual(c.links.map(l => l.text), ['#3 Fox 3 — checkpoint → #2 Fox 2 — songs', '#4 Fox 4 — beacon → #3 Fox 3 — checkpoint']);
  assert.equal(c.problems.length, 0);
  const loop = chain([{ name: 'a', cfg: { fleet: { number: 1, points_to: 2 } } }, { name: 'b', cfg: { fleet: { number: 2, points_to: 1 } } }, { name: 'c', cfg: { fleet: { number: 3, points_to: 3 } } }, { name: 'd', cfg: { fleet: { number: 4, points_to: 9 } } }]);
  assert.ok(loop.problems.some(p => p.startsWith('loop:')));
  assert.ok(loop.problems.some(p => p.includes('points to itself')));
  assert.ok(loop.problems.some(p => p.includes('not a saved profile')));
});
