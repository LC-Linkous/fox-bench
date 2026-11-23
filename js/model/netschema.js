// netschema.js — the configuration contract for network foxes (wifi-beacon, wifi-probe, ble-beacon), the JS twin of
// firmware/foxlib/netcfg.py: same keys checked in the same order, same reasons, same status words, held equal by
// firmware/sim/schema_parity.*. Plus the page-side checks (warnings) a validator does not make.
// SPDX-License-Identifier: GPL-2.0-only

export const SCHEMA = 1;
export const WIFI24_CHANNELS = Array.from({ length: 13 }, (_, i) => i + 1);
export const WIFI5_CHANNELS = [36, 40, 44, 48, 149, 153, 157, 161, 165];
export const WIFI_POWER_DBM = [2, 5, 7, 8.5, 11, 13, 15, 17, 18.5, 19, 19.5];
export const BLE_POWER_DBM = [-12, -9, -6, -3, 0, 3, 6, 9];
export const MAX_PROBE_SSIDS = 8;
export const MODE_KINDS = ['wifi-ap', 'wifi-probe', 'ble'];
export const MAX_IDENTITIES = 8;
const modesOk = (x, radios) => Array.isArray(x) && new Set(x).size === x.length && x.length !== 1 && x.length <= 3 && x.every(k => MODE_KINDS.includes(k))
  && (!radios || x.every(k => k === 'ble' ? radios.includes('ble') : radios.includes('wifi24')));
const shellGameOk = x => {
  if (x === null) return true;
  if (!x || typeof x !== 'object' || Object.keys(x).sort().join() !== 'identities,index,period_s') return false;
  const ids = x.identities;
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > MAX_IDENTITIES) return false;
  for (const i of ids) {
    if (!i || typeof i !== 'object' || Object.keys(i).sort().join() !== 'mac,name' || typeof i.name !== 'string' || blen(i.name) < 1 || blen(i.name) > MAX_NAME) return false;
    if (i.mac !== null && !parseMac(i.mac)) return false;
  }
  return isInt(x.period_s) && x.period_s >= 60 && x.period_s <= 86400 && isInt(x.index) && x.index >= 0 && x.index < ids.length;
};
/** The 2.4 GHz channels a region allows an access point: what `channels: "any"` means on the page (the validator's "any" is the 1–11 everyone shares). */
export const WIFI24_BY_REGION = { US: WIFI24_CHANNELS.slice(0, 11), EU: WIFI24_CHANNELS.slice(0, 13) };
export const TLM_FIELDS = { batt_mv: [0, 65535], temp_c: [-128, 127.99], count: [0, 4294967295], uptime_s: [0, 429496729] };
const tlmDataOk = x => !!x && typeof x === 'object' && !Array.isArray(x) && Object.entries(x).every(([k, v]) => k in TLM_FIELDS && isNum(v) && v >= TLM_FIELDS[k][0] && v <= TLM_FIELDS[k][1]);
const variablePowerOk = (x, kind) => {
  if (x === null) return true;
  if (!x || typeof x !== 'object' || Object.keys(x).sort().join() !== 'max_dbm,min_dbm,per,slot_s') return false;
  const steps = kind === 'ble' ? BLE_POWER_DBM : WIFI_POWER_DBM;
  return isNum(x.min_dbm) && isNum(x.max_dbm) && steps.includes(x.min_dbm) && steps.includes(x.max_dbm) && x.min_dbm < x.max_dbm && ['wake', 'slot'].includes(x.per) && isInt(x.slot_s) && x.slot_s >= 2 && x.slot_s <= 600;
};
export const MAX_NAME = 32, MAX_PSK = 63, PLACEHOLDER = 'N0CALL';
export const NET_PINS = ['led', 'batt_sense'];   // optional, both: a network fox has no module to wire
/** A fresh locally administered unicast MAC, F2:xx:xx:xx:xx:xx — the prefix every fox's spoofed address starts with. */
export function randomMac(bytes = 6) {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b); b[0] = 0xF2;
  return [...b].map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

