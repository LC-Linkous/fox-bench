// kitsune.js — the RF Hackers Sanctuary's kitsune foxes (https://github.com/rfhs/kitsune), modelled for the bench.
// SPDX-License-Identifier: GPL-2.0-only
//
// kitsune is PlatformIO/Arduino firmware for ESP32-family boards: Wi-Fi AP, Wi-Fi client, BLE iBeacon, Bluetooth
// Classic discoverable, Zigbee coordinator. Everything that makes one fox differ from another is a compile-time
// `#define` in a per-conference header (src/conferences/<year><name>.h), picked by a difficulty tier. This module
// is the page's understanding of that header: the fox.json sections for the `compiled` family (CONFIG.md), their
// validation, the checks the headers only document, the duty-cycle timeline, and the header itself written and
// read back. Nothing of kitsune is copied here; it belongs to its authors. The firmware is not flashed from the
// page yet (docs/kitsune-integration-plan.md): this is the "same forms, their build" stage.

export const ID = 'kitsune';
export const SOURCE = 'https://github.com/rfhs/kitsune';

/** Transmit-power choices as kitsune exposes them, per radio (dBm). */
export const WIFI_POWER_DBM = [19.5, 19, 18.5, 17, 15, 13, 11, 8.5, 7, 5, 2, -1];
export const BLE_POWER_DBM = [-12, -9, -6, -3, 0, 3, 6, 9];
export const ZIGBEE_POWER_RANGE = [-15, 20];
export const WIFI24_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];          // kitsune's random pick is 1–11 ("worldwide")
export const WIFI24_CHANNELS_13 = [12, 13];                                  // allowed by some domains; kitsune's header says 1–13 permitted
export const WIFI5_CHANNELS = [36, 40, 44, 48, 149, 153, 157, 161, 165];     // kitsune's 5 GHz list on the C5
export const ZIGBEE_CHANNELS = Array.from({ length: 16 }, (_, i) => 11 + i);
export const TIERS = ['easy', 'medium', 'hard'];

/** Which fox.json section each template fills, and which radio the hardware must have. */
export const TEMPLATES = {
  'wifi-ap':            { section: 'wifi', mode: 'AP', radio: 'wifi24', project: 'wifi/wifi_ap_client' },
  'wifi-client':        { section: 'wifi', mode: 'CLIENT', radio: 'wifi24', project: 'wifi/wifi_ap_client' },
  'ble-ibeacon':        { section: 'ble', mode: null, radio: 'ble', project: 'bluetooth/iBeacon' },
  'bt-classic':         { section: 'bt', mode: null, radio: 'btclassic', project: 'bluetooth/classic_discoverable' },
  'zigbee-coordinator': { section: 'zigbee', mode: 'COORDINATOR', radio: 'ieee802154', project: 'zigbee/zigbee_coordinator' },
};

const utf8len = s => new TextEncoder().encode(String(s)).length;
const isInt = v => Number.isInteger(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

/** "F2:AB:…" — 6 bytes for Wi-Fi/BT, 8 (EUI-64) for 802.15.4. Locally administered, unicast: first byte 0xF2 as kitsune does. */
export function randomMac(bytes = 6) {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b); b[0] = 0xF2;
  return [...b].map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
}
export const parseMac = s => { const m = String(s || '').trim().toUpperCase().match(/^([0-9A-F]{2})(?:[:-]([0-9A-F]{2}))+$/); if (!m) return null; const bytes = s.toUpperCase().split(/[:-]/).map(x => parseInt(x, 16)); return bytes.length === 6 || bytes.length === 8 ? bytes : null; };
export const macText = bytes => bytes.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
export const macIsPlaceholder = bytes => !!bytes && bytes[0] === 0 && bytes.slice(1).every((x, i) => x === bytes[1] + i);   // kitsune's skeleton {0x00, 0x01, 0x02, …}, {0x00, 0x06, 0x07, …}

// ---- fox.json for this family: merge over defaults, validate, report (the shape schema.js produces: { cfg, report, fatal, status })

