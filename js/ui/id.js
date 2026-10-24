// id.js — Callsign & ID tab: callmessage, Morse settings, telemetry, the silent-when-unset rule.
// SPDX-License-Identifier: GPL-2.0-only
import * as kitsune from './kitsune.js';
import * as net from './net.js';
import { h, badge, field, numInput, check, fill } from './dom.js';
import * as morse from '../audio/morse.js';
import { Player, drawTrace } from '../audio/player.js';

let app, root; const player = new Player();
let callInput, previewBox, warnBox, titleBadge;
export function init(a, el) { app = a; root = el; kitsune.init(a); net.init(a); app.listeners.add(render); render('boot'); }

function idText() { const d = app.cfg.id; return d.callmessage + (d.telemetry.includes('batt') && app.cfg.pins?.batt_sense ? ' BAT 3V7' : '') + (d.telemetry.includes('chg') && app.family === 'foxlib-c' ? ' CHG' : ''); }

function renderPreview() {
  const d = app.cfg.id, unset = d.callmessage.includes(d.placeholder), bad = morse.unsendable(d.callmessage);
  const text = idText(), evs = morse.events(text, { wpm: d.wpm, toneHz: d.tone_hz });
  const secs = evs.reduce((a, [, ms]) => a + ms, 0) / 1000;
  fill(titleBadge, unset ? badge('not set', 'err') : badge('set', 'ok'));
  fill(warnBox, 
    app.family === 'drive' ? h('p.hint', {}, 'On the ', app.board.name, ' the page renders this whole message into the ID audio file itself. The firmware\'s own CALLSIGN setting becomes the first word reduced to A–Z and 0–9 (', h('code', {}, app.vendor.firmwareCallsign(d.callmessage.trim().split(/\s+/)[0]) || '—'), '); that is only used if the firmware ever regenerates its ID, e.g. after a hand edit of settings.txt.') : null,
    bad.length ? h('p.hint.warn', {}, `Not in the Morse table, will be skipped: ${bad.join(' ')}`) : null,
    unset ? h('p.hint.err', {}, `Still contains the placeholder "${d.placeholder}". The firmware will boot, print id=unset, and never key the transmitter. Deploy is blocked until a callsign is set.`) : null);
  const trace = h('canvas.preview', { style: 'height:90px' });
  const playBtn = h('button.btn', { onclick: () => { if (player.playing) { player.stop(); playBtn.textContent = 'Play ID'; playBtn.classList.remove('running'); return; } player.play(evs); playBtn.textContent = 'Stop'; playBtn.classList.add('running'); player.onDone = () => { playBtn.textContent = 'Play ID'; playBtn.classList.remove('running'); }; } }, 'Play ID');
  fill(previewBox, 
    h('p', {}, h('code', {}, text), ` · ${secs.toFixed(1)} s at ${d.wpm} WPM`),
    h('p.mono', { style: 'font-size:.85rem;color:var(--ink-2);word-break:break-word' }, morse.encode(text).map(w => w.join(' ')).join('  /  ')),
    h('div.screen', {}, trace),
    h('div.tools', { style: 'margin-top:10px' }, playBtn, h('span.hint', {}, 'Web Audio; same timing as the firmware.')));
  requestAnimationFrame(() => drawTrace(trace, evs));
}

function render(source) {
  if (app.isCompiled) return kitsune.renderId(root);
  if (app.isNet) return net.renderId(root);
  if (source === 'id-live') { renderPreview(); return; }
  const d = app.cfg.id;
  callInput = h('input', { type: 'text', value: d.callmessage, maxlength: 64, spellcheck: 'false', style: 'width:100%;text-transform:uppercase' });
  callInput.addEventListener('input', () => { d.callmessage = callInput.value.toUpperCase(); app.changed('id-live'); });
  previewBox = h('div'); warnBox = h('div'); titleBadge = h('span');
  fill(root, 
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Callsign and message ', titleBadge),
        field('callmessage', callInput, 'Your callsign plus a short message, e.g. W1ABC FOX or W1ABC FOXHUNT DE W1ABC. Letters, digits and / are sent; anything else is skipped.'),
        warnBox,
        h('div.two-col', {},
          field('Speed (WPM)', numInput(d.wpm, { min: 5, max: app.family === 'drive' ? 30 : 40, step: 1, onchange: v => { d.wpm = v; app.changed('id'); } })),
          field('Tone (Hz)', numInput(d.tone_hz, { min: app.family === 'drive' ? 100 : 300, max: app.family === 'drive' ? 2400 : 3000, step: 10, onchange: v => { d.tone_hz = v; app.changed('id'); } }), app.family === 'drive' ? 'up to 2400 Hz: the firmware samples audio at 5 kHz' : null)),
        app.family === 'drive' ? null : app.family === 'foxlib-c'
          ? check('Append CHG to the ID while the charger is active', d.telemetry.includes('chg'), v => { d.telemetry = v ? [...d.telemetry.filter(t => t !== 'chg'), 'chg'] : d.telemetry.filter(t => t !== 'chg'); app.changed('id'); }, 'This board has no battery voltage sense, only the charger\'s /CHG line: on USB power with a battery still filling the ID ends "… CHG"; off USB the word never appears. Handy on the bench, silent in the field.')
          : check('Append battery voltage to the ID (e.g. "BAT 3V7")', d.telemetry.includes('batt'), v => { d.telemetry = v ? [...d.telemetry.filter(t => t !== 'batt'), 'batt'] : d.telemetry.filter(t => t !== 'batt'); app.changed('id'); }, app.cfg.pins.batt_sense ? '' : '— no batt_sense pin set on the Board tab, so the firmware will ignore this')),
      h('div.card', {}, h('h3', {}, 'Preview'), previewBox)),
    app.family === 'drive' ? null : h('div.card', {}, h('h3', {}, 'Unset-callsign behaviour'),
      check('Transmit even if the callsign is unset (legacy warn-and-transmit)', d.tx_without_callsign, v => { d.tx_without_callsign = v; app.changed('id'); }),
      h('p.hint', {}, `Default off: a fox whose callmessage still contains "${d.placeholder}" stays silent and shows the unconfigured LED pattern (double blink every 2 s). The page refuses to deploy an unset callsign either way; this switch only changes what the firmware does if a bad fox.json reaches a board some other way.`)));
  renderPreview();
}
