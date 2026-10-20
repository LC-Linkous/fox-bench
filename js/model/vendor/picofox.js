// picofox.js — the AI6YM PicoFox as a "drive-configured" fox: what its firmware reads,
// how it behaves, and how a fox-bench config becomes the four files on its drive.
// Read docs/picofox-notes.md first. The firmware itself (CC BY-NC-SA 4.0) is not
// included or modified; everything here is derived from its documented file formats.
// SPDX-License-Identifier: GPL-2.0-only
import * as morse from '../../audio/morse.js';
import * as melody from '../../audio/melody.js';
import { renderPcm, wavBytes } from '../../audio/wav.js';

export const ID = 'picofox';
export const FILES = { settings: 'settings.txt', audio: 'audio.wav', id: '.callsign.wav', marker: '.settings_crc.bin' };
export const SAMPLE_RATE = 5000, MAX_DEVIATION_HZ = 10000, MAX_AUDIO_HZ = 2500;
/** Carrier offset applied segment by segment (audio, then ID, then audio …), kHz × 1000. Firmware constant. */
export const OFFSETS_HZ = [0, 1000, 3000, 5000, 3000, 1000, 0, -1000, -3000, -5000, -3000, -1000];
/** Attenuation steps added each off-cycle (duty < 100) on rev 3: base, +40, +20 → 0, −10, −5 dB. Firmware constant. */
export const ATTEN_CYCLE = [0, 40, 20];
export const DB_PER_STEP = 0.25, MAX_DBM = 18, EDGE_MARGIN_HZ = 2 * MAX_DEVIATION_HZ;
export const ZONE_MAX_MHZ = { 1: 146, 2: 148, 3: 148 }, MIN_MHZ = 144;
const KEYS = ['CALLSIGN', 'ITU_ZONE', 'FREQ_MHZ', 'DUTY_CYCLE', 'ATTENUATION', 'MORSE_WPM', 'MORSE_FARNSWORTH_WPM', 'MORSE_TONE', 'MORSE_TONE_VOL'];

/** What the firmware keys of a callsign: A–Z 0–9 only, upper-cased, at most 12. Everything else is dropped silently. */
export const firmwareCallsign = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
export const dropped = s => [...new Set([...(s || '').toUpperCase()].filter(c => !/[A-Z0-9]/.test(c)))];

/** settings.txt text → { KEY: 'value' } (raw strings, upper-cased keys, as the firmware reads them). */
export function parseSettings(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const i = line.indexOf('='); if (i < 0) continue;
    out[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim();
  }
  return out;
}
/** { KEY: value } → the exact text the firmware itself writes (same key order, %.6f frequency, trailing newline). */
export function serializeSettings(s) {
  const f = Number(s.FREQ_MHZ ?? 146.565).toFixed(6);
  return `CALLSIGN=${s.CALLSIGN ?? ''}\nITU_ZONE=${s.ITU_ZONE ?? 2}\nFREQ_MHZ=${f}\nDUTY_CYCLE=${s.DUTY_CYCLE ?? 100}\nATTENUATION=${s.ATTENUATION ?? 0}\nMORSE_WPM=${s.MORSE_WPM ?? 15}\nMORSE_FARNSWORTH_WPM=${s.MORSE_FARNSWORTH_WPM ?? 10}\nMORSE_TONE=${s.MORSE_TONE ?? 600}\nMORSE_TONE_VOL=${s.MORSE_TONE_VOL ?? 70}\n`;
}
/** The firmware's "CRC": the int32 sum of the bytes of settings.txt. Matching marker → it keeps .callsign.wav as is. */
export function byteSum(textOrBytes) {
  const b = typeof textOrBytes === 'string' ? new TextEncoder().encode(textOrBytes) : textOrBytes;
  let s = 0; for (const x of b) s = (s + x) | 0; return s;
}
export function markerBytes(sum) { const u = new Uint8Array(4); new DataView(u.buffer).setInt32(0, sum, true); return u; }
export function readMarker(bytes) { return bytes && bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true) : null; }

