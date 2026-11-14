// netschema.js — the configuration contract for network foxes (wifi-beacon, wifi-probe, ble-beacon), the JS twin of
// firmware/foxlib/netcfg.py: same keys checked in the same order, same reasons, same status words, held equal by
// firmware/sim/schema_parity.*. Plus the page-side checks (warnings) a validator does not make.
// SPDX-License-Identifier: GPL-2.0-only
import { randomMac } from './vendor/kitsune.js';

export const SCHEMA = 1;
export const WIFI24_CHANNELS = Array.from({ length: 13 }, (_, i) => i + 1);
export const WIFI5_CHANNELS = [36, 40, 44, 48, 149, 153, 157, 161, 165];
export const WIFI_POWER_DBM = [2, 5, 7, 8.5, 11, 13, 15, 17, 18.5, 19, 19.5];
export const BLE_POWER_DBM = [-12, -9, -6, -3, 0, 3, 6, 9];
export const MAX_NAME = 32, MAX_PSK = 63, PLACEHOLDER = 'N0CALL';
export const NET_PINS = ['led', 'batt_sense'];   // optional, both: a network fox has no module to wire
export { randomMac };

const isInt = v => Number.isInteger(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const blen = s => new TextEncoder().encode(String(s)).length;

/** 'F2:AB:..' → bytes, or null (6 for Wi-Fi/BLE); first byte unicast. */
export function parseMac(s, n = 6) {
  if (typeof s !== 'string') return null;
  const parts = s.replace(/-/g, ':').split(':'); if (parts.length !== n) return null;
  const out = parts.map(p => /^[0-9a-fA-F]{1,2}$/.test(p) ? parseInt(p, 16) : NaN);
  if (out.some(b => !Number.isInteger(b) || b < 0 || b > 255) || (out[0] & 1)) return null;
  return out;
}

/** Like Python's _intify: a float with an integral value is an int (JSON has one number type; the firmware sees both). */
const intify = v => v;

export function validate(user, defaults, board) {
  const cfg = structuredClone(defaults), report = [];
  const bad = (key, reason) => report.push({ key, reason });
  const u = user && typeof user === 'object' && !Array.isArray(user) ? user : {};
  const radios = board?.radios || null;
  if (u.schema !== undefined && u.schema !== SCHEMA) return { cfg, report: [{ key: 'schema', reason: `schema ${u.schema} not supported` }], fatal: null, status: 'default(schema)' };
  if (u.template !== undefined && u.template !== defaults.template) return { cfg, report: [{ key: 'template', reason: 'does not match firmware' }], fatal: null, status: 'default(template)' };
  if (u.board !== undefined && board && u.board !== board.id && u.board !== defaults.board) return { cfg, report: [{ key: 'board', reason: 'config is for another board' }], fatal: null, status: 'default(board)' };

  // variant (which physical board of this chip) and its pins: names the board module exposes, or null
  if ('variant' in u) { if (typeof u.variant === 'string' && u.variant.length >= 1 && u.variant.length <= 40) cfg.variant = u.variant; else bad('variant', 'string'); }
  const names = board?.pins ? new Set(board.pins.flatMap(p => [p.name, ...(p.aliases || [])])) : null;
  const pins = u.pins && typeof u.pins === 'object' ? u.pins : {};
  for (const role of NET_PINS) {
    if (!(role in pins)) continue;
    const v = pins[role];
    if (v === null || (typeof v === 'string' && (!names || names.has(v)))) (cfg.pins ??= {})[role] = v;
    else bad('pins.' + role, typeof v === 'string' ? `no pin ${v} on this board` : 'name or null');
  }
  for (const k of Object.keys(pins)) if (!NET_PINS.includes(k)) bad('pins.' + k, 'unknown role');

  const n = u.net && typeof u.net === 'object' ? u.net : {};
  const kind = cfg.net.kind;
  if ('kind' in n && n.kind !== kind) bad('net.kind', 'fixed by the template');
  if (kind === 'wifi-ap' || kind === 'wifi-probe') {
    if ('ssid' in n) { if (typeof n.ssid === 'string' && blen(n.ssid) >= 1 && blen(n.ssid) <= MAX_NAME) cfg.net.ssid = n.ssid; else bad('net.ssid', '1-32 bytes'); }
    if ('tx_power_dbm' in n) { if (isNum(n.tx_power_dbm) && WIFI_POWER_DBM.includes(n.tx_power_dbm)) cfg.net.tx_power_dbm = n.tx_power_dbm; else bad('net.tx_power_dbm', 'one of the Wi-Fi power steps'); }
  }
  if (kind === 'wifi-ap') {
    if ('psk' in n) { if (typeof n.psk === 'string' && (n.psk === '' || (blen(n.psk) >= 8 && blen(n.psk) <= MAX_PSK))) cfg.net.psk = n.psk; else bad('net.psk', 'empty (open) or 8-63 bytes'); }
    if ('channel' in n) {
      const band5 = !!radios && radios.includes('wifi5');
      if (isInt(n.channel) && (WIFI24_CHANNELS.includes(n.channel) || (band5 && WIFI5_CHANNELS.includes(n.channel)))) cfg.net.channel = n.channel; else bad('net.channel', '1-13' + (band5 ? ' or a 5 GHz channel' : ''));
    }
    if ('hidden' in n) { if (typeof n.hidden === 'boolean') cfg.net.hidden = n.hidden; else bad('net.hidden', 'bool'); }
    if ('max_clients' in n) { if (isInt(n.max_clients) && n.max_clients >= 1 && n.max_clients <= 8) cfg.net.max_clients = n.max_clients; else bad('net.max_clients', '1-8'); }
  }
  if (kind === 'ble') {
    if ('name' in n) { if (typeof n.name === 'string' && blen(n.name) >= 1 && blen(n.name) <= MAX_NAME) cfg.net.name = n.name; else bad('net.name', '1-32 bytes'); }
    if ('uuid' in n) {
      const s = typeof n.uuid === 'string' ? n.uuid : '', h = s.replace(/-/g, '');
      if (h.length === 32 && /^[0-9a-fA-F]+$/.test(h) && s.split('-').map(p => p.length).join() === '8,4,4,4,12') cfg.net.uuid = s.toUpperCase(); else bad('net.uuid', '8-4-4-4-12 hex');
    }
    for (const k of ['major', 'minor']) if (k in n) { if (isInt(n[k]) && n[k] >= 0 && n[k] <= 65535) cfg.net[k] = n[k]; else bad('net.' + k, '0-65535'); }
    if ('signal_power_dbm' in n) { if (isInt(n.signal_power_dbm) && n.signal_power_dbm >= -128 && n.signal_power_dbm <= 0) cfg.net.signal_power_dbm = n.signal_power_dbm; else bad('net.signal_power_dbm', '-128-0'); }
    for (const k of ['adv_min', 'adv_max']) if (k in n) { if (isInt(n[k]) && n[k] >= 20 && n[k] <= 10240) cfg.net[k] = n[k]; else bad('net.' + k, '20-10240 ms'); }
    if (cfg.net.adv_min > cfg.net.adv_max) { bad('net.adv_min', '<= adv_max'); cfg.net.adv_min = cfg.net.adv_max; }
    if ('tx_power_dbm' in n) { if (isInt(n.tx_power_dbm) && BLE_POWER_DBM.includes(n.tx_power_dbm)) cfg.net.tx_power_dbm = n.tx_power_dbm; else bad('net.tx_power_dbm', 'one of the BLE power steps'); }
  }
  if ('mac' in n) { if (parseMac(n.mac)) cfg.net.mac = n.mac.toUpperCase().replace(/-/g, ':'); else bad('net.mac', '6 hex bytes, unicast'); }
  for (const k of Object.keys(n)) if (!(k in cfg.net)) bad('net.' + k, 'unknown');

  const i = u.id && typeof u.id === 'object' ? u.id : {};
  if ('callmessage' in i) { if (typeof i.callmessage === 'string' && blen(i.callmessage) >= 1 && blen(i.callmessage) <= 64) cfg.id.callmessage = i.callmessage; else bad('id.callmessage', '1-64 chars'); }
  if ('use_callsign_as_name' in i) { if (typeof i.use_callsign_as_name === 'boolean') cfg.id.use_callsign_as_name = i.use_callsign_as_name; else bad('id.use_callsign_as_name', 'bool'); }
  if (cfg.id.use_callsign_as_name && blen(cfg.id.callmessage) > MAX_NAME) { bad('id.callmessage', 'over 32 bytes for a network name'); cfg.id.use_callsign_as_name = false; }

  const s = u.schedule && typeof u.schedule === 'object' ? u.schedule : {};
  if ('kind' in s && s.kind !== 'duty') bad('schedule.kind', 'duty');
  for (const [k, lo, hi] of [['wake_s', 1, 3600], ['sleep_s', 0, 86400]]) if (k in s) { if (isInt(s[k]) && s[k] >= lo && s[k] <= hi) cfg.schedule[k] = s[k]; else bad('schedule.' + k, `${lo}-${hi}`); }
  if ('sleep' in s) { if (s.sleep === 'off' || s.sleep === 'deep') cfg.schedule.sleep = s.sleep; else bad('schedule.sleep', 'off|deep'); }

  // contest features (docs/network-fox-payloads-plan.md): optional sections, each from FEATURE_DEFAULTS when the
  // defaults file lacks it; same checks and order as netcfg._validate_feature
  for (const sec of FEATURES) {
    if (!(sec in u)) continue;
    if (!u[sec] || typeof u[sec] !== 'object' || Array.isArray(u[sec])) { bad(sec, 'object'); continue; }
    const base = cfg[sec] && typeof cfg[sec] === 'object' ? cfg[sec] : structuredClone(FEATURE_DEFAULTS[sec]);
    cfg[sec] = base;
    validateFeature(sec, u[sec], base, bad, radios);
  }

  const l = u.led && typeof u.led === 'object' ? u.led : {};
  if ('enabled' in l) { if (typeof l.enabled === 'boolean') cfg.led.enabled = l.enabled; else bad('led.enabled', 'bool'); }
  if (u.fleet && typeof u.fleet === 'object') for (const [k, v] of Object.entries(u.fleet)) if (k in cfg.fleet && (v === null || typeof v === 'string' || typeof v === 'number')) cfg.fleet[k] = v;

  const status = report.length ? `partial(${report.map(x => x.key).join(',')})` : 'ok';
  return { cfg, report, fatal: null, status };
}

export const FEATURES = ['payload', 'checkpoint', 'sense', 'stealth'];
export const FEATURE_DEFAULTS = {
  payload: { enabled: false, kind: 'static', names: [], morse_of: '', code: { major: 0, minor: 0 }, eddystone: { url: '', tlm: false }, split: { wifi: '', ble: '' }, interleave_ms: 1000 },
  checkpoint: { enabled: false,
    portal: { enabled: false, title: '', body: '', code: '', ask_callsign: true, captive_dns: true, log: true },
    ble: { enabled: false, service_uuid: 'F0B0F0B0-0000-4000-8000-0000000000C0', code: '' } },
  sense: { enabled: false, slot_ms: 1000,
    tags: { enabled: false, match: 'HUNT-', log: true, rssi_min: -80 },
    relay: { enabled: false, wait_for: '', then: 'up' },
    probes: { enabled: false, channel: 6, window_s: 2 } },
  stealth: { enabled: false, rotate_mac: false, rotate_name: false, duty_jitter_s: 0, start: { after_s: 0, at: '' }, decoys: [], ble_only: false },
};
export const MAX_NAMES = 16, MAX_DECOYS = 4, MAX_BODY = 512, MAX_URL = 64, MAX_CODE = 16;
/** Which foxlib first runs each section (the page says "accepted, not built" until then). */
export const FEATURE_PHASE = { payload: 'B', stealth: 'C', checkpoint: 'D', sense: 'E' };

const strMax = (v, n) => typeof v === 'string' && blen(v) <= n;
const namesOk = (v, n, each) => Array.isArray(v) && v.length <= n && v.every(x => typeof x === 'string' && blen(x) >= 1 && blen(x) <= each);
const uuidOk = s => typeof s === 'string' && s.split('-').map(p => p.length).join() === '8,4,4,4,12' && /^[0-9a-fA-F-]+$/.test(s);
const isoOrEmpty = v => typeof v === 'string' && (v === '' || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) && v.length <= 32));
const isBool = x => typeof x === 'boolean';

