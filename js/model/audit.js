// audit.js — does the fox in front of you match what the fleet log says was put on it?
// SPDX-License-Identifier: GPL-2.0-only
//
// Pure: observe() reduces whatever the page knows about the connected device to one record,
// match() compares it with the log's last deploy for that fox. Which facts are available depends
// on how the fox is connected:
//   REPL (foxlib):        chip UID + fox.json read from the board  → full comparison
//   console (foxlib-c):   banner → UID, template, frequencies, cfg/radio/id status; no callsign text
//   drive (foxlib-c):     fox.json → template, callsign, frequencies; UID from board.json (firmware 0.1.4+)
//   drive (vendor):       settings.txt → callsign, frequency; no UID, no template
// A network fox is also compared on what it shows on the air (kind, name, MAC, channel, power, features — the deploy
// row's on_air summary, recomputed from the fox.json read back), since its frequency list is empty and a wrong SSID
// would otherwise pass. The firmware the board runs (banner / connect info) goes into the row for the record.
// A fox without a readable UID is matched by board + what was last deployed on that board. A fox whose UID
// no deploy row carries (its deploys went over a drive that could not read one) falls back to the last
// deploy on that board that was itself logged without a UID — never to another identified fox's row.

/** One record of what is connected right now. Returns null when nothing is. */
import { onAir } from './sheet.js';

export function observe(app) {
  if (!app.device) return null;
  const ob = app.onBoard || {}, info = app.info || {}, b = app.lastBanner || null;
  const out = { source: app.device.kind === 'demo' ? 'demo' : app.device.kind, board: app.boardId, uid: info.uid || '', template: null, callsign: null, freqs: null, cfgStatus: null, radioStatus: null, idStatus: null, firmware: firmwareText(ob.foxlibVersion || '', info.cpVersion || '') };
  if (app.device.kind === 'console' || (app.device.kind === 'demo' && b && app.family === 'foxlib-c' && !ob.cfg)) {
    if (b) { out.uid = b.uid || out.uid; out.template = (b.template || '').split('/')[0] || null; out.freqs = b.freq && b.freq !== 'none' ? b.freq.split(',').map(Number) : null; out.cfgStatus = b.cfg || null; out.radioStatus = b.radio || null; out.idStatus = b.id || null; out.firmware = firmwareText(b.foxlib || '', '') || out.firmware; }
    return out;
  }
  if (app.family === 'drive') {
    const s = ob.settings;
    if (s) { out.callsign = s.CALLSIGN || ''; out.freqs = s.FREQ_MHZ ? [Number(s.FREQ_MHZ)] : null; out.template = ob.template || null; }
    return out;
  }
  const cfg = ob.cfg;
  if (cfg?.net) out.onAir = onAir(cfg, { family: app.family, template: cfg.template || ob.template || '' });
  if (cfg) { out.template = cfg.template || ob.template || null; out.callsign = cfg.id?.callmessage ?? null; out.freqs = Array.isArray(cfg.plan?.frequencies_mhz) ? cfg.plan.frequencies_mhz.slice() : null; }
  else out.template = ob.template || null;
  if (b) { out.cfgStatus = b.cfg || null; out.radioStatus = b.radio || null; out.idStatus = b.id || null; }
  return out;
}

const sameFreqs = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((f, i) => Math.abs(Number(f) - Number(b[i])) < 0.0005);
const parseFreqs = s => String(s || '').split(/[\s,]+/).filter(Boolean).map(Number);

/**
 * Compare an observation with the fleet log. Returns
 *   { row, by, checks: [{ key, expected, actual, ok }], result: 'match' | 'mismatch' | 'unmatched' | 'nothing-to-check' }
 * row: the log's last deploy for this fox (by UID; else by board when the fox has no UID, or when none of that board's
 * deploys recorded one); by: 'uid' | 'board' | 'board (that deploy was logged without a UID)' | null.
 */
