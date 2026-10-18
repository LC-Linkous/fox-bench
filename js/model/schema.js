// schema.js — fox.json: merge over defaults, validate per CONFIG.md, report.
// SPDX-License-Identifier: GPL-2.0-only
//
// mergeAndValidate(user, defaults, board) -> { cfg, report: [{key, reason}], fatal }
// is the browser's implementation of the contract in CONFIG.md. The firmware
// (foxlib/cfg.py) implements the same document independently; the demo
// device uses this one to produce its boot banner.

export const SCHEMA = 1;
export const REQUIRED_PINS = ['ptt', 'pd', 'hl', 'uart_tx', 'uart_rx', 'audio'];
export const OPTIONAL_PINS = ['led', 'batt_sense'];
export const PIN_FLAGS = { audio: 'pwm', batt_sense: 'adc', uart_tx: 'uart_tx', uart_rx: 'uart_rx' };

const isInt = v => Number.isInteger(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

/** Pin name → board pin entry (accepts aliases). */
export function findPin(board, name) {
  if (!board || name == null) return null;
  return board.pins.find(p => p.name === name || (p.aliases || []).includes(name)) || null;
}

export function mergeAndValidate(user, defaults, board) {
  const cfg = structuredClone(defaults);
  const report = [];
  let fatal = null;
  const bad = (key, reason) => report.push({ key, reason });
  const u = (user && typeof user === 'object' && !Array.isArray(user)) ? user : {};

  // ---- top level gates
  if (u.schema !== undefined && u.schema !== SCHEMA) { return { cfg, report: [{ key: 'schema', reason: `schema ${u.schema} not supported` }], fatal: null, status: 'default(schema)' }; }
  if (u.template !== undefined && u.template !== defaults.template) return { cfg, report: [{ key: 'template', reason: 'does not match firmware' }], fatal: null, status: 'default(template)' };
  if (u.board !== undefined && board && u.board !== board.id) return { cfg, report: [{ key: 'board', reason: 'config is for another board' }], fatal: null, status: 'default(board)' };
  if (u.module !== undefined) { if (typeof u.module === 'string') cfg.module = u.module; else bad('module', 'string'); }

  // ---- pins
  const pins = u.pins && typeof u.pins === 'object' ? u.pins : {};
  for (const role of [...REQUIRED_PINS, ...OPTIONAL_PINS]) {
    if (!(role in pins)) continue;
    const v = pins[role];
    if (v === null) { if (REQUIRED_PINS.includes(role)) bad(`pins.${role}`, 'required'); else cfg.pins[role] = null; continue; }
    const p = findPin(board, v);
    if (!p) { bad(`pins.${role}`, `no pin ${v} on ${board?.id || 'board'}`); continue; }
    const flag = PIN_FLAGS[role];
    if (flag && !p[flag]) { bad(`pins.${role}`, `${v} is not ${flag}-capable`); continue; }
    cfg.pins[role] = p.name;
  }
  for (const k of Object.keys(pins)) if (![...REQUIRED_PINS, ...OPTIONAL_PINS].includes(k)) bad(`pins.${k}`, 'unknown role');
  // duplicate pins: later roles lose
  const seen = new Map();
  for (const role of [...REQUIRED_PINS, ...OPTIONAL_PINS]) {
    const v = cfg.pins[role]; if (v == null) continue;
    if (seen.has(v)) { bad(`pins.${role}`, `shares ${v} with ${seen.get(v)}`); cfg.pins[role] = defaults.pins[role]; if (cfg.pins[role] === v) { if (REQUIRED_PINS.includes(role)) fatal = fatal || `pins.${role}`; else cfg.pins[role] = null; } }
    else seen.set(v, role);
  }
  for (const role of REQUIRED_PINS) if (!findPin(board, cfg.pins[role])) fatal = fatal || `pins.${role}`;

  // ---- radio
  const r = u.radio || {};
  if ('family' in r) { if (typeof r.family === 'string' && r.family) cfg.radio.family = r.family; else bad('radio.family', 'string'); }
  if ('ranges_mhz' in r) { if (Array.isArray(r.ranges_mhz) && r.ranges_mhz.length && r.ranges_mhz.every(x => Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]) && x[0] < x[1])) cfg.radio.ranges_mhz = r.ranges_mhz; else bad('radio.ranges_mhz', '[[lo,hi],…]'); }
  if ('bandwidth_khz' in r) { if (isNum(r.bandwidth_khz) && inRange(r.bandwidth_khz, 1, 100)) cfg.radio.bandwidth_khz = r.bandwidth_khz; else bad('radio.bandwidth_khz', '1–100'); }
  if ('power_dbm' in r) { if (r.power_dbm === null || inRange(r.power_dbm, 0, 40)) cfg.radio.power_dbm = r.power_dbm; else bad('radio.power_dbm', 'null or 0–40'); }
  if ('squelch' in r) { if (isInt(r.squelch) && inRange(r.squelch, 0, 8)) cfg.radio.squelch = r.squelch; else bad('radio.squelch', '0–8'); }
  if ('volume' in r) { if (isInt(r.volume) && inRange(r.volume, 1, 8)) cfg.radio.volume = r.volume; else bad('radio.volume', '1–8'); }
  if ('high_power' in r) { if (typeof r.high_power === 'boolean') cfg.radio.high_power = r.high_power; else bad('radio.high_power', 'bool'); }

  // ---- plan
  const p = u.plan || {};
  if ('frequencies_mhz' in p) {
    if (Array.isArray(p.frequencies_mhz) && p.frequencies_mhz.length && p.frequencies_mhz.every(isNum)) cfg.plan.frequencies_mhz = p.frequencies_mhz.slice();
    else bad('plan.frequencies_mhz', 'non-empty list of numbers');
  }
  if ('announce_qsy' in p) { if (typeof p.announce_qsy === 'boolean') cfg.plan.announce_qsy = p.announce_qsy; else bad('plan.announce_qsy', 'bool'); }
  const inModule = f => cfg.radio.ranges_mhz.some(([lo, hi]) => f >= lo && f <= hi);
  const dropped = cfg.plan.frequencies_mhz.filter(f => !inModule(f));
  if (dropped.length) { bad('plan.frequencies_mhz', `out of module range: ${dropped.join(', ')}`); cfg.plan.frequencies_mhz = cfg.plan.frequencies_mhz.filter(inModule); }
  if (!cfg.plan.frequencies_mhz.length) fatal = fatal || 'plan';

  // ---- id
  const d = u.id || {};
  if ('callmessage' in d) { if (typeof d.callmessage === 'string' && d.callmessage.length >= 1 && d.callmessage.length <= 64) cfg.id.callmessage = d.callmessage; else bad('id.callmessage', '1–64 chars'); }
  if ('placeholder' in d) { if (typeof d.placeholder === 'string' && d.placeholder) cfg.id.placeholder = d.placeholder; else bad('id.placeholder', 'string'); }
  if ('wpm' in d) { if (isInt(d.wpm) && inRange(d.wpm, 5, 40)) cfg.id.wpm = d.wpm; else bad('id.wpm', '5–40'); }
  if ('tone_hz' in d) { if (isInt(d.tone_hz) && inRange(d.tone_hz, 300, 3000)) cfg.id.tone_hz = d.tone_hz; else bad('id.tone_hz', '300–3000'); }
  if ('telemetry' in d) { if (Array.isArray(d.telemetry) && d.telemetry.every(t => t === 'batt')) cfg.id.telemetry = d.telemetry.slice(); else bad('id.telemetry', 'subset of ["batt"]'); }
  if ('tx_without_callsign' in d) { if (typeof d.tx_without_callsign === 'boolean') cfg.id.tx_without_callsign = d.tx_without_callsign; else bad('id.tx_without_callsign', 'bool'); }

  // ---- payload
  const pl = u.payload;
  if (pl && typeof pl === 'object') {
    if (!['songs', 'sstv', 'none'].includes(pl.kind)) bad('payload.kind', 'songs | sstv | none');
    else {
      const out = { kind: pl.kind };
      if (pl.kind === 'songs') {
        out.articulation = !('articulation' in pl) ? 0.875 : inRange(pl.articulation, 0.5, 1.0) ? pl.articulation : (bad('payload.articulation', '0.5–1.0'), 0.875);
        out.skip_on_low_battery = typeof pl.skip_on_low_battery === 'boolean' ? pl.skip_on_low_battery : true;
        const songs = Array.isArray(pl.playlist) ? pl.playlist.filter((s, i) => {
          const ok = s && typeof s.name === 'string' && isInt(s.tempo) && inRange(s.tempo, 40, 300) && Array.isArray(s.notes) && s.notes.length && s.notes.every(n => Array.isArray(n) && n.length === 2 && isInt(n[0]) && inRange(n[0], 0, 127) && isInt(n[1]) && inRange(n[1], 1, 64));
          if (!ok) bad(`payload.playlist[${i}]`, 'bad song');
          return ok;
        }) : [];
        if (!songs.length) { bad('payload.playlist', 'empty'); out.playlist = defaults.payload.kind === 'songs' ? defaults.payload.playlist : []; } else out.playlist = songs;
      } else if (pl.kind === 'sstv') {
        out.mode = 'robot36-gray'; if (pl.mode && pl.mode !== 'robot36-gray') bad('payload.mode', 'robot36-gray only');
        out.images_file = typeof pl.images_file === 'string' ? pl.images_file : 'images.bin';
        out.skip_on_low_battery = typeof pl.skip_on_low_battery === 'boolean' ? pl.skip_on_low_battery : true;
      } else {
        out.dit_s = pl.dit_s == null ? null : inRange(pl.dit_s, 0.05, 30) ? pl.dit_s : (bad('payload.dit_s', '0.05–30'), null);
        out.message = pl.message == null ? null : typeof pl.message === 'string' ? pl.message : (bad('payload.message', 'string or null'), null);
      }
      cfg.payload = out;
    }
  } else if (pl !== undefined) bad('payload', 'object');

  // ---- schedule
  const s = u.schedule;
  if (s && typeof s === 'object') {
    const ms = (k, lo = 0, hi = 86400000) => { if (!(k in s)) return null; if (isInt(s[k]) && inRange(s[k], lo, hi)) return s[k]; bad(`schedule.${k}`, `int ms ${lo}–${hi}`); return null; };
    if (s.kind === 'fixed') { cfg.schedule = { kind: 'fixed', delay_ms: ms('delay_ms') ?? 30000 }; }
    else if (s.kind === 'popcorn') {
      cfg.schedule = { kind: 'popcorn', seed: isInt(s.seed) && inRange(s.seed, 0, 2 ** 31 - 1) ? s.seed : (bad('schedule.seed', 'int'), 1),
        cluster: isInt(s.cluster) && inRange(s.cluster, 1, 50) ? s.cluster : (bad('schedule.cluster', '1–50'), 2),
        cluster_gap_ms: ms('cluster_gap_ms') ?? 8000, dark_min_ms: ms('dark_min_ms') ?? 10000, dark_max_ms: ms('dark_max_ms') ?? 300000 };
      if (cfg.schedule.dark_min_ms > cfg.schedule.dark_max_ms) { bad('schedule.dark_min_ms', 'min > max'); cfg.schedule.dark_min_ms = cfg.schedule.dark_max_ms; }
    } else if (s.kind === 'resurrection') {
      cfg.schedule = { kind: 'resurrection', seed: isInt(s.seed) && inRange(s.seed, 0, 2 ** 31 - 1) ? s.seed : (bad('schedule.seed', 'int'), 1),
        delay_ms: ms('delay_ms') ?? 30000, alive_min_ms: ms('alive_min_ms') ?? 1800000, alive_max_ms: ms('alive_max_ms') ?? 3600000, dead_ms: ms('dead_ms') ?? 3600000,
        dit_min_ms: ms('dit_min_ms') ?? 180000, dit_max_ms: ms('dit_max_ms') ?? 300000,
        id_every: isInt(s.id_every) && inRange(s.id_every, 1, 100) ? s.id_every : (bad('schedule.id_every', '1–100'), 3),
        dead_song: typeof s.dead_song === 'boolean' ? s.dead_song : false };
      for (const [a, b] of [['alive_min_ms', 'alive_max_ms'], ['dit_min_ms', 'dit_max_ms']]) if (cfg.schedule[a] > cfg.schedule[b]) { bad(`schedule.${a}`, 'min > max'); cfg.schedule[a] = cfg.schedule[b]; }
    } else bad('schedule.kind', 'fixed | popcorn | resurrection');
  } else if (s !== undefined) bad('schedule', 'object');

  // ---- battery
  const b = u.battery || {};
  const bnum = (k, lo, hi) => { if (!(k in b)) return; if (inRange(b[k], lo, hi)) cfg.battery[k] = b[k]; else bad(`battery.${k}`, `${lo}–${hi}`); };
  bnum('divider_ratio', 1, 10); bnum('calibration', 0.5, 2); bnum('low_v', 2.5, 4.5); bnum('critical_v', 2.5, 4.5); bnum('recovery_v', 2.5, 4.5);
  if ('samples' in b) { if (isInt(b.samples) && inRange(b.samples, 1, 64)) cfg.battery.samples = b.samples; else bad('battery.samples', '1–64'); }
  if (!(cfg.battery.critical_v < cfg.battery.recovery_v && cfg.battery.recovery_v <= cfg.battery.low_v)) { bad('battery', 'need critical < recovery ≤ low'); Object.assign(cfg.battery, { low_v: defaults.battery.low_v, critical_v: defaults.battery.critical_v, recovery_v: defaults.battery.recovery_v }); }

  // ---- limits
  const l = u.limits || {};
  if ('max_keydown_s' in l) { if (l.max_keydown_s === null || (isNum(l.max_keydown_s) && inRange(l.max_keydown_s, 1, 7200))) cfg.limits.max_keydown_s = l.max_keydown_s; else bad('limits.max_keydown_s', 'null or 1–7200'); }

  // ---- fleet (opaque)
  if (u.fleet && typeof u.fleet === 'object') cfg.fleet = { ...cfg.fleet, ...u.fleet };

  // ---- unknown top-level keys
  for (const k of Object.keys(u)) if (!['schema', 'template', 'board', 'module', 'pins', 'radio', 'plan', 'id', 'payload', 'schedule', 'battery', 'limits', 'fleet'].includes(k)) bad(k, 'unknown key');

  const status = fatal ? `fatal(${fatal})` : report.length ? `partial(${report.map(x => x.key).join(',')})` : 'ok';
  return { cfg, report, fatal, status };
}

