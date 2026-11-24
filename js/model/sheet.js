// sheet.js — the event sheet: what each deployed fox shows on the air, one line per fox, from the fleet log.
//
// The fleet log is the audit trail (every deploy, flash, export, bench action). The sheet is the field document: the
// latest deploy per chip uid, with the `on_air` summary that deploy wrote into the row, filtered by event. It is built
// from the log alone, so a laptop that has the log can print it without the boards. No keyphrases or passwords: there
// are none. (docs/network-fox-payloads-plan.md, phase G)

import { bleMac } from './netschema.js';

/** A compact, human-readable line of what a hunter can observe plus the code: written into the fleet row at deploy. */
export function onAir(cfg, { family = 'foxlib', template = '' } = {}) {
  if (!cfg) return '';
  const parts = [];
  const n = cfg.net;
  if (n) {
    if (n.kind === 'wifi-ap') {
      parts.push(`AP "${name(cfg)}"`);
      if (n.hidden) parts.push('hidden');
      if (n.psk) parts.push('WPA2');
      parts.push(n.channels?.length ? `ch ${n.channels.join('/')} per wake` : `ch ${n.channel}`);
      if (n.max_clients > 1) parts.push(`${n.max_clients} clients`);
    } else if (n.kind === 'wifi-probe') {
      parts.push(`probes for "${name(cfg)}"` + (n.probe_ssids?.length ? ` + ${n.probe_ssids.map(s => `"${s}"`).join(', ')}${n.probe_ssid_s ? ` every ${n.probe_ssid_s} s` : ' per wake'}` : ''));
    } else if (n.kind === 'ble') {
      parts.push(`BLE "${name(cfg)}" ${n.uuid} ${n.major}/${n.minor}`);
    }
    const st = cfg.stealth?.enabled ? cfg.stealth : null;
    parts.push(st?.rotate_mac ? `MAC ${st.rotate_mac}` : `MAC ${n.mac ? (n.kind === 'ble' ? bleMac(n.mac) : n.mac) : '—'}`);      // BLE: as it is on the air
    parts.push(st?.variable_power ? `${st.variable_power.min_dbm}–${st.variable_power.max_dbm} dBm per ${st.variable_power.per}` : `${n.tx_power_dbm} dBm`);
    const pl = cfg.payload?.enabled ? cfg.payload : null;
    if (pl) {
      if (pl.kind === 'rotate' && pl.names?.length) parts.push(`names ${pl.names.map(s => `"${s}"`).join(', ')}${st?.rotate_name ? ' at random' : ' in turn'}`);
      if (pl.kind === 'morse-name' && pl.morse_of) parts.push(`Morse of ${pl.morse_of}`);
      if (pl.code && (pl.code.major || pl.code.minor)) parts.push(`code ${pl.code.major}/${pl.code.minor}`);
      if (pl.eddystone?.url) parts.push(`URL ${pl.eddystone.url}`);
      if (pl.eddystone?.tlm) parts.push('TLM' + (Object.keys(pl.eddystone.tlm_data || {}).length ? ` (${Object.entries(pl.eddystone.tlm_data).map(([k, v]) => `${k}=${v}`).join(' ')})` : ''));
      if (pl.split?.wifi && pl.split?.ble) parts.push(`split "${pl.split.wifi}" + "${pl.split.ble}"`);
    }
    if (st?.decoys?.length) parts.push(`decoys ${st.decoys.map(s => `"${s}"`).join(', ')}`);
    if (st?.modes?.length) parts.push(`modes ${st.modes.join('/')}${st.modes_random ? ' at random' : ' in turn'}`);
    if (st?.shell_game) parts.push(`shell game seat ${st.shell_game.index + 1}/${st.shell_game.identities.length} every ${st.shell_game.period_s} s: ${st.shell_game.identities.map(i => i.name).join(', ')}`);
    if (st?.start?.at) parts.push(`starts ${st.start.at}`); else if (st?.start?.after_s) parts.push(`starts after ${st.start.after_s} s`);
    const cp = cfg.checkpoint?.enabled ? cfg.checkpoint : null;
    if (cp?.portal?.enabled) parts.push(`portal code ${cp.portal.code || '—'}${cp.portal.log ? ', logs finds' : ''}`);
    if (cp?.ble?.enabled) parts.push(`BLE service code ${cp.ble.code || '—'}`);
    if (cp?.stop_at) parts.push(`stops at ${cp.stop_at}`);
    const se = cfg.sense?.enabled ? cfg.sense : null;
    if (se) {
      const l = [];
      if (se.tags?.enabled) l.push(`tags ${se.tags.match}*`);
      if (se.relay?.enabled) l.push(`relay ${se.relay.then} on "${se.relay.wait_for}"`);
      if (se.honeypot?.enabled) l.push('honeypot' + (se.honeypot.probes ? ' + probes' : ''));
      if (se.crowd?.enabled) l.push(`crowd > ${se.crowd.max} → quiet ${se.crowd.quiet_s} s`);
      if (l.length) parts.push('listens: ' + l.join(', '));
    }
    const s = cfg.schedule;
    if (s) parts.push(`${s.wake_s} s on / ${s.sleep_s} s ${s.sleep === 'deep' ? 'deep sleep' : 'off'}${st?.duty_jitter_s ? ` ±${st.duty_jitter_s}` : ''}`);
  } else if (cfg.plan) {
    // an FM fox
    const f = cfg.plan.frequencies_mhz || [];
    parts.push(`FM ${f.map(x => x.toFixed(3)).join(' → ')} MHz`);
    parts.push(`"${cfg.id?.callmessage || ''}"`);
    if (cfg.radio?.high_power) parts.push('high power');
    const s = cfg.schedule;
    if (s?.kind) parts.push(s.kind + (s.delay_ms != null ? ` every ${Math.round(s.delay_ms / 1000)} s` : ''));
    if (cfg.payload?.kind) parts.push(cfg.payload.kind);
  }
  if (cfg.fleet?.points_to) parts.push(`→ ${cfg.fleet.points_to}`);
  return parts.join(' · ');
}