export function validate(user, defaults, board) {
  const cfg = structuredClone(defaults), report = [], bad = (key, reason) => report.push({ key, reason });
  const u = user && typeof user === 'object' ? user : {};
  if (u.template !== undefined && u.template !== defaults.template) return { cfg, report: [{ key: 'template', reason: 'does not match' }], fatal: null, status: 'default(template)' };
  if (u.board !== undefined && board && u.board !== board.id) return { cfg, report: [{ key: 'board', reason: 'config is for another board' }], fatal: null, status: 'default(board)' };
  const t = TEMPLATES[defaults.template] || {};
  // challenge
  const c = u.challenge || {};
  if ('name' in c) { if (typeof c.name === 'string' && c.name.trim()) cfg.challenge.name = c.name.trim(); else bad('challenge.name', 'non-empty string'); }
  if ('keyphrase' in c) { if (typeof c.keyphrase === 'string') cfg.challenge.keyphrase = c.keyphrase; else bad('challenge.keyphrase', 'string'); }
  if ('tier' in c) { if (TIERS.includes(c.tier)) cfg.challenge.tier = c.tier; else bad('challenge.tier', TIERS.join('|')); }
  // the radio section the template uses
  const sec = t.section;
  const s = u[sec] || {};
  const str = (k, max) => { if (k in s) { if (typeof s[k] === 'string' && utf8len(s[k]) <= max) cfg[sec][k] = s[k]; else bad(`${sec}.${k}`, `string, ≤ ${max} bytes`); } };
  const mac = (k, n) => { if (k in s) { const b = parseMac(s[k]); if (b && b.length === n) cfg[sec][k] = macText(b); else bad(`${sec}.${k}`, `${n} hex bytes separated by :`); } };
  const bool = k => { if (k in s) { if (typeof s[k] === 'boolean') cfg[sec][k] = s[k]; else bad(`${sec}.${k}`, 'bool'); } };
  const int = (k, lo, hi) => { if (k in s) { if (isInt(s[k]) && inRange(s[k], lo, hi)) cfg[sec][k] = s[k]; else bad(`${sec}.${k}`, `${lo}–${hi}`); } };
  const oneOf = (k, list) => { if (k in s) { if (list.includes(s[k])) cfg[sec][k] = s[k]; else bad(`${sec}.${k}`, list.join('|')); } };
  if (sec === 'wifi') {
    str('ssid', 32); str('psk', 63); mac('mac', 6); oneOf('tx_power_dbm', WIFI_POWER_DBM);
    if (t.mode === 'AP') { oneOf('band', ['2.4', '5']); int('channel', 0, 177); bool('hidden'); int('max_clients', 1, 4); }
  } else if (sec === 'ble') {
    str('device_name', 29); mac('mac', 6); oneOf('tx_power_dbm', BLE_POWER_DBM);
    if ('uuid' in s) { if (typeof s.uuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.uuid)) cfg.ble.uuid = s.uuid.toLowerCase(); else bad('ble.uuid', '8-4-4-4-12 hex'); }
    int('major', 0, 65535); int('minor', 0, 65535); int('signal_power_dbm', -127, 0);
    int('adv_min', 32, 16384); int('adv_max', 32, 16384);          // 0.625 ms units, as the ESP API takes them
    if (cfg.ble.adv_max < cfg.ble.adv_min) { bad('ble.adv_max', '≥ adv_min'); cfg.ble.adv_max = cfg.ble.adv_min; }
  } else if (sec === 'bt') {
    str('name', 248); mac('mac', 6);
  } else if (sec === 'zigbee') {
    mac('mac', 8); int('channel', 0, 26); if (isInt(cfg.zigbee.channel) && cfg.zigbee.channel > 0 && cfg.zigbee.channel < 11) { bad('zigbee.channel', '0 (random) or 11–26'); cfg.zigbee.channel = defaults.zigbee.channel; }
    int('tx_power_dbm', ZIGBEE_POWER_RANGE[0], ZIGBEE_POWER_RANGE[1]);
  }
  // schedule: the duty cycle (wake, then deep sleep); sleep 0 = never sleeps
  const sch = u.schedule || {};
  if ('kind' in sch && sch.kind !== 'duty') bad('schedule.kind', 'duty');
  if ('wake_s' in sch) { if (isInt(sch.wake_s) && inRange(sch.wake_s, 1, 86400)) cfg.schedule.wake_s = sch.wake_s; else bad('schedule.wake_s', '1–86400'); }
  if ('sleep_s' in sch) { if (isInt(sch.sleep_s) && inRange(sch.sleep_s, 0, 86400)) cfg.schedule.sleep_s = sch.sleep_s; else bad('schedule.sleep_s', '0–86400'); }
  if (u.led && typeof u.led === 'object' && 'enabled' in u.led) { if (typeof u.led.enabled === 'boolean') cfg.led.enabled = u.led.enabled; else bad('led.enabled', 'bool'); }
  if (u.fleet && typeof u.fleet === 'object') cfg.fleet = { ...cfg.fleet, ...u.fleet };
  const status = report.length ? `partial(${report.map(r => r.key).join(',')})` : 'ok';
  return { cfg, report, fatal: null, status };
}