const isInt = v => Number.isInteger(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const blen = s => new TextEncoder().encode(String(s)).length;

/** 'F2:AB:..' → bytes, or null (6 for Wi-Fi/BLE); first byte unicast. */
const URL_SCHEMES = [['http://www.', 0], ['https://www.', 1], ['http://', 2], ['https://', 3]];
const URL_CODES = ['.com/', '.org/', '.edu/', '.net/', '.info/', '.biz/', '.gov/', '.com', '.org', '.edu', '.net', '.info', '.biz', '.gov'];
/** Bytes the URL takes in an Eddystone-URL frame after its scheme byte (foxlib/netpayload.py encode_url, which sends
 *  nothing over 17), or null when no scheme matches. */
export function eddystoneUrlBytes(url) {
  const sch = URL_SCHEMES.find(([p]) => url.startsWith(p));
  if (!sch) return null;
  let rest = url.slice(sch[0].length), n = 0;
  while (rest.length) {
    const c = URL_CODES.find(c => rest.startsWith(c));
    if (c) { n += 1; rest = rest.slice(c.length); } else { n += blen(rest[0]); rest = rest.slice(1); }
  }
  return n;
}

/** The address a BLE fox is on the air with for a configured MAC: the same, with the two top bits set (a static random
 *  address; foxlib/netradio.py does the same). */
export function bleMac(mac) {
  const b = parseMac(mac);
  if (!b) return mac;
  return [b[0] | 0xC0, ...b.slice(1)].map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

export function parseMac(s, n = 6) {
  if (typeof s !== 'string') return null;
  const parts = s.replace(/-/g, ':').split(':'); if (parts.length !== n) return null;
  const out = parts.map(p => /^[0-9a-fA-F]{1,2}$/.test(p) ? parseInt(p, 16) : NaN);
  if (out.some(b => !Number.isInteger(b) || b < 0 || b > 255) || (out[0] & 1)) return null;
  return out;
}

/** Like Python's _intify: a float with an integral value is an int (JSON has one number type; the firmware sees both). */

// ---- variant (which physical board of this chip) and its pins
function validateVariantAndPins(ctx) {
  const { cfg, u, board, bad } = ctx;
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
}

// ---- net: the radio section for the template's kind (wifi-ap, wifi-probe, ble) and the MAC
function validateNet(ctx) {
  const { cfg, u, radios, bad } = ctx;
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
    if (!('channels' in cfg.net)) cfg.net.channels = [];
    if ('channels' in n) {
      const band5 = !!radios && radios.includes('wifi5'), v = n.channels;
      if (v === 'any') cfg.net.channels = WIFI24_CHANNELS.slice(0, 11);           // the channels every region allows
      else if (Array.isArray(v) && v.length <= 13 && new Set(v).size === v.length && v.every(x => isInt(x) && (WIFI24_CHANNELS.includes(x) || (band5 && WIFI5_CHANNELS.includes(x))))) cfg.net.channels = v.slice();
      else bad('net.channels', '"any" or up to 13 distinct channels');
    }
    if ('hidden' in n) { if (typeof n.hidden === 'boolean') cfg.net.hidden = n.hidden; else bad('net.hidden', 'bool'); }
    if ('max_clients' in n) { if (isInt(n.max_clients) && n.max_clients >= 1 && n.max_clients <= 8) cfg.net.max_clients = n.max_clients; else bad('net.max_clients', '1-8'); }
  }
  if (kind === 'wifi-probe') {
    if (!('probe_ssids' in cfg.net)) cfg.net.probe_ssids = [];
    if (!('probe_ssid_s' in cfg.net)) cfg.net.probe_ssid_s = 0;
    if ('probe_ssids' in n) { if (namesOk(n.probe_ssids, MAX_PROBE_SSIDS, MAX_NAME) && new Set(n.probe_ssids).size === n.probe_ssids.length) cfg.net.probe_ssids = n.probe_ssids.slice(); else bad('net.probe_ssids', `up to ${MAX_PROBE_SSIDS} distinct names of 1-${MAX_NAME} bytes`); }
    if ('probe_ssid_s' in n) { if (isInt(n.probe_ssid_s) && n.probe_ssid_s >= 0 && n.probe_ssid_s <= 600) cfg.net.probe_ssid_s = n.probe_ssid_s; else bad('net.probe_ssid_s', '0-600 s'); }
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
}

// ---- id: callmessage and whether it is the name on the air
function validateId(ctx) {
  const { cfg, u, bad } = ctx;
  const i = u.id && typeof u.id === 'object' ? u.id : {};
  if ('callmessage' in i) { if (typeof i.callmessage === 'string' && blen(i.callmessage) >= 1 && blen(i.callmessage) <= 64) cfg.id.callmessage = i.callmessage; else bad('id.callmessage', '1-64 chars'); }
  if ('use_callsign_as_name' in i) { if (typeof i.use_callsign_as_name === 'boolean') cfg.id.use_callsign_as_name = i.use_callsign_as_name; else bad('id.use_callsign_as_name', 'bool'); }
  if (cfg.id.use_callsign_as_name && blen(cfg.id.callmessage) > MAX_NAME) { bad('id.callmessage', 'over 32 bytes for a network name'); cfg.id.use_callsign_as_name = false; }
}

// ---- schedule: duty cycle and off|deep sleep
function validateSchedule(ctx) {
  const { cfg, u, bad } = ctx;
  const s = u.schedule && typeof u.schedule === 'object' ? u.schedule : {};
  if ('kind' in s && s.kind !== 'duty') bad('schedule.kind', 'duty');
  for (const [k, lo, hi] of [['wake_s', 1, 3600], ['sleep_s', 0, 86400]]) if (k in s) { if (isInt(s[k]) && s[k] >= lo && s[k] <= hi) cfg.schedule[k] = s[k]; else bad('schedule.' + k, `${lo}-${hi}`); }
  if ('sleep' in s) { if (s.sleep === 'off' || s.sleep === 'deep') cfg.schedule.sleep = s.sleep; else bad('schedule.sleep', 'off|deep'); }
}

// ---- contest features: payload, checkpoint, sense, stealth; deep sleep refused while a portal is on
function validateContestFeatures(ctx) {
  const { cfg, u, radios, bad } = ctx;
  // contest features (docs/network-fox-payloads-plan.md): optional sections, each from FEATURE_DEFAULTS when the
  // defaults file lacks it; same checks and order as netcfg._validate_feature
  for (const sec of FEATURES) {
    if (!(sec in u)) continue;
    if (!u[sec] || typeof u[sec] !== 'object' || Array.isArray(u[sec])) { bad(sec, 'object'); continue; }
    const base = cfg[sec] && typeof cfg[sec] === 'object' ? cfg[sec] : structuredClone(FEATURE_DEFAULTS[sec]);
    cfg[sec] = base;
    validateFeature(sec, u[sec], base, bad, radios, cfg.net.kind);
  }
  const cpv = cfg.checkpoint;
  if (cpv && cpv.enabled && cpv.portal.enabled && cfg.schedule.sleep === 'deep') { bad('schedule.sleep',
    'deep sleep would drop a hunter mid-page; off'); cfg.schedule.sleep = 'off'; }
}

// ---- led, fleet
function validateLedAndFleet(ctx) {
  const { cfg, u, bad } = ctx;
  const l = u.led && typeof u.led === 'object' ? u.led : {};
  if ('enabled' in l) { if (typeof l.enabled === 'boolean') cfg.led.enabled = l.enabled; else bad('led.enabled', 'bool'); }
  if (u.fleet && typeof u.fleet === 'object') for (const [k, v] of Object.entries(u.fleet)) if ((k in cfg.fleet || k === 'owner' || k === 'points_to') && (v === null || typeof v === 'string' || typeof v === 'number')) cfg.fleet[k] = v;
}

export function validate(user, defaults, board) {
  const cfg = structuredClone(defaults), report = [];
  const bad = (key, reason) => report.push({ key, reason });
  const u = user && typeof user === 'object' && !Array.isArray(user) ? user : {};
  const radios = board?.radios || null;
  if (u.schema !== undefined && u.schema !== SCHEMA) return {cfg, report: [{ key: 'schema', reason: `schema ${u.schema} not supported` }],
    fatal: null, status: 'default(schema)'};
  if (u.template !== undefined && u.template !== defaults.template) return {cfg,
    report: [{ key: 'template', reason: 'does not match firmware' }], fatal: null, status: 'default(template)'};
  if (u.board !== undefined && board && u.board !== board.id && u.board !== defaults.board) return {cfg,
    report: [{ key: 'board', reason: 'config is for another board' }], fatal: null, status: 'default(board)'};

  // one object carries what every section reads and writes: the sections are the functions above, in CONFIG.md's order
  const ctx = { cfg, u, defaults, board, radios, bad, report };
  validateVariantAndPins(ctx);
  validateNet(ctx);
  validateId(ctx);
  validateSchedule(ctx);
  validateContestFeatures(ctx);
  validateLedAndFleet(ctx);

  const status = report.length ? `partial(${report.map(x => x.key).join(',')})` : 'ok';
  return { cfg, report, fatal: null, status };
}

export const FEATURES = ['payload', 'checkpoint', 'sense', 'stealth'];
export const FEATURE_DEFAULTS = {
  payload: {enabled: false, kind: 'static', names: [], morse_of: '', code: { major: 0, minor: 0 },
    eddystone: { url: '', tlm: false, tlm_data: {} }, split: { wifi: '', ble: '' }, interleave_ms: 1000},
  checkpoint: { enabled: false, stop_at: '',
    portal: { enabled: false, title: '', body: '', code: '', ask_callsign: true, captive_dns: true, log: true },
    ble: { enabled: false, service_uuid: 'F0B0F0B0-0000-4000-8000-0000000000C0', code: '' } },
  sense: { enabled: false, slot_ms: 1000,
    tags: { enabled: false, match: 'HUNT-', log: true, rssi_min: -80 },
    relay: { enabled: false, wait_for: '', then: 'up' },
    honeypot: { enabled: false, log: true, probes: false, window_s: 2 },
    crowd: { enabled: false, max: 8, quiet_s: 120, rssi_min: -75 } },
  stealth: {enabled: false, rotate_mac: false, rotate_name: false, duty_jitter_s: 0, start: { after_s: 0, at: '' }, decoys: [],
    ble_only: false, variable_power: null, modes: [], modes_random: false, shell_game: null},
};
export const MAX_NAMES = 16, MAX_DECOYS = 4, MAX_BODY = 512, MAX_URL = 64, MAX_CODE = 16;
/** Which foxlib first runs each section (the page says "accepted, not built" until then). */
export const FEATURE_PHASE = { payload: 'B', stealth: 'C', checkpoint: 'D', sense: 'E' };

const strMax = (v, n) => typeof v === 'string' && blen(v) <= n;
const namesOk = (v, n, each) => Array.isArray(v) && v.length <= n && v.every(x => typeof x === 'string' && blen(x) >= 1 && blen(x) <= each);
const uuidOk = s => typeof s === 'string' && s.split('-').map(p => p.length).join() === '8,4,4,4,12' && /^[0-9a-fA-F-]+$/.test(s);
const isoOrEmpty = v => typeof v === 'string' && (v === '' || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) && v.length <= 32));
const isBool = x => typeof x === 'boolean';

