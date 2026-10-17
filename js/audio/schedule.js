// schedule.js — the LCG from foxlib/schedule.py, and timelines built from it.
// SPDX-License-Identifier: GPL-2.0-only
// Same glibc constants, same integer arithmetic (BigInt keeps it exact), so the
// page predicts the fox's transmission times from the seed.

const A = 1103515245n, C = 12345n, M = 1n << 31n;
export function randNext(state) { const s = (A * BigInt(state) + C) % M; return [Number(s) / Number(M), Number(s)]; }
export function randInt(state, lo, hi) { const [v, s] = randNext(state); return [lo + Math.floor(v * (hi - lo + 1)), s]; }

/**
 * Build a timeline of transmissions for `horizonMs` of run time.
 * txMs: airtime of one transmission. Returns [{ t, dur, kind }] with kind
 * 'tx' | 'dit' | 'dead' (dead is a shaded phase, not a transmission).
 */
export function timeline(schedule, txMs, horizonMs = 8 * 3600 * 1000, { ditMs = 100, idMs = 20000 } = {}) {
  const out = []; let t = 0;
  if (schedule.kind === 'fixed') {
    while (t < horizonMs) { out.push({ t, dur: txMs, kind: 'tx' }); t += txMs + schedule.delay_ms; }
  } else if (schedule.kind === 'popcorn') {
    let state = schedule.seed, n = 0;
    while (t < horizonMs) {
      out.push({ t, dur: txMs, kind: 'tx' }); t += txMs; n++;
      if (n >= schedule.cluster) { n = 0; let d; [d, state] = randInt(state, schedule.dark_min_ms, schedule.dark_max_ms); t += d; }
      else t += schedule.cluster_gap_ms;
    }
  } else if (schedule.kind === 'resurrection') {
    let state = schedule.seed, alive; [alive, state] = randInt(state, schedule.alive_min_ms, schedule.alive_max_ms);
    let aliveUntil = alive, wakes = 0;
    while (t < horizonMs) {
      if (t < aliveUntil) { out.push({ t, dur: txMs, kind: 'tx' }); t += txMs + schedule.delay_ms; continue; }
      const deadStart = t, deadUntil = t + schedule.dead_ms; out.push({ t: deadStart, dur: schedule.dead_ms, kind: 'dead' });
      while (t < deadUntil && t < horizonMs) {
        wakes++;
        if (wakes % schedule.id_every === 0) { out.push({ t, dur: idMs + (schedule.dead_song ? txMs - idMs : 0), kind: 'tx' }); t += idMs; }
        else { out.push({ t, dur: ditMs, kind: 'dit' }); t += 250 + ditMs; }
        let gap; [gap, state] = randInt(state, schedule.dit_min_ms, schedule.dit_max_ms); t += gap;
      }
      t = Math.max(t, deadUntil);
      [alive, state] = randInt(state, schedule.alive_min_ms, schedule.alive_max_ms); aliveUntil = t + alive;
    }
  }
  return out;
}

export function drawTimeline(canvas, items, horizonMs) {
  const g = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 800, h = canvas.clientHeight || 90;
  canvas.width = w * dpr; canvas.height = h * dpr; g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue('--screen'); g.fillRect(0, 0, w, h);
  const x = ms => ms / horizonMs * w;
  g.fillStyle = 'rgba(228,90,80,.18)';
  for (const it of items) if (it.kind === 'dead') g.fillRect(x(it.t), 0, Math.max(1, x(it.dur)), h);
  g.strokeStyle = css.getPropertyValue('--grid'); g.lineWidth = 1; g.fillStyle = css.getPropertyValue('--ink-3'); g.font = '11px ' + css.getPropertyValue('--mono');
  const hours = horizonMs / 3600000; const step = hours <= 2 ? 0.25 : hours <= 8 ? 1 : 2;
  for (let hh = 0; hh <= hours; hh += step) { const px = x(hh * 3600000); g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke(); if (hh % (step * 2) === 0 || step >= 1) g.fillText(hh % 1 ? `${hh * 60}m` : `${hh}h`, px + 3, h - 4); }
  for (const it of items) {
    if (it.kind === 'dead') continue;
    g.fillStyle = it.kind === 'dit' ? css.getPropertyValue('--ink-2') : css.getPropertyValue('--accent');
    const top = it.kind === 'dit' ? h * 0.45 : h * 0.2; g.fillRect(x(it.t), top, Math.max(1.5, x(it.dur)), h * 0.5 - (it.kind === 'dit' ? h * 0.25 : 0));
  }
}
