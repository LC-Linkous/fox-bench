// spectrum.js — estimated RF spectrum of an FM fox transmission, from the same
// event stream the preview plays. An estimate, labelled as such: the real
// deviation depends on the PWM drive into the module's MIC input.
// SPDX-License-Identifier: GPL-2.0-only
//
// Model: narrowband FM. A tone at f_m with peak deviation Δf gives sidebands at
// carrier ± n·f_m with amplitude J_n(β), β = Δf / f_m. The PWM audio is a square
// wave, so odd harmonics (1/3, 1/5 …) are added as separate tones after a
// first-order low-pass that stands in for the module's mic filter. Tones are
// weighted by their share of keyed time; sideband powers are summed into bins.
// Carson's rule 2(Δf + f_max) is the occupied-bandwidth figure, with f_max the
// highest tone that still carries ≥ 20 % amplitude after the low-pass.

/** Bessel J_n(x) by series — fine for the β and n we meet (β ≤ ~12, n ≤ ~20). */
export function besselJ(n, x) {
  const half = x / 2; let sum = 0, term;
  let kfact = 1, nkfact = 1; for (let i = 2; i <= n; i++) nkfact *= i;
  for (let k = 0; k < 40; k++) {
    if (k > 0) { kfact *= k; nkfact *= (k + n); }
    term = Math.pow(-1, k) * Math.pow(half, 2 * k + n) / (kfact * nkfact);
    sum += term;
    if (Math.abs(term) < 1e-12 && k > n) break;
  }
  return sum;
}

/**
 * events: [[hz, ms], …]. Returns { bins: Map(offsetHz → power), lines: [{off, db}],
 * fmax, carsonHz, tones: [{hz, share}] }.
 */
export function estimate(events, { deviationHz = 2500, lowpassHz = 3000, binHz = 50, harmonics = 5 } = {}) {
  const share = new Map(); let keyed = 0;
  for (const [hz, ms] of events) { if (hz > 0) { share.set(hz, (share.get(hz) || 0) + ms); keyed += ms; } }
  if (!keyed) return { bins: new Map(), lines: [], fmax: 0, carsonHz: 2 * deviationHz, tones: [] };
  // tones with square-wave harmonics through a first-order low-pass
  const tones = [];
  for (const [hz, ms] of share) {
    const w = ms / keyed;
    for (let k = 1; k <= harmonics; k += 2) {
      const f = hz * k; const lp = 1 / Math.sqrt(1 + (f / lowpassHz) ** 2);
      const amp = lp / k;                                     // square wave: 1/k
      if (f > 20000 || amp < 0.02) continue;
      tones.push({ hz: f, amp, w, dev: deviationHz * amp });  // each harmonic deviates in proportion
    }
  }
  const bins = new Map();
  const add = (off, p) => { const b = Math.round(off / binHz) * binHz; bins.set(b, (bins.get(b) || 0) + p); };
  let fmax = 0;
  for (const t of tones) {
    const beta = t.dev / t.hz;
    const nmax = Math.min(40, Math.ceil(beta + 6 * Math.cbrt(beta) + 3));
    for (let n = 0; n <= nmax; n++) {
      const a = besselJ(n, beta); const p = a * a * t.w;
      if (p < 1e-7) continue;
      if (n === 0) add(0, p); else { add(n * t.hz, p); add(-n * t.hz, p); if (t.amp >= 0.2) fmax = Math.max(fmax, t.hz); }
    }
  }
  const peak = Math.max(...bins.values(), 1e-12);
  const lines = [...bins.entries()].map(([off, p]) => ({ off, db: 10 * Math.log10(p / peak) })).filter(l => l.db > -70).sort((a, b) => a.off - b.off);
  return { bins, lines, fmax, carsonHz: 2 * (deviationHz + fmax), tones };
}

/** Power fraction landing outside ±bw/2 (from the binned estimate). */
export function outsideFraction(est, bwHz) {
  let tot = 0, out = 0;
  for (const [off, p] of est.bins) { tot += p; if (Math.abs(off) > bwHz / 2) out += p; }
  return tot ? out / tot : 0;
}