/** Page-side checks that go beyond the firmware: callsign set, band plan, Morse characters. */
export function pageChecks(cfg, { bands, region, morseTable, templateManifest, module }) {
  const issues = [];   // { level: 'err'|'warn', key, msg }
  if (cfg.id.callmessage.includes(cfg.id.placeholder)) issues.push({ level: 'err', key: 'id.callmessage', msg: `callsign not set (still contains ${cfg.id.placeholder})` });
  const unsendable = [...new Set(cfg.id.callmessage.toLowerCase().split('').filter(c => c !== ' ' && !(c in morseTable)))];
  if (unsendable.length) issues.push({ level: 'warn', key: 'id.callmessage', msg: `not in the Morse table, will be skipped: ${unsendable.join(' ')}` });
  if (cfg.payload.kind === 'none' && cfg.payload.message && cfg.payload.message.includes(cfg.id.placeholder)) issues.push({ level: 'err', key: 'payload.message', msg: 'QRSS message contains the placeholder' });
  const regionBands = bands?.[region] || {};
  for (const f of cfg.plan.frequencies_mhz) {
    const inBand = Object.values(regionBands).some(([lo, hi]) => f >= lo && f <= hi);
    if (!inBand) issues.push({ level: 'err', blocking: false, key: 'plan.frequencies_mhz', msg: `${f} MHz is outside the ${region} amateur bands — deploying will ask you to confirm` });
  }
  if (module?.bandwidths_khz && !module.bandwidths_khz.includes(cfg.radio.bandwidth_khz)) issues.push({ level: 'warn', key: 'radio.bandwidth_khz', msg: `${cfg.radio.bandwidth_khz} kHz is not a width the ${module.name} offers (${module.bandwidths_khz.join(' / ')}); the firmware will use the nearest` });
  if (cfg.plan.frequencies_mhz.length > 1 && !cfg.plan.announce_qsy) issues.push({ level: 'info', key: 'plan.announce_qsy', msg: 'silent rotation: hunters must find each new frequency themselves' });
  if (templateManifest?.pins) for (const role of templateManifest.pins.required) if (!cfg.pins[role]) issues.push({ level: 'err', key: `pins.${role}`, msg: `${role} is required by ${templateManifest.id}` });
  if (cfg.id.telemetry.includes('batt') && !cfg.pins.batt_sense) issues.push({ level: 'info', key: 'id.telemetry', msg: 'battery telemetry requested but no batt_sense pin — ignored by the firmware' });
  return issues;
}