/** What the headers only say in comments, and what a fox would fail its self-check on. Same shape as schema.js pageChecks. */
export function checks(cfg, hw) {
  const issues = [], err = (key, msg, extra = {}) => issues.push({ level: 'err', key, msg, ...extra }), warn = (key, msg) => issues.push({ level: 'warn', key, msg }), info = (key, msg) => issues.push({ level: 'info', key, msg });
  const t = TEMPLATES[cfg.template]; if (!t) return issues;
  if (hw && Array.isArray(hw.radios) && !hw.radios.includes(t.radio)) err('board', `${hw.name} has no ${t.radio} radio; kitsune does not build ${cfg.template} for it`);
  const sec = cfg[t.section] || {};
  const m = parseMac(sec.mac);
  if (!m) err(`${t.section}.mac`, 'MAC is not set');
  else {
    if (macIsPlaceholder(m)) err(`${t.section}.mac`, 'placeholder MAC from the skeleton header — roll a real one (the button next to it)');
    if (m[0] & 1) err(`${t.section}.mac`, 'first byte has the multicast bit set (bit 0); a station address must be unicast');
    else if (!(m[0] & 2)) warn(`${t.section}.mac`, 'not a locally administered address (bit 1 of the first byte clear): this looks like a real vendor OUI — kitsune uses F2:… so a spoofed fox cannot be mistaken for someone\'s device');
  }
  if (!cfg.challenge?.name) err('challenge.name', 'the challenge needs a name (it is what the scoreboard shows)');
  if (!cfg.challenge?.keyphrase) warn('challenge.keyphrase', 'no key phrase: the fox sheet will not tell the hunter what to say');
  if (t.section === 'wifi') {
    if (!sec.ssid || !sec.ssid.trim()) err('wifi.ssid', 'SSID is empty');
    if (sec.psk && (sec.psk.length < 8 || sec.psk.length > 63)) err('wifi.psk', 'a WPA2 passphrase is 8–63 characters (empty = open network)');
    if (t.mode === 'AP') {
      const five = sec.band === '5';
      if (five && hw && !hw.radios?.includes('wifi5')) err('wifi.band', `${hw.name} has no 5 GHz radio`);
      if (sec.channel !== 0) {
        if (five && !WIFI5_CHANNELS.includes(sec.channel)) err('wifi.channel', `5 GHz channel must be one kitsune uses: ${WIFI5_CHANNELS.join(' ')} (0 = random from that list)`);
        if (!five && !WIFI24_CHANNELS.includes(sec.channel)) { if (WIFI24_CHANNELS_13.includes(sec.channel)) warn('wifi.channel', `channel ${sec.channel} is not allowed in every regulatory domain (kitsune sets the domain to US, where 12–13 are not usable)`); else err('wifi.channel', '2.4 GHz channel 1–11, or 0 = random'); }
      } else info('wifi.channel', 'channel 0: the fox picks a random channel at every wake');
      if (sec.hidden) info('wifi.hidden', 'hidden SSID: hunters see only the BSSID until a client probes');
    }
  } else if (t.section === 'ble') {
    if (!sec.device_name) err('ble.device_name', 'device name is empty');
    if (!sec.uuid) err('ble.uuid', 'beacon UUID is empty');
    if (sec.adv_max && sec.adv_min && (sec.adv_min > 6000)) warn('ble.adv_min', `advertising interval ${(sec.adv_min * 0.625 / 1000).toFixed(1)} s and up: slow to find`);
  } else if (t.section === 'bt') {
    if (!sec.name) err('bt.name', 'device name is empty');
  } else if (t.section === 'zigbee') {
    if (sec.channel !== 0 && !ZIGBEE_CHANNELS.includes(sec.channel)) err('zigbee.channel', '802.15.4 channel 11–26, or 0 = random');
  }
  const sch = cfg.schedule || {};
  if (sch.wake_s < 5) warn('schedule.wake_s', 'kitsune runs its self-checks during the first seconds of a wake; under about 5 s the LED may not get to show the result');
  if (sch.sleep_s === 0) info('schedule.sleep_s', 'sleep 0: the fox never deep-sleeps (restarts after each wake period so the checks run again)');
  else if (sch.sleep_s > 0 && sch.sleep_s < 3) warn('schedule.sleep_s', 'very short sleeps: kitsune subtracts fixed delays from the sleep time, under a few seconds it becomes 0');
  if (sch.sleep_s > 0) info('battery', 'the fox deep-sleeps between wakes: the pack must not cut off at low current, or it never wakes (kitsune\'s README)');
  return issues;
}