function validateFeature(sec, u, cfg, bad, radios) {
  const key = (path, ok, reason, val) => { if (ok) { const parts = path.split('.'); let d = cfg; for (const p of parts.slice(0, -1)) d = d[p]; d[parts.at(-1)] = val; } else bad(sec + '.' + path, reason); };
  const sub = (name, spec) => {
    if (!(name in u)) return;
    const v = u[name];
    if (!v || typeof v !== 'object' || Array.isArray(v)) { bad(sec + '.' + name, 'object'); return; }
    for (const [k, [test, reason]] of Object.entries(spec)) if (k in v) key(name + '.' + k, test(v[k]), reason, v[k]);
    for (const k of Object.keys(v)) if (!(k in spec)) bad(sec + '.' + name + '.' + k, 'unknown');
  };
  const plain = (k, test, reason) => { if (k in u) key(k, test(u[k]), reason, u[k]); };
  const known = new Set(['enabled']);
  plain('enabled', isBool, 'bool');
  if (sec === 'payload') {
    for (const k of ['kind', 'names', 'morse_of', 'code', 'eddystone', 'split', 'interleave_ms']) known.add(k);
    plain('kind', x => ['static', 'rotate', 'morse-name'].includes(x), 'static|rotate|morse-name');
    plain('names', x => namesOk(x, MAX_NAMES, MAX_NAME), `up to ${MAX_NAMES} names of 1-${MAX_NAME} bytes`);
    plain('morse_of', x => strMax(x, 16), '<= 16 chars');
    sub('code', { major: [x => isInt(x) && x >= 0 && x <= 65535, '0-65535'], minor: [x => isInt(x) && x >= 0 && x <= 65535, '0-65535'] });
    sub('eddystone', { url: [x => strMax(x, MAX_URL) && (x === '' || x.startsWith('http://') || x.startsWith('https://')), `http(s) URL <= ${MAX_URL} chars`], tlm: [isBool, 'bool'] });
    sub('split', { wifi: [x => strMax(x, MAX_NAME), '<= 32 bytes'], ble: [x => strMax(x, 29), '<= 29 bytes'] });
    plain('interleave_ms', x => isInt(x) && x >= 100 && x <= 10000, '100-10000 ms');
    if (cfg.kind === 'rotate' && !cfg.names.length) { bad(sec + '.names', 'rotate needs at least one name'); cfg.kind = 'static'; }
  } else if (sec === 'checkpoint') {
    for (const k of ['portal', 'ble']) known.add(k);
    sub('portal', { enabled: [isBool, 'bool'], title: [x => strMax(x, 40), '<= 40 bytes'], body: [x => strMax(x, MAX_BODY), `<= ${MAX_BODY} bytes`], code: [x => strMax(x, MAX_CODE), `<= ${MAX_CODE} chars`],
      ask_callsign: [isBool, 'bool'], captive_dns: [isBool, 'bool'], log: [isBool, 'bool'] });
    sub('ble', { enabled: [isBool, 'bool'], service_uuid: [uuidOk, '8-4-4-4-12 hex'], code: [x => strMax(x, MAX_CODE), `<= ${MAX_CODE} chars`] });
    if (cfg.portal.enabled && radios && !radios.includes('wifi24')) { bad(sec + '.portal.enabled', 'no Wi-Fi radio'); cfg.portal.enabled = false; }
  } else if (sec === 'sense') {
    for (const k of ['slot_ms', 'tags', 'relay', 'probes']) known.add(k);
    plain('slot_ms', x => isInt(x) && x >= 200 && x <= 5000, '200-5000 ms');
    sub('tags', { enabled: [isBool, 'bool'], match: [x => typeof x === 'string' && blen(x) >= 1 && blen(x) <= 16, '1-16 bytes'], log: [isBool, 'bool'], rssi_min: [x => isInt(x) && x >= -100 && x <= 0, '-100-0'] });
    sub('relay', { enabled: [isBool, 'bool'], wait_for: [x => strMax(x, MAX_NAME), '<= 32 bytes'], then: [x => ['up', 'down', 'rotate'].includes(x), 'up|down|rotate'] });
    sub('probes', { enabled: [isBool, 'bool'], channel: [x => isInt(x) && x >= 1 && x <= 13, '1-13'], window_s: [x => isInt(x) && x >= 1 && x <= 10, '1-10 s'] });
    if (cfg.relay.enabled && !cfg.relay.wait_for) { bad(sec + '.relay.wait_for', 'relay needs a network name'); cfg.relay.enabled = false; }
  } else if (sec === 'stealth') {
    for (const k of ['rotate_mac', 'rotate_name', 'duty_jitter_s', 'start', 'decoys', 'ble_only']) known.add(k);
    plain('rotate_mac', x => x === false || ['per-cycle', 'per-boot'].includes(x), 'false|per-cycle|per-boot');
    plain('rotate_name', isBool, 'bool');
    plain('duty_jitter_s', x => isInt(x) && x >= 0 && x <= 300, '0-300 s');
    sub('start', { after_s: [x => isInt(x) && x >= 0 && x <= 86400, '0-86400 s'], at: [isoOrEmpty, 'YYYY-MM-DDTHH:MM:SS[zone] or empty'] });
    plain('decoys', x => namesOk(x, MAX_DECOYS, MAX_NAME), `up to ${MAX_DECOYS} names of 1-${MAX_NAME} bytes`);
    plain('ble_only', isBool, 'bool');
    if (cfg.ble_only && radios && !radios.includes('ble')) { bad(sec + '.ble_only', 'no BLE radio'); cfg.ble_only = false; }
  }
  for (const k of Object.keys(u)) if (!known.has(k)) bad(sec + '.' + k, 'unknown');
}