/** Band limits the firmware enforces for a zone, as MHz the carrier may sit on. */
export function allowedRange(zone) { return [MIN_MHZ + EDGE_MARGIN_HZ / 1e6, (ZONE_MAX_MHZ[zone] || 148) - EDGE_MARGIN_HZ / 1e6]; }

/** fox.json-shaped cfg → settings object for settings.txt. */
export function settingsFromCfg(cfg) {
  const r = cfg.radio, id = cfg.id;
  const vol = Math.max(1, Math.min(100, Math.round((r.id_deviation_hz || 5000) / MAX_DEVIATION_HZ * 100)));
  return {
    CALLSIGN: firmwareCallsign((id.callmessage || '').trim().split(/\s+/)[0]),
    ITU_ZONE: r.itu_zone ?? 2, FREQ_MHZ: cfg.plan.frequencies_mhz[0] ?? 146.565,
    DUTY_CYCLE: cfg.schedule.kind === 'duty' ? cfg.schedule.duty_percent : 100,
    ATTENUATION: r.attenuation ?? 0,
    MORSE_WPM: Math.max(1, Math.min(30, id.wpm)), MORSE_FARNSWORTH_WPM: Math.max(1, Math.min(30, id.wpm)),
    MORSE_TONE: Math.max(100, Math.min(2499, id.tone_hz)), MORSE_TONE_VOL: vol,
  };
}
/** settings object → the parts of a cfg it determines (merge over defaults). */
export function cfgFromSettings(s, defaults) {
  const cfg = structuredClone(defaults);
  const n = (k, d) => { const v = Number(s[k]); return Number.isFinite(v) ? v : d; };
  if (s.CALLSIGN) cfg.id.callmessage = s.CALLSIGN;
  cfg.radio.itu_zone = n('ITU_ZONE', 2); cfg.radio.attenuation = n('ATTENUATION', 0);
  cfg.radio.id_deviation_hz = Math.round(n('MORSE_TONE_VOL', 70) / 100 * MAX_DEVIATION_HZ);
  cfg.plan.frequencies_mhz = [n('FREQ_MHZ', 146.565)];
  cfg.schedule = { kind: 'duty', duty_percent: n('DUTY_CYCLE', 100), pad_ms: defaults.schedule?.pad_ms ?? 2000 };
  cfg.id.wpm = n('MORSE_WPM', 15); cfg.id.tone_hz = n('MORSE_TONE', 600);
  return cfg;
}

/** Events the ID audio will carry: the full callmessage in Morse at the ID tone. */
export const idEvents = cfg => morse.events(cfg.id.callmessage, { wpm: cfg.id.wpm, toneHz: cfg.id.tone_hz });
/** Events the audio file will carry: the payload, each item separated by a short pause. */
export function audioEvents(cfg) {
  const p = cfg.payload, pad = [0, cfg.schedule.pad_ms ?? 2000], out = [];
  if (p.kind === 'songs') for (const s of p.playlist) out.push(...melody.events(s, p.articulation), pad);
  else if (p.kind === 'none') out.push(...morse.events(p.message || cfg.id.callmessage, { wpm: cfg.id.wpm, toneHz: cfg.id.tone_hz, ditMs: p.dit_s ? p.dit_s * 1000 : null }), pad);
  if (!out.length) out.push([0, 1000]);     // the firmware needs some audio; a second of carrier
  return out;
}
const sum = evs => evs.reduce((a, [, ms]) => a + ms, 0);

