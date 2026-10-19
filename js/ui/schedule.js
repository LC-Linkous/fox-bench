// schedule.js — Schedule tab: fixed / popcorn / resurrection, with the predicted timeline.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select, numInput, check } from './dom.js';
import { timeline, drawTimeline } from '../audio/schedule.js';
import { airtime, fmtDuration } from '../model/airtime.js';

let app, root, horizonH = 4;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

const KINDS = { fixed: 'Fixed delay', popcorn: 'Popcorn — seeded clusters and dark periods', resurrection: 'Resurrection — plays dead on a seeded schedule' };
const kindsForTemplate = () => { const s = app.template.sections; return s.includes('schedule.*') ? Object.keys(KINDS) : Object.keys(KINDS).filter(k => s.includes('schedule.' + k)); };
function setKind(kind) {
  const s = app.cfg.schedule; if (s.kind === kind) return;
  app.cfg.schedule = kind === 'fixed' ? { kind, delay_ms: 30000 }
    : kind === 'popcorn' ? { kind, seed: 18, cluster: 2, cluster_gap_ms: 8000, dark_min_ms: 10000, dark_max_ms: 300000 }
    : { kind, seed: 1, delay_ms: 30000, alive_min_ms: 1800000, alive_max_ms: 3600000, dead_ms: 3600000, dit_min_ms: 180000, dit_max_ms: 300000, id_every: 3, dead_song: false };
  app.changed('schedule');
}
const secField = (label, key, hint, { min = 0, max = 86400 } = {}) => { const s = app.cfg.schedule; return field(label, h('div.row', {}, numInput(s[key] / 1000, { min, max, step: 1, onchange: v => { s[key] = Math.round(v * 1000); app.changed('schedule'); } }), h('span.suffix', {}, 's')), hint); };
const minField = (label, key, hint) => { const s = app.cfg.schedule; return field(label, h('div.row', {}, numInput(s[key] / 60000, { min: 0, max: 1440, step: 1, onchange: v => { s[key] = Math.round(v * 60000); app.changed('schedule'); } }), h('span.suffix', {}, 'min')), hint); };
const seedField = () => { const s = app.cfg.schedule; return field('Seed', h('div.row', {}, numInput(s.seed, { min: 0, max: 2147483647, step: 1, onchange: v => { s.seed = v; app.changed('schedule'); } }), h('button.btn.small', { onclick: () => { s.seed = Math.floor(Math.random() * 2147483647); app.changed('schedule'); } }, 'random')), 'Same seed, same timeline, on the board and here. Recorded in the fleet log so organisers can reconstruct every transmission time.'); };