/** The feature sections switched on in a validated cfg, in contract order. */
export const enabledFeatures = cfg => FEATURES.filter(s => cfg[s] && typeof cfg[s] === 'object' && cfg[s].enabled);

export const idOk = cfg => !cfg.id.callmessage.includes(PLACEHOLDER);
export const displayName = cfg => cfg.id.use_callsign_as_name ? cfg.id.callmessage.slice(0, MAX_NAME) : (cfg.net.ssid ?? cfg.net.name ?? '');

/** Page checks: what the firmware accepts but the operator should know. Same shape as pageChecks(). */
export function checks(cfg, board, { clockSet = false } = {}) {
  const issues = [];
  const radios = board?.radios || [];
  // contest features: what the firmware accepts but would not work as a fox
  const cp = cfg.checkpoint, se = cfg.sense, st = cfg.stealth, pl = cfg.payload;
  if (cp?.enabled && cp.portal?.enabled && cfg.net.kind !== 'wifi-ap') issues.push({ level: 'err', key: 'checkpoint.portal.enabled', msg: 'a sign-in page needs the fox to be an access point (the wifi-beacon template)' });
  if (cp?.enabled && cp.portal?.enabled && cfg.schedule.sleep === 'deep') issues.push({ level: 'err', key: 'checkpoint.portal.enabled', msg: 'deep sleep would drop a hunter mid-page: use "radio off" between wakes with a sign-in page' });
  if (cp?.enabled && cp.portal?.enabled && cfg.net.psk) issues.push({ level: 'warn', key: 'net.psk', msg: 'a sign-in page on a password-protected network: hunters would need the PSK first (open is the usual choice)' });
  if (cp?.enabled && cp.ble?.enabled && !radios.includes('ble') && radios.length) issues.push({ level: 'err', key: 'checkpoint.ble.enabled', msg: `${board.name} has no BLE radio` });
  if (cp?.enabled && !cp.portal?.enabled && !cp.ble?.enabled) issues.push({ level: 'warn', key: 'checkpoint.enabled', msg: 'checkpoint is on but neither the sign-in page nor the BLE service is' });
  if (se?.enabled && se.tags?.enabled && !radios.includes('ble') && radios.length) issues.push({ level: 'err', key: 'sense.tags.enabled', msg: `${board.name} has no BLE radio to hear tags with` });
  if (se?.enabled && se.tags?.enabled) issues.push({ level: 'info', key: 'sense.tags.enabled', msg: 'needs one BLE tag per team, named ' + (se.tags.match || 'HUNT-') + '<team>' });
  if (se?.enabled && (se.probes?.enabled || se.relay?.enabled) && !radios.includes('wifi24') && radios.length) issues.push({ level: 'err', key: 'sense.enabled', msg: `${board.name} has no Wi-Fi radio` });
  if (se?.enabled && cfg.schedule.sleep === 'deep') issues.push({ level: 'warn', key: 'sense.enabled', msg: 'listening happens only while awake; with deep sleep the fox hears nothing between wakes' });
  if (se?.enabled && !se.tags?.enabled && !se.relay?.enabled && !se.probes?.enabled) issues.push({ level: 'warn', key: 'sense.enabled', msg: 'sense is on but nothing is being listened for' });
  if (st?.enabled && st.start?.at && !clockSet) issues.push({ level: 'err', key: 'stealth.start.at', msg: 'a start time needs the board clock set at deploy: tick "Set the board clock" on the Deploy tab' });
  if (st?.enabled && st.start?.at && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(st.start.at)) issues.push({ level: 'warn', key: 'stealth.start.at', msg: 'no time zone on the start time: it is read as the board clock\'s zone (the zone the clock was set in)' });
  if (st?.enabled && st.ble_only && cfg.net.kind !== 'ble') issues.push({ level: 'err', key: 'stealth.ble_only', msg: 'BLE only with a Wi-Fi template: the fox would never transmit' });
  if (st?.enabled && st.decoys?.length && cfg.net.kind !== 'wifi-ap') issues.push({ level: 'warn', key: 'stealth.decoys', msg: 'decoy names are SSIDs: they need the access-point template' });
  if (st?.enabled && st.rotate_name && !(pl?.enabled && pl.kind === 'rotate' && pl.names?.length)) issues.push({ level: 'warn', key: 'stealth.rotate_name', msg: 'names at random needs a list of names in the payload section (kind rotate)' });
  if (pl?.enabled && pl.kind === 'morse-name' && !pl.morse_of) issues.push({ level: 'err', key: 'payload.morse_of', msg: 'morse-name needs a word' });
  if (pl?.enabled && (pl.eddystone?.url || pl.eddystone?.tlm || pl.code?.major || pl.code?.minor) && cfg.net.kind !== 'ble') issues.push({ level: 'warn', key: 'payload.eddystone', msg: 'beacon code, Eddystone URL and telemetry are BLE frames: they need the ble-beacon template' });
  if (pl?.enabled && (pl.split?.wifi || pl.split?.ble) && !(radios.includes('wifi24') && radios.includes('ble'))) issues.push({ level: 'err', key: 'payload.split', msg: 'a split clue needs both radios' });
  if (cfg.net.kind === 'wifi-ap' && cfg.net.hidden) issues.push({ level: 'warn', key: 'net.hidden', msg: 'this firmware cannot hide the SSID (CircuitPython has no hidden-AP option): it will be broadcast; the fox says so in its banner' });
  if (cfg.net.kind === 'wifi-ap' && cfg.net.psk === '') issues.push({ level: 'info', key: 'net.psk', msg: 'open network: anyone can join (max_clients caps it); a PSK of 8+ characters makes it WPA2' });
  if ((cfg.net.kind === 'wifi-ap' || cfg.net.kind === 'wifi-probe') && !radios.includes('wifi24') && radios.length) issues.push({ level: 'err', key: 'net.kind', msg: `${board.name} has no Wi-Fi radio` });
  if (cfg.net.kind === 'ble' && !radios.includes('ble') && radios.length) issues.push({ level: 'err', key: 'net.kind', msg: `${board.name} has no BLE radio` });
  if (cfg.net.kind === 'wifi-ap' && WIFI5_CHANNELS.includes(cfg.net.channel)) issues.push({ level: 'warn', key: 'net.channel', msg: '5 GHz: only a 5 GHz-capable phone sees it, and CircuitPython\'s 5 GHz AP support on this chip is unverified' });
  if (cfg.schedule.sleep === 'deep') issues.push({ level: 'info', key: 'schedule.sleep', msg: `deep sleep: the USB port disappears for ${cfg.schedule.sleep_s} s each cycle (Listen only reconnects when it returns); a power bank with auto-off will cut the fox off` });
  if (!idOk(cfg)) issues.push({ level: 'err', key: 'id.callmessage', msg: 'callsign / operator not set (N0CALL placeholder)' });
  if (cfg.id.use_callsign_as_name && !/^[A-Z0-9]{3,}/.test(cfg.id.callmessage)) issues.push({ level: 'info', key: 'id.use_callsign_as_name', msg: 'the name on the air is the callsign field as typed' });
  return issues;
}

/** The duty cycle as a timeline for the Schedule tab's preview: [{t, kind:'tx'|'off', dur}] in ms up to horizonMs. */
export function cycle(cfg, horizonMs = 600000) {
  const items = []; let t = 0;
  const wake = cfg.schedule.wake_s * 1000, sleep = cfg.schedule.sleep_s * 1000;
  while (t < horizonMs) { items.push({ t, kind: 'tx', dur: wake }); t += wake; if (sleep > 0) { items.push({ t, kind: cfg.schedule.sleep === 'deep' ? 'sleep' : 'off', dur: sleep }); t += sleep; } }
  return items;
}

/** The files a deploy writes: fox.json compact, like the FM family. */
export function stringify(cfg) { return JSON.stringify(cfg); }