/** The cycle as the firmware runs it: one audio + ID pass, the off gap, and the offset/power sequence over the horizon. */
export function cycle(cfg, horizonMs = 4 * 3600 * 1000) {
  const audioMs = sum(audioEvents(cfg)), idMs = sum(idEvents(cfg));
  const duty = cfg.schedule.kind === 'duty' ? Math.max(0, Math.min(100, cfg.schedule.duty_percent)) : 100;
  const onMs = audioMs + idMs, offMs = duty < 100 ? Math.round((100 - duty) * onMs / 100) : 0;
  const items = []; let t = 0, k = 0, n = 0;
  const atten = cfg.radio.attenuation ?? 0, stepping = duty < 100 && cfg.radio.revision !== 'r2';
  while (t < horizonMs && duty > 0) {
    const a = stepping ? Math.min(127, atten + ATTEN_CYCLE[n % 3]) : atten;
    items.push({ t, dur: audioMs, kind: 'audio', offsetHz: OFFSETS_HZ[k % 12], attenuation: a, dbm: MAX_DBM - a * DB_PER_STEP }); k++;
    items.push({ t: t + audioMs, dur: idMs, kind: 'id', offsetHz: OFFSETS_HZ[k % 12], attenuation: a, dbm: MAX_DBM - a * DB_PER_STEP }); k++;
    t += onMs;
    if (offMs) { items.push({ t, dur: offMs, kind: 'off' }); t += offMs; n++; }
  }
  return { audioMs, idMs, onMs, offMs, duty, periodMs: onMs + offMs, items, transmitting: duty > 0 };
}

/**
 * Validate a fox.json-shaped cfg against what the firmware will accept, filling defaults.
 * Returns { cfg, report: [{key, reason}], status, issues: [{level, key, msg, blocking?}] } — the same shape the page
 * uses for the foxlib family, so the tabs and Deploy need no special cases beyond the family switch.
 */