function render() {
  if (app.family === 'drive') return renderDrive();
  const s = app.cfg.schedule, kinds = kindsForTemplate();
  const at = airtime(app.cfg, { images: app.images });
  const txMs = at.typical_ms, horizon = horizonH * 3600000;
  const items = timeline(s, txMs, horizon, { idMs: at.id_ms });
  const txCount = items.filter(i => i.kind === 'tx').length, onAir = items.filter(i => i.kind !== 'dead').reduce((a, i) => a + i.dur, 0);
  const canvas = h('canvas.preview', { style: 'height:96px' });
  let params;
  if (s.kind === 'fixed') params = [secField('Delay between transmissions', 'delay_ms', 'Gap from unkey to the next key-down. Longer = less airtime and battery, found less often.')];
  else if (s.kind === 'popcorn') params = [seedField(), h('div.two-col', {}, field('Transmissions per cluster', numInput(s.cluster, { min: 1, max: 50, step: 1, onchange: v => { s.cluster = v; app.changed('schedule'); } })), secField('Gap inside a cluster', 'cluster_gap_ms')), h('div.two-col', {}, secField('Dark period, min', 'dark_min_ms'), secField('Dark period, max', 'dark_max_ms')), h('p.hint', {}, 'Clusters of transmissions, then silence for a seeded-random dark period. Hunters waiting for the next transmission face an unpredictable wait; you don\'t.')];
  else params = [seedField(), h('div.two-col', {}, minField('Alive phase, min', 'alive_min_ms'), minField('Alive phase, max', 'alive_max_ms')), h('div.two-col', {}, secField('Delay while alive', 'delay_ms'), minField('Dead phase length', 'dead_ms')), h('div.two-col', {}, minField('Dead-phase dit interval, min', 'dit_min_ms'), minField('Dead-phase dit interval, max', 'dit_max_ms')), h('div.two-col', {}, field('Full ID every Nth dead wake', numInput(s.id_every, { min: 1, max: 100, step: 1, onchange: v => { s.id_every = v; app.changed('schedule'); } }), 'station-ID compliance while "dead"'), h('div.field', {}, h('label', {}, 'On those ID wakes'), check('also play a song', s.dead_song, v => { s.dead_song = v; app.changed('schedule'); }))), h('p.hint', {}, 'Alive: normal transmissions. Dead: a single dit every few minutes, with a full ID every Nth wake. Hunters must judge whether the fox has left the air or is worth waiting out. The dead-phase dit uses the ID\'s WPM and tone.')];

  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, field('Schedule', select(kinds.map(k => [k, KINDS[k]]), s.kind, setKind), kinds.length === 1 ? `The ${app.template.name} template reads only this schedule.` : null), ...params),
      h('div.card', {}, h('h3', {}, 'Airtime per transmission'),
        h('dl.kv', {}, h('dt', {}, 'Morse ID'), h('dd', {}, fmtDuration(at.id_ms)), h('dt', {}, 'Payload'), h('dd', {}, at.payload_ms.length ? at.payload_ms.map(fmtDuration).join(' / ') : '—'), at.qsy_ms ? h('dt', {}, 'QSY') : null, at.qsy_ms ? h('dd', {}, fmtDuration(at.qsy_ms)) : null, h('dt', {}, 'Typical'), h('dd', {}, fmtDuration(at.typical_ms)), h('dt', {}, 'Worst'), h('dd', {}, fmtDuration(at.worst_ms))),
        app.cfg.limits.max_keydown_s && at.worst_ms > app.cfg.limits.max_keydown_s * 1000 ? h('p.hint.warn', {}, `Exceeds the ${app.cfg.limits.max_keydown_s} s keydown limit set on Deploy; the firmware will cut the transmission there.`) : null)),
    h('div.card', {}, h('h3', {}, 'Timeline ', badge(`${txCount} transmissions in ${horizonH} h · ${fmtDuration(onAir)} on air`)),
      h('div.tools', { style: 'margin-bottom:8px' }, h('span.hint', {}, 'Horizon:'), [1, 2, 4, 8, 12].map(hh => h('button.btn.small', { 'aria-pressed': hh === horizonH ? 'true' : 'false', onclick: () => { horizonH = hh; render(); } }, hh + ' h'))),
      h('div.screen', {}, canvas),
      h('p.hint', {}, s.kind === 'fixed' ? 'Deterministic: every transmission at a fixed interval from power-on.' : 'Computed from the seed with the same generator the firmware uses, so this is the day the fox will actually have, counted from power-on. Shaded = dead phase; short grey marks = single dits.')));
  requestAnimationFrame(() => drawTimeline(canvas, items, horizon));
}
export function shown() { render(); }

