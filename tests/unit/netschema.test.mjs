// netschema.test.mjs — the network-fox contract (js/model/netschema.js); its Python twin is held equal by schema_parity.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, checks, cycle, displayName, parseMac, bleMac, randomMac, enabledFeatures, eddystoneUrlBytes } from '../../js/model/netschema.js';

const defaults = t => JSON.parse(readFileSync(new URL(`../../firmware/templates/${t}/defaults/esp32c3.json`, import.meta.url)));
const C3 = { id: 'esp32c3', name: 'ESP32-C3', radios: ['wifi24', 'ble'], pins: [{ name: 'D0' }, { name: 'D10' }] };

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

test('page checks: hidden SSID is a warning, a missing radio an error, deep sleep an info, the placeholder callsign a warning (an error only as the name on the air)', () => {
  const d = defaults('wifi-beacon');
  const hid = checks(validate({ net: { hidden: true }, id: { callmessage: 'KY4ZR' }, schedule: { sleep: 'deep' } }, d, C3).cfg, C3).map(i => `${i.level}:${i.key}`);
  assert.deepEqual(hid, ['warn:net.hidden', 'info:net.psk', 'info:schedule.sleep']);
  assert.ok(checks(validate({}, d, C3).cfg, C3).some(i => i.level === 'warn' && i.key === 'id.callmessage'), 'placeholder not on the air: a warning');
  assert.ok(checks(validate({ id: { use_callsign_as_name: true } }, d, C3).cfg, C3).some(i => i.level === 'err' && i.key === 'id.callmessage'), 'placeholder as the name on the air: an error');
  assert.ok(checks(validate({}, defaults('ble-beacon'), { ...C3, radios: ['wifi24'] }).cfg, { ...C3, radios: ['wifi24'] }).some(i => i.level === 'err' && i.key === 'net.kind'));
});

test('cycle preview and MAC helpers', () => {
  const items = cycle(validate({ schedule: { wake_s: 10, sleep_s: 20 } }, defaults('wifi-beacon'), C3).cfg, 90000);
  assert.deepEqual(items.map(i => i.kind), ['tx', 'off', 'tx', 'off', 'tx', 'off']);
  assert.deepEqual(parseMac('F2:B0:00:00:00:01'), [0xf2, 0xb0, 0, 0, 0, 1]); assert.equal(parseMac('01:00:00:00:00:00'), null);
  assert.match(randomMac(6), /^F2(:[0-9A-F]{2}){5}$/);
});

test('contest features: sections exist only when given, defaults fill in, bad keys fall back, radios gate', () => {
  const d = defaults('wifi-beacon');
  let r = validate({ id: { callmessage: 'W1ABC' } }, d, C3);
  assert.equal('payload' in r.cfg, false);
  r = validate({ id: { callmessage: 'W1ABC' }, payload: { enabled: true, kind: 'rotate', names: ['ONE', 'TWO'] } }, d, C3);
  assert.equal(r.status, 'ok'); assert.equal(r.cfg.payload.interleave_ms, 1000); assert.deepEqual(enabledFeatures(r.cfg), ['payload']);
  r = validate({ id: { callmessage: 'W1ABC' }, payload: { enabled: true, kind: 'rotate' }, stealth: { enabled: true, rotate_mac: 'often', nope: 1 } }, d, C3);
  assert.equal(r.status, 'partial(payload.names,stealth.rotate_mac,stealth.nope)'); assert.equal(r.cfg.payload.kind, 'static');
  r = validate({ id: { callmessage: 'W1ABC' }, checkpoint: { enabled: true, portal: { enabled: true } } }, d, { ...C3, radios: ['ble'] });
  assert.equal(r.status, 'partial(checkpoint.portal.enabled)'); assert.equal(r.cfg.checkpoint.portal.enabled, false);
});

test('contest features: page checks name the conflicts', () => {
  const d = defaults('wifi-beacon');
  const r = validate({ id: { callmessage: 'W1ABC' }, checkpoint: { enabled: true, portal: { enabled: true } }, stealth: { enabled: true, start: { at: '2026-08-08T09:00:00' } }, schedule: { sleep: 'deep' } }, d, C3);
  // a portal with deep sleep is now the validator's job (foxlib 1.7 does the same): deep sleep goes off and is reported
  assert.ok(r.report.some(x => x.key === 'schedule.sleep')); assert.equal(r.cfg.schedule.sleep, 'off');
  const keys = checks(r.cfg, C3, { clockSet: false }).filter(i => i.level === 'err').map(i => i.key);
  assert.ok(keys.includes('stealth.start.at') && !keys.includes('checkpoint.portal.enabled'));
  const ok = checks(validate({ id: { callmessage: 'W1ABC' }, stealth: { enabled: true, start: { at: '2026-08-08T09:00:00-04:00' } } }, d, C3).cfg, C3, { clockSet: true });
  assert.equal(ok.filter(i => i.key === 'stealth.start.at').length, 0);
});