export function validate(user, defaults, board) {
  const cfg = structuredClone(defaults), report = [], issues = [];
  const u = user && typeof user === 'object' && !Array.isArray(user) ? user : {};
  const bad = (key, reason) => report.push({ key, reason });
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  for (const k of ['module', 'template', 'board', 'schema']) if (k in u) cfg[k] = u[k];
  const r = u.radio || {};
  if ('itu_zone' in r) { if ([1, 2, 3].includes(r.itu_zone)) cfg.radio.itu_zone = r.itu_zone; else bad('radio.itu_zone', '1 | 2 | 3'); }
  if ('attenuation' in r) { if (Number.isInteger(r.attenuation) && num(r.attenuation, 0, 127)) cfg.radio.attenuation = r.attenuation; else bad('radio.attenuation', '0–127'); }
  if ('revision' in r) { if (['r2', 'r3'].includes(r.revision)) cfg.radio.revision = r.revision; else bad('radio.revision', 'r2 | r3'); }
  for (const k of ['id_deviation_hz', 'audio_deviation_hz']) if (k in r) { if (num(r[k], 500, MAX_DEVIATION_HZ)) cfg.radio[k] = r[k]; else bad('radio.' + k, `500–${MAX_DEVIATION_HZ} Hz`); }
  if ('tone_shape' in r) { if (['sine', 'bright'].includes(r.tone_shape)) cfg.radio.tone_shape = r.tone_shape; else bad('radio.tone_shape', 'sine | bright'); }
  if ('preemphasis' in r) { if (typeof r.preemphasis === 'boolean') cfg.radio.preemphasis = r.preemphasis; else bad('radio.preemphasis', 'bool'); }
  if ('bandwidth_khz' in r) { if (num(r.bandwidth_khz, 1, 100)) cfg.radio.bandwidth_khz = r.bandwidth_khz; else bad('radio.bandwidth_khz', '1–100'); }
  if ('power_dbm' in r) cfg.radio.power_dbm = r.power_dbm === null || num(r.power_dbm, -40, 40) ? r.power_dbm : (bad('radio.power_dbm', 'null or dBm'), null);
  const p = u.plan || {};
  if ('frequencies_mhz' in p) { if (Array.isArray(p.frequencies_mhz) && p.frequencies_mhz.length && p.frequencies_mhz.every(f => num(f, 1, 1000))) cfg.plan.frequencies_mhz = [p.frequencies_mhz[0]]; else bad('plan.frequencies_mhz', 'one frequency'); }
  if (Array.isArray(p.frequencies_mhz) && p.frequencies_mhz.length > 1) issues.push({ level: 'warn', key: 'plan.frequencies_mhz', msg: 'the PicoFox transmits on one frequency; only the first entry is used' });
  const d = u.id || {};
  if ('callmessage' in d) { if (typeof d.callmessage === 'string' && d.callmessage.length >= 1 && d.callmessage.length <= 64) cfg.id.callmessage = d.callmessage; else bad('id.callmessage', '1–64 chars'); }
  if ('placeholder' in d && typeof d.placeholder === 'string' && d.placeholder) cfg.id.placeholder = d.placeholder;
  if ('wpm' in d) { if (Number.isInteger(d.wpm) && num(d.wpm, 5, 30)) cfg.id.wpm = d.wpm; else bad('id.wpm', '5–30'); }
  if ('tone_hz' in d) { if (Number.isInteger(d.tone_hz) && num(d.tone_hz, 100, 2400)) cfg.id.tone_hz = d.tone_hz; else bad('id.tone_hz', '100–2400'); }
  if ('tx_without_callsign' in d && typeof d.tx_without_callsign === 'boolean') cfg.id.tx_without_callsign = d.tx_without_callsign;
  const pl = u.payload;
  if (pl && typeof pl === 'object') {
    if (pl.kind === 'songs') {
      const songs = Array.isArray(pl.playlist) ? pl.playlist.filter((s, i) => { const ok = s && typeof s.name === 'string' && num(s.tempo, 40, 300) && Array.isArray(s.notes) && s.notes.length; if (!ok) bad(`payload.playlist[${i}]`, 'bad song'); return ok; }) : [];
      cfg.payload = { kind: 'songs', articulation: num(pl.articulation, 0.5, 1) ? pl.articulation : 0.875, skip_on_low_battery: false, playlist: songs.length ? songs : (bad('payload.playlist', 'empty'), defaults.payload.playlist) };
    } else if (pl.kind === 'none') {
      cfg.payload = { kind: 'none', dit_s: pl.dit_s == null ? null : num(pl.dit_s, 0.05, 30) ? pl.dit_s : (bad('payload.dit_s', '0.05–30'), null), message: typeof pl.message === 'string' ? pl.message : null };
    } else bad('payload.kind', 'songs | none (the PicoFox plays audio; no SSTV at 5 kHz sampling)');
  }
  const s = u.schedule;
  if (s && typeof s === 'object') {
    if (s.kind === 'duty') cfg.schedule = { kind: 'duty', duty_percent: Number.isInteger(s.duty_percent) && num(s.duty_percent, 0, 100) ? s.duty_percent : (bad('schedule.duty_percent', '0–100'), 100), pad_ms: Number.isInteger(s.pad_ms) && num(s.pad_ms, 0, 60000) ? s.pad_ms : 2000 };
    else { bad('schedule.kind', 'duty (the PicoFox firmware has one schedule: a duty cycle)'); }
  }
  if (u.fleet && typeof u.fleet === 'object') cfg.fleet = { ...cfg.fleet, ...u.fleet };
  if (u.limits && typeof u.limits === 'object') cfg.limits = { ...cfg.limits, ...u.limits };
  cfg.pins = {};

  // ---- page checks: what the firmware would do with this, silently
  const f = cfg.plan.frequencies_mhz[0], [lo, hi] = allowedRange(cfg.radio.itu_zone);
  if (f < lo || f > hi) issues.push({ level: 'err', key: 'plan.frequencies_mhz', msg: `${f} MHz is outside what the firmware allows for ITU zone ${cfg.radio.itu_zone} (${lo}–${hi} MHz, 20 kHz inside the band edges). The fox would stay silent.` });
  if (cfg.id.callmessage.includes(cfg.id.placeholder)) issues.push({ level: 'err', key: 'id.callmessage', msg: `callsign not set (still contains ${cfg.id.placeholder})` });
  const cs = firmwareCallsign(cfg.id.callmessage.trim().split(/\s+/)[0]);
  if (!cs) issues.push({ level: 'err', key: 'id.callmessage', msg: 'the first word of the ID has no A–Z/0–9 characters; the firmware needs a non-empty CALLSIGN or it stays silent' });
  const dr = dropped(cfg.id.callmessage.trim().split(/\s+/)[0]);
  if (dr.length) issues.push({ level: 'info', key: 'id.callmessage', msg: `CALLSIGN setting becomes "${cs}": the firmware keeps only A–Z and 0–9 (dropped: ${dr.join(' ')}). Your full ID "${cfg.id.callmessage}" is still sent, from the audio the page writes.` });
  const un = morse.unsendable(cfg.id.callmessage); if (un.length) issues.push({ level: 'warn', key: 'id.callmessage', msg: `not in the Morse table, will be skipped: ${un.join(' ')}` });
  if (cfg.schedule.duty_percent === 0) issues.push({ level: 'err', key: 'schedule.duty_percent', msg: 'duty cycle 0 %: the firmware never transmits' });
  if (cfg.radio.revision === 'r2' && cfg.radio.attenuation) issues.push({ level: 'warn', key: 'radio.attenuation', msg: 'rev 2 boards have no attenuator; ATTENUATION is ignored' });
  if (cfg.radio.id_deviation_hz > 5000 || cfg.radio.audio_deviation_hz > 5000) issues.push({ level: 'warn', key: 'radio.id_deviation_hz', msg: 'deviation above ±5 kHz is wider than a 12.5/25 kHz FM channel expects; receivers may distort and neighbours will notice' });
  if (cfg.payload.kind === 'songs') {
    const high = cfg.payload.playlist.flatMap(s => s.notes.filter(n => n[0] && melody.midiHz(n[0]) > MAX_AUDIO_HZ - 100).map(n => melody.noteName(n[0])));
    if (high.length) issues.push({ level: 'warn', key: 'payload.playlist', msg: `notes above the 5 kHz sample rate's reach are dropped an octave: ${[...new Set(high)].join(' ')}` });
  }
  if (cfg.payload.kind === 'none' && cfg.payload.message && cfg.payload.message.includes(cfg.id.placeholder)) issues.push({ level: 'err', key: 'payload.message', msg: 'message contains the placeholder' });
  const status = report.length ? `partial(${report.map(x => x.key).join(',')})` : 'ok';
  return { cfg, report, fatal: null, status, issues };
}

