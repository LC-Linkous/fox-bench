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

  const l = u.led && typeof u.led === 'object' ? u.led : {};
  if ('enabled' in l) { if (typeof l.enabled === 'boolean') cfg.led.enabled = l.enabled; else bad('led.enabled', 'bool'); }
  if (u.fleet && typeof u.fleet === 'object') for (const [k, v] of Object.entries(u.fleet)) if (k in cfg.fleet && (v === null || typeof v === 'string' || typeof v === 'number')) cfg.fleet[k] = v;

  const status = report.length ? `partial(${report.map(x => x.key).join(',')})` : 'ok';
  return { cfg, report, fatal: null, status };
}

export const idOk = cfg => !cfg.id.callmessage.includes(PLACEHOLDER);
export const displayName = cfg => cfg.id.use_callsign_as_name ? cfg.id.callmessage.slice(0, MAX_NAME) : (cfg.net.ssid ?? cfg.net.name ?? '');

/** Page checks: what the firmware accepts but the operator should know. Same shape as pageChecks(). */
export function checks(cfg, board) {
  const issues = [];
  const radios = board?.radios || [];
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