/** Drive family (PicoFox): the firmware's one schedule, a duty cycle, drawn with its carrier offsets and power steps. */
let driveHorizonMin = 5;
function renderDrive() {
  const s = app.cfg.schedule, v = app.vendor, cfg = app.validCfg || app.cfg;
  if (s.kind !== 'duty') { app.cfg.schedule = { kind: 'duty', duty_percent: 100, pad_ms: 2000 }; app.changed('schedule'); return; }
  const horizon = driveHorizonMin * 60000, cyc = v.cycle(cfg, horizon);
  const canvas = h('canvas.preview', { style: 'height:120px' });
  const onAir = cyc.items.filter(i => i.kind !== 'off').reduce((a, i) => a + i.dur, 0);
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Duty cycle'),
        field('On-air share', h('div.row', {}, numInput(s.duty_percent, { min: 0, max: 100, step: 1, width: '100px', onchange: val => { s.duty_percent = Math.round(val); app.changed('schedule'); } }), h('span.suffix', {}, '%'), [100, 75, 50, 25].map(d => h('button.btn.small', { 'aria-pressed': s.duty_percent === d ? 'true' : 'false', onclick: () => { s.duty_percent = d; app.changed('schedule'); } }, d + ' %'))),
          'Written as DUTY_CYCLE. Below 100 the fox switches off after each audio + ID pass for (100 − duty) % of the time that pass took. 0 never transmits.'),
        field('Pause after each song', h('div.row', {}, numInput((s.pad_ms ?? 2000) / 1000, { min: 0, max: 60, step: 0.5, width: '100px', onchange: val => { s.pad_ms = Math.round(val * 1000); app.changed('schedule'); } }), h('span.suffix', {}, 's')), 'Silence inside the audio file: an unmodulated carrier, still on the air. Only the duty-cycle gap is really off.'),
        h('p.hint', {}, 'No popcorn or resurrection here: the firmware plays its audio file and ID back to back and only knows this one gap.')),
      h('div.card', {}, h('h3', {}, 'One cycle'),
        h('dl.kv', {}, h('dt', {}, 'Audio'), h('dd', {}, fmtDuration(cyc.audioMs)), h('dt', {}, 'Morse ID'), h('dd', {}, fmtDuration(cyc.idMs)), h('dt', {}, 'Off'), h('dd', {}, cyc.offMs ? fmtDuration(cyc.offMs) : 'none'), h('dt', {}, 'Period'), h('dd', {}, fmtDuration(cyc.periodMs)), h('dt', {}, 'ID every'), h('dd', {}, fmtDuration(cyc.periodMs))),
        h('p.hint', {}, 'The audio length sets the cycle, so the playlist length is also how often the fox IDs.'))),
    h('div.card', {}, h('h3', {}, 'Timeline ', badge(`${cyc.items.filter(i => i.kind === 'id').length} IDs in ${driveHorizonMin} min · ${fmtDuration(onAir)} on air`)),
      h('div.tools', { style: 'margin-bottom:8px' }, h('span.hint', {}, 'Horizon:'), [2, 5, 10, 30, 60].map(m => h('button.btn.small', { 'aria-pressed': m === driveHorizonMin ? 'true' : 'false', onclick: () => { driveHorizonMin = m; render(); } }, m + ' min'))),
      h('div.screen', {}, canvas),
      h('p.hint', {}, 'Blue = audio, yellow = Morse ID, dark = off. Height of each block is the carrier offset the firmware applies to that segment (0, ±1, ±3, ±5 kHz in a fixed order); the number under a cycle is the attenuation it runs at when the power steps (duty below 100 %, rev 3).')));
  requestAnimationFrame(() => drawCycle(canvas, cyc, horizon));
}

function drawCycle(canvas, cyc, horizonMs) {
  const g = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 800, h = canvas.clientHeight || 120;
  canvas.width = w * dpr; canvas.height = h * dpr; g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue('--screen'); g.fillRect(0, 0, w, h);
  const x = ms => ms / horizonMs * w, mid = h * 0.5, scale = (h * 0.36) / 5000;
  g.strokeStyle = css.getPropertyValue('--grid'); g.lineWidth = 1;
  for (const off of [-5000, -3000, -1000, 0, 1000, 3000, 5000]) { const y = mid - off * scale; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = css.getPropertyValue('--ink-3'); g.font = '10px ' + css.getPropertyValue('--mono');
  g.fillText('+5k', 2, mid - 5000 * scale - 2); g.fillText('0', 2, mid - 2); g.fillText('−5k', 2, mid + 5000 * scale + 10);
  const mins = horizonMs / 60000, step = mins <= 5 ? 0.5 : mins <= 10 ? 1 : mins <= 30 ? 5 : 10;
  for (let m = 0; m <= mins; m += step) { const px = x(m * 60000); g.beginPath(); g.moveTo(px, h - 14); g.lineTo(px, h); g.stroke(); g.fillText(m % 1 ? `${m * 60}s` : `${m}m`, px + 3, h - 3); }
  let lastAtt = null;
  for (const it of cyc.items) {
    if (it.kind === 'off') { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x(it.t), 0, Math.max(1, x(it.dur)), h - 14); continue; }
    const y = mid - it.offsetHz * scale;
    g.fillStyle = it.kind === 'id' ? css.getPropertyValue('--tone') : css.getPropertyValue('--info');
    g.fillRect(x(it.t), y - 4, Math.max(1.5, x(it.dur)), 8);
    if (it.kind === 'audio' && it.attenuation !== lastAtt && cyc.offMs) { g.fillStyle = css.getPropertyValue('--ink-2'); g.fillText(`att ${it.attenuation}`, x(it.t) + 2, h - 18); lastAtt = it.attenuation; }
  }
}
