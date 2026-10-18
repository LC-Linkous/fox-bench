// player.js — render an event stream with Web Audio, with a progress callback.
// SPDX-License-Identifier: GPL-2.0-only
// The fox drives the SA868's mic input with a 50 % PWM square wave; 'square'
// through a gentle low-pass is the closest match. 'sine' is easier on the ears.

export class Player {
  constructor() { this.ctx = null; this.nodes = []; this.timer = null; this.onProgress = null; this.onDone = null; this.wave = 'square'; this.volume = 0.25; }
  _ctx() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }

  /** events: [[hz, ms], …]. Coalesces consecutive same-frequency events into one envelope. */
  play(events, { speed = 1 } = {}) {
    this.stop();
    const ctx = this._ctx(), t0 = ctx.currentTime + 0.05;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
    const osc = ctx.createOscillator(); osc.type = this.wave; osc.frequency.value = 800;
    osc.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    let t = t0; const total = events.reduce((a, [, ms]) => a + ms, 0) / speed / 1000;
    let lastHz = -1;
    for (const [hz, msRaw] of events) {
      const ms = msRaw / speed;
      if (hz > 0) {
        if (lastHz <= 0) { gain.gain.setTargetAtTime(this.volume, t, 0.002); }
        osc.frequency.setValueAtTime(hz, t);
      } else if (lastHz > 0 || lastHz === -1) { gain.gain.setTargetAtTime(0, t, 0.002); }
      lastHz = hz; t += ms / 1000;
    }
    gain.gain.setTargetAtTime(0, t, 0.002);
    osc.start(t0); osc.stop(t + 0.1);
    this.nodes = [osc, gain, lp];
    const start = performance.now();
    this.timer = setInterval(() => {
      const el = (performance.now() - start) / 1000 - 0.05;
      if (this.onProgress) this.onProgress(Math.min(1, Math.max(0, el / total)), el, total);
      if (el >= total) { this.stop(); if (this.onDone) this.onDone(); }
    }, 50);
    return total;
  }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const n of this.nodes) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} }
    this.nodes = [];
  }
  get playing() { return !!this.timer; }
}

/** Draw an event stream as a frequency-vs-time trace (the "oscillograph" under Preview). */
export function drawTrace(canvas, events, { fmin = 200, fmax = 2600, color, segments } = {}) {
  const g = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 120;
  canvas.width = w * dpr; canvas.height = h * dpr; g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), v = k => css.getPropertyValue(k).trim();
  const top = segments?.length ? 14 : 0, bottom = 12, ph = h - top - bottom;
  g.fillStyle = v('--screen'); g.fillRect(0, 0, w, h);
  g.strokeStyle = v('--grid'); g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, top + ph * i / 4); g.lineTo(w, top + ph * i / 4); g.stroke(); }
  const total = events.reduce((a, [, ms]) => a + ms, 0); if (!total) return;
  const xOf = ms => ms / total * w;
  // time ticks: pick a step that gives ~80 px spacing
  const pxPerS = w / (total / 1000); const steps = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]; const step = steps.find(s => s * pxPerS >= 70) || 600;
  g.fillStyle = v('--ink-3'); g.font = '10px ' + v('--mono'); g.textAlign = 'left';
  for (let t = 0; t <= total / 1000; t += step) { const x = xOf(t * 1000); g.strokeStyle = v('--grid'); g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + ph); g.stroke(); g.fillText(t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${t}s`, x + 2, h - 2); }
  // segment markers
  if (segments?.length) {
    g.fillStyle = v('--ink-2'); g.font = '10px ' + v('--font');
    for (const sgm of segments) { const x = xOf(sgm.t); g.strokeStyle = v('--edge'); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, top + ph); g.stroke(); g.fillText(sgm.label, x + 3, 10); }
  }
  g.strokeStyle = color || v('--tone'); g.lineWidth = 2; let x = 0;
  for (const [hz, ms] of events) { const dx = xOf(ms); if (hz > 0) { const y = top + ph - (Math.min(fmax, Math.max(fmin, hz)) - fmin) / (fmax - fmin) * (ph - 8) - 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.max(dx, 0.5), y); g.stroke(); } x += dx; }
}

/** Spectrogram-style render for QRSS: time across, audio frequency up, tone as a bright line. */
export function drawWaterfall(canvas, events, { fmin = 300, fmax = 1300, segments } = {}) {
  drawTrace(canvas, events, { fmin, fmax, segments });
}