/** The four files, as { path, data (Uint8Array|string), why }. */
export function files(cfg) {
  const settings = serializeSettings(settingsFromCfg(cfg));
  const tone = { shape: cfg.radio.tone_shape || 'sine', preemphasis: cfg.radio.preemphasis !== false };
  const idPcm = renderPcm(idEvents(cfg), { sampleRate: SAMPLE_RATE, level: (cfg.radio.id_deviation_hz || 5000) / MAX_DEVIATION_HZ, maxHz: MAX_AUDIO_HZ - 100, ...tone });
  const auPcm = renderPcm(audioEvents(cfg), { sampleRate: SAMPLE_RATE, level: (cfg.radio.audio_deviation_hz || 5000) / MAX_DEVIATION_HZ, maxHz: MAX_AUDIO_HZ - 100, ...tone });
  return [
    { path: FILES.settings, data: settings, why: 'frequency, zone, duty, attenuation, callsign' },
    { path: FILES.audio, data: wavBytes(auPcm, SAMPLE_RATE), why: `payload audio, ${(auPcm.length / SAMPLE_RATE).toFixed(1)} s, ±${cfg.radio.audio_deviation_hz || 5000} Hz, ${tone.shape}${tone.preemphasis ? ' + pre-emphasis' : ''}` },
    { path: FILES.id, data: wavBytes(idPcm, SAMPLE_RATE), why: `Morse ID "${cfg.id.callmessage}", ${(idPcm.length / SAMPLE_RATE).toFixed(1)} s, ±${cfg.radio.id_deviation_hz || 5000} Hz` },
    { path: FILES.marker, data: markerBytes(byteSum(settings)), why: 'byte-sum of settings.txt so the firmware keeps our ID audio' },
  ];
}

/** Lines the board prints on its serial port at boot; what "fox running" looks like. */
export const BOOT_OK = /si5351 setup complete/;
export const BOOT_REGEN = /generating new callsign audio/;