test('checks() with every phase G–E′ section on does not throw, and says what it must', () => {
  const ids = [{ name: 'FOX-A', mac: 'F2:00:00:00:00:0A' }, { name: 'FOX-B', mac: null }];
  const r = validate({
    net: { channels: [1, 6, 11] },
    stealth: { enabled: true, ble_only: false, rotate_mac: 'per-cycle', variable_power: { min_dbm: 2, max_dbm: 13, per: 'wake', slot_s: 10 }, modes: ['wifi-ap', 'ble'], shell_game: { identities: ids, period_s: 1800, index: 0 } },
    sense: { enabled: true, relay: { enabled: true, wait_for: 'FOX-2', then: 'toggle' }, honeypot: { enabled: true, probes: true }, crowd: { enabled: true } },
    checkpoint: { enabled: true, stop_after_finds: 3, stop_at: '2026-08-08T16:00:00', portal: { enabled: true } },
  }, defaults('wifi-beacon'), C3);
  assert.equal(r.status, 'ok');
  const keys = (clockSet) => checks(r.cfg, C3, { clockSet }).filter(i => i.level === 'err').map(i => i.key);
  const noClock = keys(false);
  assert.ok(noClock.includes('stealth.shell_game') && noClock.includes('checkpoint.stop_at'), noClock.join());
  const withClock = keys(true);
  assert.ok(!withClock.includes('checkpoint.stop_at'));
  assert.ok(withClock.includes('stealth.shell_game'));          // still: the shell game beside MAC rotation
  const bleOnly = validate({ stealth: { enabled: true, ble_only: true }, sense: { enabled: true, relay: { enabled: true, wait_for: 'X' } } }, defaults('ble-beacon'), C3);
  assert.ok(checks(bleOnly.cfg, C3, {}).some(i => i.level === 'err' && i.key === 'sense.relay.enabled'));
});

test('a BLE fox is on the air with the two top bits of its MAC set, and the page says so', () => {
  assert.equal(bleMac('F2:B0:00:00:00:07'), 'F2:B0:00:00:00:07');
  assert.equal(bleMac('02:11:22:33:44:55'), 'C2:11:22:33:44:55');
  assert.equal(bleMac('nope'), 'nope');
  const ok = validate({}, defaults('ble-beacon'), C3);
  assert.ok(!checks(ok.cfg, C3, {}).some(i => i.key === 'net.mac'));
  const low = validate({ net: { mac: '02:11:22:33:44:55' } }, defaults('ble-beacon'), C3);
  assert.ok(checks(low.cfg, C3, {}).some(i => i.level === 'warn' && i.key === 'net.mac' && i.msg.includes('C2:11:22:33:44:55')));
  const wifi = validate({ net: { mac: '02:11:22:33:44:55' } }, defaults('wifi-beacon'), C3);
  assert.ok(!checks(wifi.cfg, C3, {}).some(i => i.key === 'net.mac'));
});

test('the Eddystone URL is measured as the frame encodes it, and a URL that does not fit is an error the page can say', () => {
  assert.equal(eddystoneUrlBytes('https://lc-linkous.github.io'), 20);          // what the first S3 session tried: not sent
  assert.equal(eddystoneUrlBytes('https://www.example.com/'), 8);               // "example" 7 + ".com/" 1
  assert.equal(eddystoneUrlBytes('http://ab.github.io'), 12);
  assert.equal(eddystoneUrlBytes('ftp://x'), null);
  const C3 = { id: 'esp32c3', radios: ['wifi', 'ble'] };
  const long = validate({ payload: { enabled: true, eddystone: { url: 'https://lc-linkous.github.io' } } }, defaults('puzzle-beacon'), C3);
  const i = checks(long.cfg, C3, {}).find(x => x.key === 'payload.eddystone.url');
  assert.ok(i && i.level === 'err' && i.msg.startsWith('20 bytes encoded'));
  const fits = validate({ payload: { enabled: true, eddystone: { url: 'https://example.com/' } } }, defaults('puzzle-beacon'), C3);
  assert.ok(!checks(fits.cfg, C3, {}).some(x => x.key === 'payload.eddystone.url'));
  const noColon = validate({ payload: { enabled: true, eddystone: { url: 'https//lc-linkous.github.io' } } }, defaults('puzzle-beacon'), C3);
  assert.ok(noColon.report.some(r => r.key === 'payload.eddystone.url' && /must start with http/.test(r.reason)));
});
