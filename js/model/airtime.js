// airtime.js — how long one transmission keys the radio, from the same
// event streams the fox will play. Used by Deploy (against limits) and
// Schedule (timeline).
// SPDX-License-Identifier: GPL-2.0-only
import * as morse from '../audio/morse.js';
import * as melody from '../audio/melody.js';
import * as sstv from '../audio/sstv.js';

const sum = evs => evs.reduce((a, [, ms]) => a + ms, 0);

/** Returns { id_ms, payload_ms: [...per rotation item], qsy_ms, worst_ms, typical_ms } */
export function airtime(cfg, { images = [] } = {}) {
  const idText = cfg.id.callmessage + (cfg.id.telemetry.includes('batt') && cfg.pins.batt_sense ? ' BAT 3V7' : '');
  const p = cfg.payload;
  const ditMs = p.kind === 'none' && p.dit_s ? p.dit_s * 1000 : null;
  const id_ms = 750 + sum(morse.events(p.kind === 'none' && p.message ? p.message : idText, { wpm: cfg.id.wpm, toneHz: cfg.id.tone_hz, ditMs }));
  let payload_ms = [];
  if (p.kind === 'songs') payload_ms = p.playlist.map(s => 750 + sum(melody.events(s, p.articulation)));
  else if (p.kind === 'sstv') payload_ms = (images.length ? images : [null]).map(() => 750 + sstv.durationMs());
  const qsy_ms = cfg.plan.frequencies_mhz.length > 1 && cfg.plan.announce_qsy ? 750 + sum(morse.events('QSY 147.445', { wpm: cfg.id.wpm, toneHz: cfg.id.tone_hz })) : 0;
  const worst_ms = id_ms + (payload_ms.length ? Math.max(...payload_ms) : 0) + qsy_ms;
  const typical_ms = id_ms + (payload_ms.length ? payload_ms.reduce((a, b) => a + b, 0) / payload_ms.length : 0) + qsy_ms;
  return { id_ms, payload_ms, qsy_ms, worst_ms, typical_ms };
}

export function fmtDuration(ms) {
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m < 90 ? `${m} min ${r ? r + ' s' : ''}`.trim() : `${(m / 60).toFixed(1)} h`;
}
