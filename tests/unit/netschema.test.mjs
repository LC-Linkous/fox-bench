// netschema.test.mjs — the network-fox contract (js/model/netschema.js); its Python twin is held equal by schema_parity.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, checks, cycle, displayName, parseMac, randomMac } from '../../js/model/netschema.js';

const defaults = t => JSON.parse(readFileSync(new URL(`../../firmware/templates/${t}/defaults/seeed_xiao_esp32c3.json`, import.meta.url)));
const C3 = { id: 'seeed_xiao_esp32c3', name: 'XIAO C3', radios: ['wifi24', 'ble'] };

test('defaults validate clean for all three templates', () => {
  for (const t of ['wifi-beacon', 'wifi-probe', 'ble-beacon']) { const r = validate({}, defaults(t), C3); assert.equal(r.status, 'ok', t); assert.equal(r.cfg.template, t); }
});

test('wifi-ap: fields in range are taken, out of range fall back to defaults with the key in the status', () => {
  const r = validate({ net: { ssid: 'KY4ZR FOX', psk: 'foxhunt2026', channel: 6, tx_power_dbm: 8.5, max_clients: 2, mac: 'f2:b0:00:00:00:11' }, schedule: { wake_s: 20, sleep_s: 40, sleep: 'deep' } }, defaults('wifi-beacon'), C3);
  assert.equal(r.status, 'ok'); assert.equal(r.cfg.net.mac, 'F2:B0:00:00:00:11'); assert.equal(r.cfg.schedule.sleep, 'deep');
  const b = validate({ net: { ssid: '', psk: 'short', channel: 36, mac: '01:02:03:04:05:06', tx_power_dbm: 12 } }, defaults('wifi-beacon'), C3);
  assert.equal(b.status, 'partial(net.ssid,net.tx_power_dbm,net.psk,net.channel,net.mac)');
  assert.equal(b.cfg.net.channel, 1); assert.equal(b.cfg.net.mac, 'F2:B0:00:00:00:01');
});

test('5 GHz channels are accepted only on a board with the wifi5 radio', () => {
  assert.equal(validate({ net: { channel: 36 } }, defaults('wifi-beacon'), C3).status, 'partial(net.channel)');
  assert.equal(validate({ net: { channel: 36 } }, defaults('wifi-beacon'), { ...C3, radios: ['wifi24', 'wifi5'] }).status, 'ok');
});

test('the callsign can be the name on the air; too long for a name turns the option off', () => {
  const r = validate({ id: { callmessage: 'KY4ZR FOX 3', use_callsign_as_name: true } }, defaults('wifi-beacon'), C3);
  assert.equal(displayName(r.cfg), 'KY4ZR FOX 3');
  const l = validate({ id: { callmessage: 'K'.repeat(40), use_callsign_as_name: true } }, defaults('wifi-beacon'), C3);
  assert.equal(l.status, 'partial(id.callmessage)'); assert.equal(l.cfg.id.use_callsign_as_name, false); assert.equal(displayName(l.cfg), 'FOXBENCH WiFi Beacon');
});

test('ble: uuid shape, major/minor range, adv_min <= adv_max, power steps', () => {
  const r = validate({ net: { uuid: 'e2c56db5-dffb-48d2-b060-d0f5a71096e0', major: 7, minor: 65535, adv_min: 200, adv_max: 400, tx_power_dbm: -6 } }, defaults('ble-beacon'), C3);
  assert.equal(r.status, 'ok'); assert.equal(r.cfg.net.uuid, 'E2C56DB5-DFFB-48D2-B060-D0F5A71096E0');
  const b = validate({ net: { uuid: 'nope', minor: 70000, adv_min: 500, adv_max: 100, tx_power_dbm: 4 } }, defaults('ble-beacon'), C3);
  assert.equal(b.status, 'partial(net.uuid,net.minor,net.adv_min,net.tx_power_dbm)'); assert.equal(b.cfg.net.adv_min, 100);
});

test('page checks: hidden SSID is a warning, a missing radio an error, deep sleep an info, the placeholder callsign an error', () => {
  const d = defaults('wifi-beacon');
  const hid = checks(validate({ net: { hidden: true }, id: { callmessage: 'KY4ZR' }, schedule: { sleep: 'deep' } }, d, C3).cfg, C3).map(i => `${i.level}:${i.key}`);
  assert.deepEqual(hid, ['warn:net.hidden', 'info:net.psk', 'info:schedule.sleep']);
  assert.ok(checks(validate({}, d, C3).cfg, C3).some(i => i.level === 'err' && i.key === 'id.callmessage'));
  assert.ok(checks(validate({}, defaults('ble-beacon'), { ...C3, radios: ['wifi24'] }).cfg, { ...C3, radios: ['wifi24'] }).some(i => i.level === 'err' && i.key === 'net.kind'));
});

test('cycle preview and MAC helpers', () => {
  const items = cycle(validate({ schedule: { wake_s: 10, sleep_s: 20 } }, defaults('wifi-beacon'), C3).cfg, 90000);
  assert.deepEqual(items.map(i => i.kind), ['tx', 'off', 'tx', 'off', 'tx', 'off']);
  assert.deepEqual(parseMac('F2:B0:00:00:00:01'), [0xf2, 0xb0, 0, 0, 0, 1]); assert.equal(parseMac('01:00:00:00:00:00'), null);
  assert.match(randomMac(6), /^F2(:[0-9A-F]{2}){5}$/);
});