export function name(cfg) {
  if (cfg.id?.use_callsign_as_name) return cfg.id.callmessage;
  return cfg.net.kind === 'ble' ? cfg.net.name : cfg.net.ssid;
}

/** The sheet: latest deploy (or export) per chip uid, newest first; rows without a uid are kept by profile+timestamp. */
export function sheetRows(log, { event = '' } = {}) {
  // a row with a chip uid is that board; an export (no board) is its profile, so exporting the same fox again replaces
  // its line instead of adding one, and a later deploy of that profile to a board supersedes the export
  const byKey = new Map();
  for (const r of log) {
    if (!['deploy', 'export-zip', 'export-header'].includes(r.action)) continue;
    if (r.action === 'deploy' && r.result && r.result !== 'ok') continue;
    if (event && (r.event || '') !== event) continue;
    const key = r.uid ? `uid:${r.uid}` : `profile:${r.profile || r.template}`;
    const have = byKey.get(key);
    if (!have || String(r.timestamp) > String(have.timestamp)) byKey.set(key, r);
  }
  for (const [key, r] of [...byKey]) {
    if (!key.startsWith('profile:') || !r.profile) continue;
    const deployed = [...byKey.values()].some(x => x.uid && x.profile === r.profile && String(x.timestamp) > String(r.timestamp));
    if (deployed) byKey.delete(key);
  }
  return [...byKey.values()].sort((a, b) => (Number(a.board_number) || 1e9) - (Number(b.board_number) || 1e9) || String(a.profile).localeCompare(String(b.profile)));
}

export const SHEET_FIELDS = ['board_number', 'profile', 'template', 'board', 'uid', 'owner', 'callsign', 'on_air', 'timestamp'];
const SHEET_LABELS = { board_number: '#', profile: 'fox', template: 'template', board: 'board', uid: 'uid', owner: 'operator', callsign: 'callsign', on_air: 'on the air', timestamp: 'deployed' };

export function sheetCsv(rows) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [SHEET_FIELDS.join(','), ...rows.map(r => SHEET_FIELDS.map(f => esc(f === 'uid' ? String(r.uid || '').slice(-8) : r[f])).join(','))].join('\n') + '\n';
}

/** A printable page: one table, fits A4/Letter portrait at small type. */
export function sheetHtml(rows, { event = '', generated = new Date() } = {}) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const title = `Event sheet${event ? ' — ' + esc(event) : ''}`;
  const head = SHEET_FIELDS.map(f => `<th>${esc(SHEET_LABELS[f])}</th>`).join('');
  const body = rows.map(r => '<tr>' + SHEET_FIELDS.map(f => `<td class="${f}">${esc(f === 'uid' ? String(r.uid || '').slice(-8) : f === 'timestamp' ? String(r.timestamp || '').slice(0, 16).replace('T', ' ') : r[f])}</td>`).join('') + '</tr>').join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:11px/1.35 system-ui,sans-serif;margin:14mm}h1{font-size:16px;margin:0 0 2px}p{margin:0 0 10px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;vertical-align:top;text-align:left}th{background:#eee}
td.uid,td.timestamp{font-family:ui-monospace,monospace;white-space:nowrap}td.on_air{font-size:10px}@media print{button{display:none}}</style></head>
<body><h1>${title}</h1><p>${rows.length} fox${rows.length === 1 ? '' : 'es'} · generated ${esc(generated.toISOString().slice(0, 16).replace('T', ' '))} · from the fox-bench fleet log (latest deploy per chip uid)</p>
<button onclick="window.print()">Print</button>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}