function validateFeature(sec, u, cfg, bad, radios, kind = null) {
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
    sub('eddystone', { url: [x => strMax(x, MAX_URL) && (x === '' || x.startsWith('http://') || x.startsWith('https://')),
      `must start with http:// or https:// (a missing ':' or '/' is the usual slip), <= ${MAX_URL} chars`], tlm: [isBool, 'bool'],
      tlm_data: [tlmDataOk, 'batt_mv 0-65535, temp_c -128-127, count / uptime_s unsigned 32-bit'] });
    sub('split', { wifi: [x => strMax(x, MAX_NAME), '<= 32 bytes'], ble: [x => strMax(x, 29), '<= 29 bytes'] });
    plain('interleave_ms', x => isInt(x) && x >= 100 && x <= 10000, '100-10000 ms');
    if (cfg.kind === 'rotate' && !cfg.names.length) { bad(sec + '.names', 'rotate needs at least one name'); cfg.kind = 'static'; }
  } else if (sec === 'checkpoint') {
    for (const k of ['portal', 'ble', 'stop_at']) known.add(k);
    plain('stop_at', isoOrEmpty, 'YYYY-MM-DDTHH:MM:SS[zone] or empty');
    sub('portal', { enabled: [isBool, 'bool'], title: [x => strMax(x, 40), '<= 40 bytes'], body: [x => strMax(x, MAX_BODY), `<= ${MAX_BODY} bytes`], code: [x => strMax(x, MAX_CODE), `<= ${MAX_CODE} chars`],
      ask_callsign: [isBool, 'bool'], captive_dns: [isBool, 'bool'], log: [isBool, 'bool'] });
    sub('ble',
      { enabled: [isBool, 'bool'], service_uuid: [uuidOk, '8-4-4-4-12 hex'], code: [x => strMax(x, MAX_CODE), `<= ${MAX_CODE} chars`] });
    if (cfg.portal.enabled && radios && !radios.includes('wifi24')) { bad(sec + '.portal.enabled', 'no Wi-Fi radio'); cfg.portal.enabled = false; }
  } else if (sec === 'sense') {
    for (const k of ['slot_ms', 'tags', 'relay', 'honeypot', 'crowd']) known.add(k);
    plain('slot_ms', x => isInt(x) && x >= 200 && x <= 5000, '200-5000 ms');
    sub('tags',
      {enabled: [isBool, 'bool'], match: [x => typeof x === 'string' && blen(x) >= 1 && blen(x) <= 16, '1-16 bytes'], log: [isBool, 'bool'],
        rssi_min: [x => isInt(x) && x >= -100 && x <= 0, '-100-0']});
    sub('relay',
      {enabled: [isBool, 'bool'], wait_for: [x => strMax(x, MAX_NAME), '<= 32 bytes'],
        then: [x => ['up', 'down', 'toggle'].includes(x), 'up|down|toggle']});
    sub('honeypot',
      { enabled: [isBool, 'bool'], log: [isBool, 'bool'], probes: [isBool, 'bool'], window_s: [x => isInt(x) && x >= 1 && x <= 10, '1-10 s'] });
    sub('crowd',
      {enabled: [isBool, 'bool'], max: [x => isInt(x) && x >= 1 && x <= 100, '1-100'],
        quiet_s: [x => isInt(x) && x >= 10 && x <= 3600, '10-3600 s'], rssi_min: [x => isInt(x) && x >= -100 && x <= 0, '-100-0']});
    if (cfg.relay.enabled && !cfg.relay.wait_for) { bad(sec + '.relay.wait_for', 'relay needs a network name'); cfg.relay.enabled = false; }
    if (radios) for (const [k, need] of [['tags', 'ble'], ['crowd', 'ble'], ['relay', 'wifi24'], ['honeypot', 'wifi24']]) if (cfg[k].enabled && !radios.includes(need)) { bad(`${sec}.${k}.enabled`, `no ${need === 'ble' ? 'BLE' : 'Wi-Fi'} radio`); cfg[k].enabled = false; }
  } else if (sec === 'stealth') {
    for (const k of ['rotate_mac', 'rotate_name', 'duty_jitter_s', 'start', 'decoys', 'ble_only', 'variable_power', 'modes', 'modes_random',
      'shell_game']) known.add(k);
    plain('modes', x => modesOk(x, radios), '[] or 2-3 distinct kinds of wifi-ap | wifi-probe | ble this hardware has');
    plain('modes_random', isBool, 'bool');
    plain('shell_game', shellGameOk, 'null or {identities: 2-8 of {name 1-32 B, mac}, period_s 60-86400, index < n}');
    plain('variable_power', x => variablePowerOk(x, kind),
      'null or {min_dbm, max_dbm (power steps, min < max), per: wake|slot, slot_s 2-600}');
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

/** What the fox calls itself on cycle n — the payload section's rule, as netpayload.name_for() applies it. */
export function nameForCycle(cfg, n, morseTable = null) {
  const p = cfg.payload;
  if (p?.enabled && p.kind === 'rotate' && p.names?.length) return p.names[n % p.names.length];
  if (p?.enabled && p.kind === 'morse-name' && p.morse_of && morseTable) return morseName(p.morse_of, morseTable);
  return displayName(cfg);
}
/** 'W1ABC' → '.-- .---- .- -... -.-.' cut to 32 bytes at a space (netpayload.morse_name). */
export function morseName(word, table) {
  const words = word.toLowerCase().split(' ').map(w => [...w].filter(c => table[c]).map(c => table[c])).filter(w => w.length);
  let s = words.map(w => w.join(' ')).join(' / ');
  if (s.length > 32) { s = s.slice(0, 32).trimEnd(); if (s.includes(' ')) s = s.slice(0, s.lastIndexOf(' ')); }
  return s || '-';
}

/** The feature sections switched on in a validated cfg, in contract order. */
export const enabledFeatures = cfg => FEATURES.filter(s => cfg[s] && typeof cfg[s] === 'object' && cfg[s].enabled);

export const idOk = cfg => !cfg.id.callmessage.includes(PLACEHOLDER);
/** The banner's id= for a network fox: set | none (placeholder, not on the air) | unset (placeholder would be the name). */
export const idState = cfg => idOk(cfg) ? 'set' : cfg.id.use_callsign_as_name ? 'unset' : 'none';
export const displayName = cfg => cfg.id.use_callsign_as_name ? cfg.id.callmessage.slice(0, MAX_NAME) : (cfg.net.ssid ?? cfg.net.name ?? '');

/** Page checks: what the firmware accepts but the operator should know. Same shape as pageChecks(). */
export function checks(cfg, board, { clockSet = false } = {}) {
  const issues = [];
  const radios = board?.radios || [];
  // contest features: what the firmware accepts but would not work as a fox
  const cp = cfg.checkpoint, se = cfg.sense, st = cfg.stealth, pl = cfg.payload;
  if (cp?.enabled && cp.portal?.enabled && cfg.net.kind !== 'wifi-ap') issues.push({level: 'err', key: 'checkpoint.portal.enabled',
    msg: 'a sign-in page needs the fox to be an access point (the checkpoint or wifi-beacon template)', tab: 'board'});
  if (cp?.enabled && cp.portal?.enabled && cfg.schedule.sleep === 'deep') issues.push({level: 'err', key: 'checkpoint.portal.enabled',
    msg: 'deep sleep would drop a hunter mid-page: use "radio off" between wakes with a sign-in page'});
  if (cp?.enabled && cp.portal?.enabled && cfg.net.psk) issues.push({level: 'warn', key: 'net.psk',
    msg: 'a sign-in page on a password-protected network: hunters would need the PSK first (open is the usual choice)'});
  if (cp?.enabled && cp.ble?.enabled && !radios.includes('ble') && radios.length) issues.push({level: 'err', key: 'checkpoint.ble.enabled',
    msg: `${board.name} has no BLE radio`});
  if (cp?.enabled && !cp.portal?.enabled && !cp.ble?.enabled) issues.push({level: 'warn', key: 'checkpoint.enabled',
    msg: 'checkpoint is on but neither the sign-in page nor the BLE service is'});
  // mode rotation and the shell game (phase H)
  if (st?.enabled && st.modes?.length) {
    if (cp?.enabled && cp.portal?.enabled) issues.push({level: 'warn', key: 'stealth.modes',
      msg: 'with mode rotation the sign-in page is served on access-point wakes only'});
    if (pl?.enabled && pl.split?.wifi && pl.split?.ble) issues.push({level: 'warn', key: 'stealth.modes',
      msg: 'a split clue runs both radios every wake; mode rotation then only changes which one is the main fox'});
  }
  if (st?.enabled && st.shell_game) {
    if (!clockSet) issues.push({level: 'err', key: 'stealth.shell_game',
      msg: 'the shell game follows the board clock: tick "Set the board clock" on the Deploy tab', fix: 'clock'});
    if (st.rotate_mac) issues.push({ level: 'err', key: 'stealth.shell_game', msg: 'the shell game sets the MAC; turn MAC rotation off' });
    if (st.rotate_name || (pl?.enabled && pl.kind !== 'static')) issues.push({level: 'err', key: 'stealth.shell_game',
      msg: 'the shell game sets the name; turn name rotation / payload names off'});
    if (cfg.id.use_callsign_as_name) issues.push({level: 'warn', key: 'stealth.shell_game',
      msg: 'the callsign is the name on the air, but the shell game replaces it each cycle'});
  }
  // a BLE address is a static random one: its two top bits are set, by the firmware when the MAC given lacks them
  if (cfg.net.kind === 'ble' && cfg.net.mac && bleMac(cfg.net.mac) !== cfg.net.mac && !(st?.enabled && (st.rotate_mac || st.shell_game)))
    issues.push({level: 'warn', key: 'net.mac',
      msg: `a BLE address has its two top bits set (first byte C0–FF): this fox is on the air as ${bleMac(cfg.net.mac)}`});
  // what varies per wake (phase G)
  if (cfg.net.kind === 'wifi-probe' && cfg.net.probe_ssids?.length && pl?.enabled && pl.kind !== 'static') issues.push({ level: 'warn', key: 'net.probe_ssids', msg: 'the probe list and the payload names both choose the network sought; the list wins each wake' });
  if (cfg.net.kind === 'wifi-probe' && cfg.net.probe_ssids?.length && cfg.id.use_callsign_as_name) issues.push({ level: 'warn', key: 'net.probe_ssids', msg: 'the callsign is the name on the air, but the probe list replaces it each wake' });
  if (cfg.net.kind === 'wifi-ap' && cfg.net.channels?.length === 1) issues.push({level: 'info', key: 'net.channels',
    msg: `one channel in the per-wake list is a fixed channel ${cfg.net.channels[0]}`});
  if (st?.enabled && st.variable_power && st.variable_power.per === 'slot' && cfg.net.kind === 'ble' && st.variable_power.slot_s < 5) issues.push({ level: 'warn', key: 'stealth.variable_power', msg: 'BLE restarts advertising at every power change; under 5 s a scanner may miss the beacon' });
  if (se?.enabled && se.tags?.enabled && !radios.includes('ble') && radios.length) issues.push({level: 'err', key: 'sense.tags.enabled',
    msg: `${board.name} has no BLE radio to hear tags with`});
  if (se?.enabled && se.tags?.enabled) issues.push({level: 'info', key: 'sense.tags.enabled',
    msg: 'needs one BLE tag per team, named ' + (se.tags.match || 'HUNT-') + '<team>'});
  if (se?.enabled && (se.honeypot?.enabled || se.relay?.enabled) && !radios.includes('wifi24') && radios.length) issues.push({ level: 'err', key: 'sense.enabled', msg: `${board.name} has no Wi-Fi radio` });
  if (se?.enabled && se.honeypot?.enabled && cfg.net.kind !== 'wifi-ap' && !(st?.enabled && st.modes?.includes('wifi-ap'))) issues.push({ level: 'warn', key: 'sense.honeypot.enabled', msg: 'joins are logged on an access point only; this fox is never one' + (se.honeypot.probes ? ' (probe requests are still heard)' : '') });
  if (se?.enabled && se.honeypot?.enabled && se.honeypot.probes) issues.push({level: 'info', key: 'sense.honeypot.probes',
    msg: 'probe requests need wifi.Monitor in the CircuitPython build; a build without it says so once and logs joins only'});
  if (se?.enabled && se.crowd?.enabled && se.tags?.enabled && se.crowd.max < 2) issues.push({level: 'warn', key: 'sense.crowd.max',
    msg: 'a crowd of 1: the first tag nearby silences the fox'});
  if (cp?.enabled && cp.stop_at && !clockSet) issues.push({level: 'err', key: 'checkpoint.stop_at',
    msg: 'a stop time needs the board clock set at deploy: tick "Set the board clock" on the Deploy tab', fix: 'clock'});
  if (se?.enabled && cfg.schedule.sleep === 'deep') issues.push({level: 'warn', key: 'sense.enabled',
    msg: 'listening happens only while awake; with deep sleep the fox hears nothing between wakes'});
  if (se?.enabled && !se.tags?.enabled && !se.relay?.enabled && !se.honeypot?.enabled && !se.crowd?.enabled) issues.push({ level: 'warn', key: 'sense.enabled', msg: 'sense is on but nothing is being listened for' });
  if (st?.enabled && st.start?.at && !clockSet) issues.push({level: 'err', key: 'stealth.start.at',
    msg: 'a start time needs the board clock set at deploy: tick "Set the board clock" on the Deploy tab', fix: 'clock'});
  if (st?.enabled && st.start?.at && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(st.start.at)) issues.push({level: 'warn', key: 'stealth.start.at',
    msg: 'no time zone on the start time: it is read as the board clock\'s zone (the zone the clock was set in)'});
  if (st?.enabled && st.ble_only && se?.enabled && (se.relay?.enabled || se.honeypot?.enabled)) issues.push({level: 'err',
    key: 'sense.relay.enabled', msg: 'BLE only, but the relay / honeypot listen with the Wi-Fi radio — they would turn it back on'});
  if (st?.enabled && st.ble_only && cfg.net.kind !== 'ble') issues.push({level: 'err', key: 'stealth.ble_only',
    msg: 'BLE only with a Wi-Fi template: the fox would never transmit'});
  if (st?.enabled && st.decoys?.length && cfg.net.kind !== 'wifi-ap') issues.push({level: 'warn', key: 'stealth.decoys',
    msg: 'decoy names are SSIDs: they need the access-point template'});
  if (st?.enabled && st.rotate_name && !(pl?.enabled && pl.kind === 'rotate' && pl.names?.length)) issues.push({ level: 'warn', key: 'stealth.rotate_name', msg: 'names at random needs a list of names in the payload section (kind rotate)' });
  if (pl?.enabled && pl.kind === 'morse-name' && !pl.morse_of) issues.push({level: 'err', key: 'payload.morse_of',
    msg: 'morse-name needs a word'});
  if (pl?.enabled && pl.eddystone?.url) {
    const n = eddystoneUrlBytes(pl.eddystone.url);
    if (n == null || n > 17) issues.push({level: 'err', key: 'payload.eddystone.url',
      msg: n == null ? 'the Eddystone-URL frame takes http:// or https:// only' : `${n} bytes encoded; the Eddystone-URL frame holds 17, so the fox will not send it. Only .com/ .org/ .edu/ .net/ .info/ .biz/ .gov/ (and the same without the slash) compress to one byte; www. is free. A short domain or a link shortener fits`});
  }
  if (pl?.enabled && (pl.eddystone?.url || pl.eddystone?.tlm || pl.code?.major || pl.code?.minor) && cfg.net.kind !== 'ble') issues.push({ level: 'warn', key: 'payload.eddystone', msg: 'beacon code, Eddystone URL and telemetry are BLE frames: they need the ble-beacon template' });
  if (pl?.enabled && (pl.split?.wifi || pl.split?.ble) && !(radios.includes('wifi24') && radios.includes('ble'))) issues.push({ level: 'err', key: 'payload.split', msg: 'a split clue needs both radios' });
  if (cfg.net.kind === 'wifi-ap' && cfg.net.hidden) issues.push({level: 'warn', key: 'net.hidden',
    msg: 'this firmware cannot hide the SSID (CircuitPython has no hidden-AP option): it will be broadcast; the fox says so in its banner'});
  if (cfg.net.kind === 'wifi-ap' && cfg.net.psk === '') issues.push({level: 'info', key: 'net.psk',
    msg: 'open network: anyone can join (max_clients caps it); a PSK of 8+ characters makes it WPA2'});
  if ((cfg.net.kind === 'wifi-ap' || cfg.net.kind === 'wifi-probe') && !radios.includes('wifi24') && radios.length) issues.push({ level: 'err', key: 'net.kind', msg: `${board.name} has no Wi-Fi radio` });
  if (cfg.net.kind === 'ble' && !radios.includes('ble') && radios.length) issues.push({level: 'err', key: 'net.kind',
    msg: `${board.name} has no BLE radio`});
  if (cfg.net.kind === 'wifi-ap' && WIFI5_CHANNELS.includes(cfg.net.channel)) issues.push({level: 'warn', key: 'net.channel',
    msg: '5 GHz: only a 5 GHz-capable phone sees it, and CircuitPython\'s 5 GHz AP support on this chip is unverified'});
  if (cfg.schedule.sleep === 'deep') issues.push({level: 'info', key: 'schedule.sleep',
    msg: `deep sleep: the USB port disappears for ${cfg.schedule.sleep_s} s each cycle (Listen only reconnects when it returns); a power bank with auto-off will cut the fox off`});
  // a network fox need not identify on the air (a Part 15 device): the placeholder blocks only when it would be the name
  if (!idOk(cfg) && cfg.id.use_callsign_as_name) issues.push({level: 'err', key: 'id.callmessage',
    msg: 'the callsign is the name on the air, but it is the N0CALL placeholder'});
  else if (!idOk(cfg)) issues.push({level: 'warn', key: 'id.callmessage',
    msg: cfg.fleet?.owner ? `no callsign (N0CALL placeholder): allowed for a network fox; the fleet log records ${cfg.fleet.owner} as the operator` : 'no operator recorded (N0CALL placeholder): allowed for a network fox, but the fleet log will not say whose fox this is beyond its chip uid — fill in Operator on the ID tab'});
  if (cfg.id.use_callsign_as_name && !/^[A-Z0-9]{3,}/.test(cfg.id.callmessage)) issues.push({level: 'info', key: 'id.use_callsign_as_name',
    msg: 'the name on the air is the callsign field as typed'});
  return issues;
}

/** The duty cycle as a timeline for the Schedule tab's preview: [{t, kind:'tx'|'off', dur}] in ms up to horizonMs. */
export function cycle(cfg, horizonMs = 600000) {
  const items = []; let t = 0;
  const wake = cfg.schedule.wake_s * 1000, sleep = cfg.schedule.sleep_s * 1000;
  while (t < horizonMs) { items.push({ t, kind: 'tx', dur: wake }); t += wake; if (sleep > 0) { items.push({t,
    kind: cfg.schedule.sleep === 'deep' ? 'sleep' : 'off', dur: sleep}); t += sleep; } }
  return items;
}

/** The files a deploy writes: fox.json compact, like the FM family. */
export function stringify(cfg) { return JSON.stringify(cfg); }