export function drawSpectrum(canvas, est, { carrierMhz, bwKhz, deviationHz, spanKhz }) {
  const g = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 180;
  canvas.width = w * dpr; canvas.height = h * dpr; g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), v = k => css.getPropertyValue(k).trim();
  const padL = 8, padR = 8, top = 26, bottom = 30, plotH = h - top - bottom;
  const span = (spanKhz || Math.max(bwKhz * 1.5, est.carsonHz / 1000 * 0.75, 12)) * 1000;   // ± Hz
  const x = off => padL + (off + span) / (2 * span) * (w - padL - padR);
  const y = db => top + (-db / 60) * plotH;
  g.fillStyle = v('--screen'); g.fillRect(0, 0, w, h);
  // adjacent channels (dim) and the intended channel (accent)
  const bw = bwKhz * 1000;
  g.fillStyle = 'rgba(128,128,128,.10)';
  for (const c of [-bw, bw]) g.fillRect(x(c - bw / 2), top, x(c + bw / 2) - x(c - bw / 2), plotH);
  g.fillStyle = 'rgba(224,166,52,.16)'; g.fillRect(x(-bw / 2), top, x(bw / 2) - x(-bw / 2), plotH);
  g.strokeStyle = v('--accent'); g.lineWidth = 1.5; g.setLineDash([4, 3]);
  for (const e of [-bw / 2, bw / 2]) { g.beginPath(); g.moveTo(x(e), top); g.lineTo(x(e), top + plotH); g.stroke(); }
  g.setLineDash([]);
  // grid: dB lines
  g.strokeStyle = v('--grid'); g.lineWidth = 1; g.fillStyle = v('--ink-3'); g.font = '10px ' + v('--mono');
  for (const db of [0, -20, -40, -60]) { g.beginPath(); g.moveTo(padL, y(db)); g.lineTo(w - padR, y(db)); g.stroke(); g.fillText(`${db} dB`, padL + 2, y(db) - 2); }
  // spectral lines
  for (const l of est.lines) {
    const inside = Math.abs(l.off) <= bw / 2;
    g.strokeStyle = inside ? v('--tone') : v('--err'); g.lineWidth = Math.abs(l.off) < 1 ? 2.5 : 1.5;
    g.beginPath(); g.moveTo(x(l.off), y(l.db)); g.lineTo(x(l.off), top + plotH); g.stroke();
  }
  // Carson bracket
  const c2 = est.carsonHz / 2;
  g.strokeStyle = v('--info'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x(-c2), top - 8); g.lineTo(x(-c2), top - 2); g.lineTo(x(c2), top - 2); g.lineTo(x(c2), top - 8); g.stroke();
  g.fillStyle = v('--info'); g.font = '11px ' + v('--mono'); g.textAlign = 'center';
  g.fillText(`Carson ≈ ${(est.carsonHz / 1000).toFixed(1)} kHz`, x(0), top - 11);
  // x axis: kHz offsets and absolute MHz
  g.fillStyle = v('--ink-2'); g.font = '10px ' + v('--mono'); g.textAlign = 'center';
  const step = span > 30000 ? 10000 : span > 15000 ? 5000 : 2500;
  for (let off = -Math.floor(span / step) * step; off <= span; off += step) {
    g.strokeStyle = v('--grid'); g.beginPath(); g.moveTo(x(off), top + plotH); g.lineTo(x(off), top + plotH + 3); g.stroke();
    g.fillText(off === 0 ? `${carrierMhz.toFixed(4)} MHz` : `${off > 0 ? '+' : ''}${off / 1000} k`, x(off), h - 16);
  }
  g.fillStyle = v('--ink-3'); g.textAlign = 'left';
  g.fillText(`channel ${bwKhz} kHz · deviation ±${(deviationHz / 1000).toFixed(1)} kHz · f_max ${Math.round(est.fmax)} Hz`, padL + 2, h - 4);
}