/** The duty cycle as the timeline draws it: wake (on the air) then sleep, repeated. */
export function cycle(cfg, horizonMs = 3600000) {
  const w = (cfg.schedule?.wake_s || 0) * 1000, sl = (cfg.schedule?.sleep_s || 0) * 1000;
  const items = []; let t = 0;
  if (!w) return items;
  while (t < horizonMs) { items.push({ t, dur: Math.min(w, horizonMs - t), kind: 'tx' }); t += w; if (sl) { items.push({ t, dur: Math.min(sl, Math.max(0, horizonMs - t)), kind: 'off' }); t += sl; } }
  return items;
}

// ---- the conference header, written and read back

const tierDefine = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };
const macDefine = bytes => '{' + bytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ') + '}';
const wifiPowerDefine = dbm => 'WIFI_POWER_' + (dbm < 0 ? 'MINUS_' + (-dbm) : String(dbm).replace('.', '_')) + 'dBm';
const blePowerDefine = dbm => 'ESP_PWR_LVL_' + (dbm < 0 ? 'N' + (-dbm) : 'P' + dbm).replace('P0', 'N0');
const cstr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/**
 * One tier block of a kitsune conference header for this config, with the guards kitsune's projects use
 * (`#if defined(AP)` / `#if defined(EASY)` …), the RFHS_CHALLENGE_NAME / FOX_KEYWORDS comment lines its
 * report scripts grep for, and the same define names. Drop it into src/conferences/<year><name>.h.
 */
export function exportHeader(cfg) {
  const t = TEMPLATES[cfg.template]; if (!t) throw new Error(`not a kitsune template: ${cfg.template}`);
  const tier = cfg.challenge.tier, five = t.section === 'wifi' && cfg.wifi.band === '5';
  const sec = cfg[t.section], L = [];
  const guard = t.mode === 'AP' && five ? (tier === 'easy' ? 'FIVEEASY' : 'FIVEHARD') : tierDefine[tier];
  L.push(`// generated by fox-bench for kitsune (${SOURCE}) — ${cfg.template}, tier ${tier}`);
  if (t.mode) L.push(`#if defined(${t.mode})`);
  L.push(`#if defined(${guard})`);
  L.push(`// RFHS_CHALLENGE_NAME ${cstr(cfg.challenge.name)}`);
  L.push(`// FOX_KEYWORDS ${cstr(`Hunter should ask '${cfg.challenge.keyphrase}'`)}`);
  const mac = parseMac(sec.mac) || [];
  if (t.section === 'wifi') {
    L.push(`#define FSSID ${cstr(sec.ssid)}`, `#define PSK ${cstr(sec.psk)}`, `#define MAC_ADDR ${macDefine(mac)}`);
    if (t.mode === 'AP') L.push(`#define CHANNEL ${sec.channel}`, `#define SSID_HIDDEN ${sec.hidden ? 1 : 0}`, `#define MAX_CLIENTS ${sec.max_clients}`);
    L.push(`#define TIME_TO_WAKE ${cfg.schedule.wake_s}`, `#define TIME_TO_SLEEP ${cfg.schedule.sleep_s}`, `#define TXPOWER ${wifiPowerDefine(sec.tx_power_dbm)}`);
  } else if (t.section === 'ble') {
    L.push(`#define DEVICE_NAME ${cstr(sec.device_name)}`, `#define BEACON_UUID ${cstr(sec.uuid)}`, `#define MANUFACTURER_ID 0x4c00`, `#define MAJOR ${sec.major}`, `#define MINOR ${sec.minor}`,
      `#define SIGNAL_POWER 0x${(sec.signal_power_dbm & 0xff).toString(16).padStart(2, '0')}`, `#define MAC_ADDR ${macDefine(mac)}`,
      `#define ADV_MIN_INTERVAL ${sec.adv_min}`, `#define ADV_MAX_INTERVAL ${sec.adv_max}`, `#define ADV_TX_POWER ${blePowerDefine(sec.tx_power_dbm)}`);
    if (cfg.schedule.sleep_s > 0) L.push(`#define DEEP_SLEEP`, `#define ADVERTISING_DURATION ${cfg.schedule.wake_s}`, `#define GPIO_DEEP_SLEEP_DURATION ${cfg.schedule.sleep_s}`);
  } else if (t.section === 'bt') {
    L.push(`#define NAME ${cstr(sec.name)}`, `#define MAC_ADDR ${macDefine(mac)}`, `#define TIME_TO_WAKE ${cfg.schedule.wake_s}`, `#define TIME_TO_SLEEP ${cfg.schedule.sleep_s}`);
  } else if (t.section === 'zigbee') {
    L.push(`#define MAC_ADDR ${macDefine(mac)}`, `#define CHANNEL ${sec.channel}`, `#define TIME_TO_WAKE ${cfg.schedule.wake_s}`, `#define TIME_TO_SLEEP ${cfg.schedule.sleep_s}`, `#define TXPOWER ${sec.tx_power_dbm}`);
  }
  L.push('#endif');
  if (t.mode) L.push('#endif');
  return L.join('\n') + '\n';
}