export function match(obs, log) {
  if (!obs) return { row: null, by: null, checks: [], result: 'unmatched' };
  const deploys = log.filter(r => r.action === 'deploy');
  let row = null, by = null;
  if (obs.uid) {
    row = [...deploys].reverse().find(r => r.uid && r.uid === obs.uid) || null; by = row ? 'uid' : null;
    if (!row) { row = [...deploys].reverse().find(r => r.board === obs.board && !r.uid) || null; by = row ? 'board (that deploy was logged without a UID)' : null; }
  }
  else { row = [...deploys].reverse().find(r => r.board === obs.board) || null; by = row ? 'board' : null; }
  if (!row) return { row: null, by: null, checks: [], result: 'unmatched' };
  const checks = [];
  if (obs.template != null && row.template) { const exp = String(row.template).split('/')[0]; checks.push({ key: 'template', expected: exp, actual: obs.template, ok: exp === obs.template }); }
  if (obs.callsign != null && row.callsign != null) {
    // the vendor firmware keeps only the first word's A–Z 0–9 as its CALLSIGN; compare on what that fox can show
    const vendor = obs.source !== 'repl' && obs.source !== 'demo' && obs.source !== 'console' && !/\s/.test(obs.callsign || '') && /\s/.test(row.callsign || '');
    const exp = vendor ? String(row.callsign).trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '') : row.callsign;
    checks.push({ key: 'callsign', expected: exp, actual: obs.callsign, ok: String(exp).trim() === String(obs.callsign).trim() });
  }
  if (obs.freqs && row.freq) { const exp = parseFreqs(row.freq); checks.push({ key: 'frequencies', expected: exp.join(' '), actual: obs.freqs.join(' '), ok: sameFreqs(exp, obs.freqs) }); }
  if (obs.onAir != null && row.on_air) checks.push({ key: 'on the air', expected: row.on_air, actual: obs.onAir, ok: obs.onAir === row.on_air });
  if (obs.cfgStatus) checks.push({ key: 'cfg', expected: 'ok', actual: obs.cfgStatus, ok: obs.cfgStatus === 'ok' });
  if (obs.radioStatus) checks.push({ key: 'radio', expected: 'ok', actual: obs.radioStatus, ok: obs.radioStatus === 'ok' });
  if (obs.idStatus) checks.push({ key: 'callsign set', expected: 'set', actual: obs.idStatus, ok: obs.idStatus === 'set' });
  const result = !checks.length ? 'nothing-to-check' : checks.every(c => c.ok) ? 'match' : 'mismatch';
  return { row, by, checks, result };
}

/** The fleet-log row an audit appends. */
export function auditRow(obs, m, note = '') {
  const diffs = m.checks.filter(c => !c.ok).map(c => `${c.key}: expected ${c.expected}, found ${c.actual}`);
  return {
    board_number: m.row?.board_number || '', uid: obs?.uid || '', board: obs?.board || '', action: 'audit',
    template: obs?.template || m.row?.template || '', profile: m.row?.profile || '', callsign: obs?.callsign ?? m.row?.callsign ?? '', freq: obs?.freqs ? obs.freqs.join(' ') : (m.row?.freq || ''),
    power: m.row?.power || '', seed: m.row?.seed ?? '', result: m.result, on_air: obs?.onAir ?? '', firmware: obs?.firmware || '',
    notes: [obs ? `via ${obs.source}` : '', m.by ? `matched by ${m.by}` : 'no deploy on record', ...diffs, note].filter(Boolean).join(' · '),
  };
}

/** The `firmware` column: what runs on the board, as one string ("foxlib 1.11.3 · CircuitPython 10.3.2",
 *  "foxlib-c 0.1.11", "vendor rev 3"). Empty when nothing is known. */
export function firmwareText(foxlib, cp = '') {
  const parts = [];
  if (foxlib) parts.push(/^c-/.test(foxlib) ? `foxlib-c ${foxlib.slice(2)}` : `foxlib ${foxlib}`);
  if (cp) parts.push(`CircuitPython ${cp}`);
  return parts.join(' · ');
}
