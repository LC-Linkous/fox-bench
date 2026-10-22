// kitsune.test.mjs — the compiled family's model (js/model/vendor/kitsune.js): validation, checks, header out and back.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as k from '../../js/model/vendor/kitsune.js';

const load = p => JSON.parse(fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8'));
const apDefaults = load('firmware/templates/wifi-ap/defaults/seeed_xiao_esp32c5-kitsune.json');
const bleDefaults = load('firmware/templates/ble-ibeacon/defaults/m5stack_atom_lite-kitsune.json');
const zbDefaults = load('firmware/templates/zigbee-coordinator/defaults/seeed_xiao_esp32c5-kitsune.json');
const c5 = load('hardware/seeed_xiao_esp32c5.json'), atom = load('hardware/m5stack_atom_lite.json');
const board = id => ({ id });

test('MAC helpers: roll is locally administered unicast; the skeleton placeholders are recognised', () => {
  for (let i = 0; i < 20; i++) { const b = k.parseMac(k.randomMac()); assert.equal(b.length, 6); assert.equal(b[0], 0xF2); assert.equal(b[0] & 1, 0); assert.ok(b[0] & 2); }
  assert.equal(k.parseMac(k.randomMac(8)).length, 8);
  assert.ok(k.macIsPlaceholder(k.parseMac('00:01:02:03:04:05'))); assert.ok(k.macIsPlaceholder(k.parseMac('00:06:07:08:09:0a'))); assert.ok(k.macIsPlaceholder(k.parseMac('00:15:16:17:18:19')));
  assert.ok(!k.macIsPlaceholder(k.parseMac('F2:F4:90:22:0D:0F'))); assert.equal(k.parseMac('F2:F4:90'), null); assert.equal(k.parseMac('zz:00:00:00:00:00'), null);
});

test('validate: defaults pass as themselves; bad values fall back and are named', () => {
  const r = k.validate(apDefaults, apDefaults, board(apDefaults.board));
  assert.equal(r.status, 'ok'); assert.deepEqual(r.cfg, apDefaults);
  const bad = k.validate({ wifi: { ssid: 'x'.repeat(40), psk: 7, mac: 'F2:00', channel: 200, max_clients: 9, tx_power_dbm: 12 }, schedule: { wake_s: 0 }, challenge: { tier: 'brutal' } }, apDefaults, board(apDefaults.board));
  assert.match(bad.status, /^partial\(/);
  assert.deepEqual(bad.report.map(x => x.key).sort(), ['challenge.tier', 'schedule.wake_s', 'wifi.channel', 'wifi.mac', 'wifi.max_clients', 'wifi.psk', 'wifi.ssid', 'wifi.tx_power_dbm']);
  assert.equal(bad.cfg.wifi.ssid, apDefaults.wifi.ssid);
});

test('checks: the skeleton MAC blocks, a multicast MAC blocks, a real-OUI MAC warns; channel vs band; radio vs board', () => {
  const cfg = structuredClone(apDefaults);
  let iss = k.checks(cfg, c5);
  assert.ok(iss.some(i => i.key === 'wifi.mac' && i.level === 'err' && /placeholder/.test(i.msg)));
  cfg.wifi.mac = 'F3:00:00:00:00:01'; iss = k.checks(cfg, c5); assert.ok(iss.some(i => /multicast/.test(i.msg)));
  cfg.wifi.mac = '00:11:22:33:44:55'; iss = k.checks(cfg, c5); assert.ok(iss.some(i => i.level === 'warn' && /locally administered/.test(i.msg)));
  cfg.wifi.mac = k.randomMac(); cfg.wifi.band = '5'; cfg.wifi.channel = 6; iss = k.checks(cfg, c5); assert.ok(iss.some(i => i.key === 'wifi.channel' && i.level === 'err'));
  cfg.wifi.channel = 149; assert.ok(!k.checks(cfg, c5).some(i => i.level === 'err'), JSON.stringify(k.checks(cfg, c5)));
  // a 5 GHz AP on a board without the radio
  assert.ok(k.checks(cfg, atom).some(i => i.key === 'wifi.band' && i.level === 'err'));
  // bt-classic on an S3 board
  const bt = { template: 'bt-classic', challenge: { name: 'x', keyphrase: 'y' }, bt: { name: 'n', mac: k.randomMac() }, schedule: { wake_s: 30, sleep_s: 30 } };
  assert.ok(k.checks(bt, load('hardware/m5stack_atoms3_lite.json')).some(i => i.key === 'board'));
  assert.ok(!k.checks(bt, atom).some(i => i.level === 'err'));
});

test('header: export → parse → cfgFromBlock round-trips the Wi-Fi AP, iBeacon and Zigbee sections', () => {
  for (const [d, tid] of [[apDefaults, 'wifi-ap'], [bleDefaults, 'ble-ibeacon'], [zbDefaults, 'zigbee-coordinator']]) {
    const cfg = structuredClone(d); cfg.challenge.tier = 'hard'; cfg.challenge.name = 'Test "Fox"'; cfg.challenge.keyphrase = 'Are you it?';
    const sec = k.TEMPLATES[tid].section; cfg[sec].mac = k.randomMac(sec === 'zigbee' ? 8 : 6);
    if (sec === 'wifi') { cfg.wifi.channel = 0; cfg.wifi.hidden = true; cfg.wifi.tx_power_dbm = 8.5; }
    if (sec === 'ble') { cfg.schedule = { kind: 'duty', wake_s: 10, sleep_s: 30 }; cfg.ble.tx_power_dbm = -12; cfg.ble.signal_power_dbm = -59; }
    const text = k.exportHeader(cfg);
    assert.match(text, /#if defined\(HARD\)/); assert.match(text, /RFHS_CHALLENGE_NAME "Test \\"Fox\\""/); assert.match(text, /FOX_KEYWORDS "Hunter should ask 'Are you it\?'"/);
    const blocks = k.parseHeader(text);
    assert.equal(blocks.length, 1); assert.equal(blocks[0].tier, 'hard'); assert.equal(blocks[0].name, 'Test "Fox"'); assert.equal(blocks[0].keyphrase, 'Are you it?');
    const back = k.cfgFromBlock(blocks[0], tid);
    const merged = structuredClone(d); for (const [kk, v] of Object.entries(back)) merged[kk] = { ...merged[kk], ...v };
    const r = k.validate(merged, d, board(d.board));
    assert.equal(r.status, 'ok', JSON.stringify(r.report));
    assert.deepEqual(r.cfg[sec], cfg[sec]); assert.deepEqual(r.cfg.schedule, cfg.schedule); assert.equal(r.cfg.challenge.tier, 'hard');
  }
});

test('parseHeader reads a header in kitsune\'s own layout (nested AP/CLIENT × tier blocks, comments, hex MACs)', () => {
  const text = `// Bash to generate MAC address
//WIFI_POWER_19_5dBm 78
#if defined(AP)
#if defined(EASY)
// RFHS_CHALLENGE_NAME "WiFi AP Easy Fox"
// FOX_KEYWORDS "Hunter should ask 'Are you the WiFi AP Easy Fox?'"
// Network config
#define FSSID "Demo Hiro WiFi AP Easy Fox"
#define PSK "0123456789"
// set mac address
#define MAC_ADDR {0xF2, 0xF4, 0x90, 0x22, 0x0D, 0x0F}
// 1-13 permitted 0 means random
#define CHANNEL 1
// 0 broadcast 1 hidden
#define SSID_HIDDEN  0
// 1-4 permitted
#define MAX_CLIENTS 1
#define TIME_TO_WAKE 15
#define TIME_TO_SLEEP 5
#define TXPOWER WIFI_POWER_17dBm
#endif

#if defined(FIVEHARD)
// RFHS_CHALLENGE_NAME "WiFi 5GHz AP Hard Fox"
// FOX_KEYWORDS "Hunter should ask 'Are you the WiFi 5GHz AP Hard Fox?'"
#define FSSID "Demo Lagos WiFi 5GHzAP Hard Fox"
#define PSK "0123456789"
#define MAC_ADDR {0xF2, 0x13, 0xD4, 0x3C, 0x51, 0x4B}
#define CHANNEL 0
#define SSID_HIDDEN 0
#define MAX_CLIENTS 1
#define TIME_TO_WAKE 30
#define TIME_TO_SLEEP 45
#define TXPOWER WIFI_POWER_7dBm
#endif
#endif

#if defined(CLIENT)
#if defined(EASY)
// RFHS_CHALLENGE_NAME "WiFi Client Easy Fox"
// FOX_KEYWORDS "Hunter should ask 'Are you the WiFi Client Easy Fox?'"
#define FSSID "Demo Ng WiFi Client Easy Fox"
#define PSK "0123456789"
#define MAC_ADDR {0xF2, 0x44, 0x5E, 0x10, 0x97, 0xF4}
#define TIME_TO_WAKE 300
#define TIME_TO_SLEEP 1
#define TXPOWER WIFI_POWER_17dBm
#endif
#endif
`;
  const blocks = k.parseHeader(text);
  assert.deepEqual(blocks.map(b => [b.mode, b.tier, b.five]), [['AP', 'easy', false], ['AP', 'hard', true], ['CLIENT', 'easy', false]]);
  const ap = k.cfgFromBlock(blocks[0], 'wifi-ap');
  assert.equal(ap.wifi.ssid, 'Demo Hiro WiFi AP Easy Fox'); assert.equal(ap.wifi.mac, 'F2:F4:90:22:0D:0F'); assert.equal(ap.wifi.channel, 1); assert.equal(ap.wifi.hidden, false); assert.equal(ap.wifi.tx_power_dbm, 17); assert.equal(ap.schedule.sleep_s, 5); assert.equal(ap.challenge.keyphrase, 'Are you the WiFi AP Easy Fox?');
  const five = k.cfgFromBlock(blocks[1], 'wifi-ap'); assert.equal(five.wifi.band, '5'); assert.equal(five.wifi.tx_power_dbm, 7);
  const cl = k.cfgFromBlock(blocks[2], 'wifi-client'); assert.equal(cl.wifi.mac, 'F2:44:5E:10:97:F4'); assert.equal(cl.schedule.wake_s, 300);
});

test('cycle: wake/sleep timeline and the always-on case', () => {
  const items = k.cycle({ schedule: { wake_s: 15, sleep_s: 5 } }, 60000);
  assert.equal(items.filter(i => i.kind === 'tx').length, 3); assert.equal(items[0].dur, 15000); assert.equal(items[1].kind, 'off');
  assert.deepEqual(k.cycle({ schedule: { wake_s: 300, sleep_s: 0 } }, 60000), [{ t: 0, dur: 60000, kind: 'tx' }]);
});

test('every compiled template has defaults only for boards with its radio, and they validate clean', () => {
  const hw = Object.fromEntries(load('hardware/index.json').map(id => [id, load(`hardware/${id}.json`)]));
  for (const tid of Object.keys(k.TEMPLATES)) {
    const t = load(`firmware/templates/${tid}/template.json`);
    const dir = new URL(`../../firmware/templates/${tid}/defaults/`, import.meta.url);
    for (const f of fs.readdirSync(dir)) {
      const d = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
      const h = hw[d.board.replace(/-kitsune$/, '')];
      assert.ok(t.radios.every(r => h.radios.includes(r)), `${tid}/${f}: board lacks ${t.radios}`);
      assert.equal(k.validate(d, d, board(d.board)).status, 'ok');
      assert.ok(k.checks(d, h).some(i => /placeholder/.test(i.msg)), `${tid}/${f}: defaults should carry the placeholder MAC so a fox is never shipped with it`);
    }
  }
});