const unstr = s => { const m = String(s).match(/^"(.*)"$/); return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : String(s); };

/**
 * Read a kitsune conference header back: every tier block found, as { mode, tier, five, values: {DEFINE: value}, name, keyphrase }.
 * Preprocessor-naive on purpose: it tracks the `#if defined(X)` / `#endif` nesting kitsune's headers use and nothing else.
 */
export function parseHeader(text) {
  const blocks = [], stack = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^#if\s+defined\((\w+)\)/))) { stack.push(m[1]); const tiers = { EASY: 'easy', MEDIUM: 'medium', HARD: 'hard', FIVEEASY: 'easy', FIVEHARD: 'hard' }; if (m[1] in tiers) { cur = { mode: stack.find(x => ['AP', 'CLIENT', 'COORDINATOR'].includes(x)) || null, tier: tiers[m[1]], five: m[1].startsWith('FIVE'), values: {}, name: '', keyphrase: '' }; blocks.push(cur); } continue; }
    if (line.startsWith('#endif')) { const top = stack.pop(); if (cur && /^(EASY|MEDIUM|HARD|FIVEEASY|FIVEHARD)$/.test(top || '')) cur = null; continue; }
    if (!cur) continue;
    if ((m = line.match(/^\/\/\s*RFHS_CHALLENGE_NAME\s+"(.*)"\s*$/))) { cur.name = unstr('"' + m[1] + '"'); continue; }
    if ((m = line.match(/^\/\/\s*FOX_KEYWORDS\s+"(.*)"\s*$/))) { const k = unstr('"' + m[1] + '"').match(/'(.*)'/); cur.keyphrase = k ? k[1] : unstr('"' + m[1] + '"'); continue; }
    if ((m = line.match(/^#define\s+(\w+)\s*(.*?)\s*(?:\/\/.*)?$/))) { cur.values[m[1]] = m[2]; }
  }
  return blocks;
}

const unmac = s => { const b = [...String(s).matchAll(/0x([0-9a-fA-F]{2})/g)].map(x => parseInt(x[1], 16)); return b.length ? macText(b) : ''; };
const wifiPowerFrom = s => { const m = String(s).match(/WIFI_POWER_(MINUS_)?(\d+)(?:_(\d))?dBm/); if (!m) return null; const v = Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0); return m[1] ? -v : v; };
const blePowerFrom = s => { const m = String(s).match(/ESP_PWR_LVL_([NP])(\d+)/); return m ? (m[1] === 'N' ? -1 : 1) * Number(m[2]) : null; };

/** A parsed block as the fox.json sections for `templateId`, to merge over that template's defaults. */
export function cfgFromBlock(block, templateId) {
  const t = TEMPLATES[templateId]; if (!t) return null;
  const v = block.values, out = { challenge: { name: block.name, keyphrase: block.keyphrase, tier: block.tier }, schedule: { kind: 'duty' } };
  const num = s => { const n = Number(String(s).trim()); return Number.isFinite(n) ? n : undefined; };
  if ('TIME_TO_WAKE' in v) out.schedule.wake_s = num(v.TIME_TO_WAKE);
  if ('TIME_TO_SLEEP' in v) out.schedule.sleep_s = num(v.TIME_TO_SLEEP);
  if ('ADVERTISING_DURATION' in v) out.schedule.wake_s = num(v.ADVERTISING_DURATION);
  if ('GPIO_DEEP_SLEEP_DURATION' in v) out.schedule.sleep_s = num(v.GPIO_DEEP_SLEEP_DURATION);
  if (t.section === 'wifi') {
    out.wifi = {}; if ('FSSID' in v) out.wifi.ssid = unstr(v.FSSID); if ('PSK' in v) out.wifi.psk = unstr(v.PSK); if ('MAC_ADDR' in v) out.wifi.mac = unmac(v.MAC_ADDR);
    if ('TXPOWER' in v) { const p = wifiPowerFrom(v.TXPOWER); if (p != null) out.wifi.tx_power_dbm = p; }
    if (t.mode === 'AP') { if ('CHANNEL' in v) out.wifi.channel = num(v.CHANNEL); if ('SSID_HIDDEN' in v) out.wifi.hidden = num(v.SSID_HIDDEN) === 1; if ('MAX_CLIENTS' in v) out.wifi.max_clients = num(v.MAX_CLIENTS); out.wifi.band = block.five || (out.wifi.channel >= 36) ? '5' : '2.4'; }
  } else if (t.section === 'ble') {
    out.ble = {}; if ('DEVICE_NAME' in v) out.ble.device_name = unstr(v.DEVICE_NAME); if ('BEACON_UUID' in v) out.ble.uuid = unstr(v.BEACON_UUID).toLowerCase(); if ('MAJOR' in v) out.ble.major = num(v.MAJOR); if ('MINOR' in v) out.ble.minor = num(v.MINOR);
    if ('SIGNAL_POWER' in v) { const x = num(v.SIGNAL_POWER); if (x != null) out.ble.signal_power_dbm = x > 127 ? x - 256 : x; }
    if ('MAC_ADDR' in v) out.ble.mac = unmac(v.MAC_ADDR); if ('ADV_MIN_INTERVAL' in v) out.ble.adv_min = num(v.ADV_MIN_INTERVAL); if ('ADV_MAX_INTERVAL' in v) out.ble.adv_max = num(v.ADV_MAX_INTERVAL);
    if ('ADV_TX_POWER' in v) { const p = blePowerFrom(v.ADV_TX_POWER); if (p != null) out.ble.tx_power_dbm = p; }
  } else if (t.section === 'bt') {
    out.bt = {}; if ('NAME' in v) out.bt.name = unstr(v.NAME); if ('MAC_ADDR' in v) out.bt.mac = unmac(v.MAC_ADDR);
  } else if (t.section === 'zigbee') {
    out.zigbee = {}; if ('MAC_ADDR' in v) out.zigbee.mac = unmac(v.MAC_ADDR); if ('CHANNEL' in v) out.zigbee.channel = num(v.CHANNEL); if ('TXPOWER' in v) out.zigbee.tx_power_dbm = num(v.TXPOWER);
  }
  return out;
}

/** The line kitsune's make_conference_full prints for a fox (what goes on the kit sheet), from a config. */
export function sheetLines(cfg) {
  const t = TEMPLATES[cfg.template]; if (!t) return [];
  const sec = cfg[t.section] || {};
  const L = [`RFHS_CHALLENGE_NAME ${cfg.challenge.name}`, `FOX_KEYWORDS Hunter should ask '${cfg.challenge.keyphrase}'`];
  if (t.section === 'wifi') { L.push(`FSSID ${sec.ssid}`, `MAC_ADDR ${sec.mac}`); if (t.mode === 'AP') L.push(`CHANNEL ${sec.channel}`); }
  if (t.section === 'ble') L.push(`NAME ${sec.device_name}`, `UUID ${sec.uuid}`, `MAC_ADDR ${sec.mac}`);
  if (t.section === 'bt') L.push(`NAME ${sec.name}`, `MAC_ADDR ${sec.mac}`);
  if (t.section === 'zigbee') L.push(`MAC_ADDR ${sec.mac}`, `CHANNEL ${sec.channel}`);
  return L;
}

export const BOOT_OK = /Awake and screaming/;
export const BOOT_FATAL = /PANIC|Read MAC Address != Requested|Operating channel != Requested|Operating SSID != Requested|Error starting Zigbee/;
