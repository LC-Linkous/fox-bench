// radio.js — Radio tab: module, Probe, power, bandwidth, squelch/volume.
// SPDX-License-Identifier: GPL-2.0-only
import * as kitsune from './kitsune.js';
import * as net from './net.js';
import { h, badge, field, select, numInput, check } from './dom.js';
import { REQUIRED_PINS, OPTIONAL_PINS, PIN_FLAGS } from '../model/schema.js';

const ROLE_HELP = {
  ptt: 'Push-to-talk. Low = transmit.', pd: 'Power-down. Held high keeps the module awake.', hl: 'High/low power select. Low = low power (default).',
  uart_tx: 'Serial to the module (AT commands).', uart_rx: 'Serial from the module.', audio: 'PWM tone into the module\'s MIC input.',
  led: 'Status LED, one blink per cycle. Optional.', batt_sense: 'ADC pin on a battery divider. Leave unset if no divider is fitted — a floating pin reads garbage.',
};

/** Role → pin table for the foxlib family: how the module is wired to the board. */
function pinCard() {
  const b = app.board, cfg = app.cfg, pins = cfg.pins;
  const probs = Object.fromEntries(app.report.filter(r => r.key.startsWith('pins.')).map(r => [r.key.slice(5), r.reason]));
  for (const i of app.issues) if (i.key.startsWith('pins.')) probs[i.key.slice(5)] = probs[i.key.slice(5)] || i.msg;
  const used = new Map(); for (const r of [...REQUIRED_PINS, ...OPTIONAL_PINS]) if (pins[r]) used.set(pins[r], r);
  const required = new Set(app.template.pins.required);
  const rows = [...REQUIRED_PINS, ...OPTIONAL_PINS].map(role => {
    const flag = PIN_FLAGS[role];
    const opts = [['', '— none —'], ...b.pins.filter(p => !flag || p[flag]).map(p => [p.name, `${p.name}  (GPIO${p.gpio}${p.aliases?.length ? ', ' + p.aliases.join('/') : ''})${used.has(p.name) && used.get(p.name) !== role ? '  · used by ' + used.get(p.name) : ''}${p.note ? '  · ' + p.note : ''}`])];
    const sel = select(opts, pins[role] || '', v => { cfg.pins[role] = v || null; app.changed('pins'); });
    if (required.has(role)) sel.querySelector('option[value=""]').disabled = true;
    const def = app.defaults.pins[role];
    return h('tr', { class: probs[role] ? 'bad' : '' },
      h('td.mono', {}, role, required.has(role) ? '' : h('span.hint', {}, ' optional')),
      h('td', {}, sel),
      h('td.mono', {}, def || '—', def !== (pins[role] || null) ? h('button.btn.small', { style: 'margin-left:8px', onclick: () => { cfg.pins[role] = def; app.changed('pins'); } }, 'reset') : null),
      h('td', {}, probs[role] ? h('span.hint.err', {}, probs[role]) : h('span.hint', {}, ROLE_HELP[role])));
  });
  return h('div.card', {}, h('h3', {}, `Wiring: ${b.name} → module `, app.report.some(r => r.key.startsWith('pins.')) ? badge('check', 'err') : badge('ok', 'ok')),
    h('p.hint', {}, 'Defaults come from the board descriptor; change them if your carrier PCB is wired differently. Written into fox.json in full. The firmware resolves each name with ', h('code', {}, 'getattr(board, name)'), ' at boot; an invalid required pin makes the fox boot silent rather than key unknown pins.'),
    h('div.grid-wrap', {}, h('table.grid', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Role'), h('th', {}, 'Pin'), h('th', {}, 'Default'), h('th', {}, ''))), h('tbody', {}, rows))));
}

let app, root, probeOut = null;
export function init(a, el) { app = a; root = el; kitsune.init(a); net.init(a); app.listeners.add(render); render(); }   // kitsune.init before the first render: a saved kitsune form renders this tab at boot, before the ID tab's init

async function probe(btn) {
  btn.disabled = true; btn.textContent = 'Probing…'; probeOut = null;
  try {
    const res = JSON.parse(await app.device.bench('probe', { freqs: [146.5, 433.5] }));
    const vhf = !!res['146.5'], uhf = !!res['433.5'];
    probeOut = { vhf, uhf, text: `146.5 MHz ${vhf ? 'accepted' : 'rejected'} · 433.5 MHz ${uhf ? 'accepted' : 'rejected'}` };
    const guess = vhf && uhf ? 'sa868_dual' : vhf ? 'sa868_vhf' : uhf ? 'sa868_uhf' : null;
    if (guess && guess !== app.moduleId) { app.setModule(guess); app.console.dim(`probe: module set to ${guess}`); }
  } catch (e) { probeOut = { text: 'probe failed: ' + (e.message || e) }; }
  render();
}

function render() {
  if (app.isCompiled) return kitsune.renderRadio(root);
  if (app.isNet) return net.renderRadio(root);
  const cfg = app.cfg, r = cfg.radio, m = app.module;
  if (app.family === 'drive') return renderDrive();
  if (app.family === 'foxlib-c') return renderFoxlibC();
  const canProbe = app.connected && (app.device.kind === 'demo' || app.onBoard.foxlibVersion);
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Module'),
        field('Radio module', select(Object.values(app.catalog.modules).map(x => [x.id, x.name]), app.moduleId, id => app.setModule(id)), 'The board doesn\'t know which module is soldered next to it. Ranges below are copied into fox.json so the firmware can refuse out-of-range frequencies.'),
        h('dl.kv', {}, h('dt', {}, 'Ranges'), h('dd', {}, m.ranges_mhz.map(([a, b]) => `${a}–${b} MHz`).join(' and ')), h('dt', {}, 'Power'), h('dd', {}, `low ${m.power_dbm.low} dBm · high ${m.power_dbm.high} dBm`), h('dt', {}, 'Channel widths'), h('dd', {}, (m.bandwidths_khz || []).join(' / ') + ' kHz')),
        h('div.tools', { style: 'margin-top:12px' },
          h('button.btn', { disabled: !canProbe, onclick: e => probe(e.currentTarget) }, 'Probe fitted band'),
          h('span.hint', {}, canProbe ? 'Retunes the receiver to 146.5 and 433.5 MHz and reads the module\'s reply. Nothing is transmitted.' : 'Needs a connected board with the fox firmware deployed.')),
        probeOut ? h('p.hint' + (probeOut.vhf || probeOut.uhf ? '.ok' : '.err'), {}, probeOut.text) : null),
      h('div.card', {}, h('h3', {}, 'Settings'),
        field('Power level', h('div.row', {},
          select([['low', `Low — nominal ${m.power_dbm.low} dBm`], ['high', `High — nominal ${m.power_dbm.high} dBm`]], r.high_power ? 'high' : 'low', v => { r.high_power = v === 'high'; r.power_dbm = null; app.changed('radio'); }),
          numInput(r.power_dbm ?? (r.high_power ? m.power_dbm.high : m.power_dbm.low), { min: 0, max: 40, step: 'any', width: '110px', onchange: v => { r.power_dbm = v; app.changed('radio'); } }), h('span.suffix', {}, 'dBm'),
          r.power_dbm != null ? h('button.btn.small', { onclick: () => { r.power_dbm = null; app.changed('radio'); } }, 'nominal') : null),
          `The ${m.model || 'module'} has two output levels selected by the HL pin; the firmware drives that pin. The dBm box is what the level measures as on your bench: it is stored in fox.json and the fleet log so a profile carries its real power. Nominal values come from the module descriptor.`),
        field('Channel width', h('div.row', {},
          numInput(r.bandwidth_khz, { min: 1, max: 100, step: 'any', width: '110px', onchange: v => { r.bandwidth_khz = v; app.changed('radio'); } }), h('span.suffix', {}, 'kHz'),
          (m.bandwidths_khz || []).map(b => h('button.btn.small', { 'aria-pressed': r.bandwidth_khz === b ? 'true' : 'false', onclick: () => { r.bandwidth_khz = b; app.changed('radio'); } }, `${b}`))),
          (m.bandwidths_khz || []).includes(r.bandwidth_khz) ? `Widths this module offers: ${(m.bandwidths_khz || []).join(' / ')} kHz.` : null),
        !(m.bandwidths_khz || []).includes(r.bandwidth_khz) ? h('p.hint.warn', {}, `${r.bandwidth_khz} kHz is not a width the ${m.name} offers (${(m.bandwidths_khz || []).join(' / ')}). The firmware will use the nearest; the value is kept as entered.`) : null,
        h('div.two-col', {},
          field('Squelch (0–8)', numInput(r.squelch, { min: 0, max: 8, step: 1, onchange: v => { r.squelch = v; app.changed('radio'); } })),
          field('Volume (1–8)', numInput(r.volume, { min: 1, max: 8, step: 1, onchange: v => { r.volume = v; app.changed('radio'); } }))),
        h('p.hint', {}, 'Squelch and volume are receive-side settings on the module. They do not change the transmitted signal; they are here because the module\'s setup sequence sets them, and because a receive-triggered fox would use them. Transmitted audio level is the PWM on the audio pin.'))),
    pinCard(),
    h('div.card', {}, h('h3', {}, 'Region ', badge(app.region)),
      field('Band plan used for validation', select(Object.keys(app.catalog.bands).map(k => [k, k]), app.region, v => { app.region = v; app.changed('region'); }),
        'Used only to check frequencies. Entries outside these bands are flagged in red and confirmed at deploy rather than refused, so bench and emissions testing into a load stays possible. Staying within your licence privileges is yours to confirm.')));
}

/** Drive family (PicoFox): zone, attenuation, deviation. No module choice, no squelch/volume, no probe. */
function renderDrive() {
  const cfg = app.cfg, r = cfg.radio, m = app.module, v = app.vendor;
  const [lo, hi] = v.allowedRange(r.itu_zone);
  const dbm = r.revision === 'r2' ? v.MAX_DBM : v.MAX_DBM - (r.attenuation || 0) * v.DB_PER_STEP;
  const devField = (label, key, hint) => field(label, h('div.row', {},
    numInput(r[key], { min: 500, max: v.MAX_DEVIATION_HZ, step: 100, width: '110px', onchange: val => { r[key] = Math.round(val); app.changed('radio'); } }), h('span.suffix', {}, 'Hz peak'),
    [2500, 5000, 7000].map(d => h('button.btn.small', { 'aria-pressed': r[key] === d ? 'true' : 'false', onclick: () => { r[key] = d; app.changed('radio'); } }, `±${d / 1000} kHz`))), hint);
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Transmitter'),
        h('dl.kv', {}, h('dt', {}, 'Module'), h('dd', {}, m.name), h('dt', {}, 'Band'), h('dd', {}, `${lo}–${hi} MHz for ITU zone ${r.itu_zone} (20 kHz inside the band edges, as the firmware enforces)`), h('dt', {}, 'Modulation'), h('dd', {}, `FM, audio up to ${m.audio.max_audio_hz} Hz, deviation set by the audio level`)),
        field('ITU zone', select([[1, '1 — 144–146 MHz (Europe, Africa, Middle East, N. Asia)'], [2, '2 — 144–148 MHz (Americas)'], [3, '3 — 144–148 MHz (Asia-Pacific)']], r.itu_zone, val => { r.itu_zone = +val; app.changed('radio'); }), 'Written as ITU_ZONE. Only the band edge changes.'),
        field('Board revision', select([['r3', 'rev 3 — has the attenuator'], ['r2', 'rev 2 — no attenuator']], r.revision, val => { r.revision = val; app.changed('radio'); }), 'The firmware reads this from ID pins; the page cannot. Listen only shows "Revision: N" at boot if you are unsure.')),
      h('div.card', {}, h('h3', {}, 'Power'),
        field('Attenuation', h('div.row', {}, Object.assign(numInput(r.attenuation, { min: 0, max: 127, step: 1, width: '90px', onchange: val => { r.attenuation = Math.round(val); app.changed('radio'); } }), { style: 'width:90px;flex:0 0 auto' }), h('span.suffix', {}, `× ${v.DB_PER_STEP} dB = −${((r.attenuation || 0) * v.DB_PER_STEP).toFixed(2)} dB`),
          [0, 20, 40, 80, 127].map(a => h('button.btn.small', { 'aria-pressed': r.attenuation === a ? 'true' : 'false', onclick: () => { r.attenuation = a; app.changed('radio'); } }, String(a)))),
          `About ${dbm.toFixed(1)} dBm out (${(Math.pow(10, dbm / 10)).toFixed(dbm > 10 ? 0 : 1)} mW) from the ${v.MAX_DBM} dBm the vendor quotes at attenuation 0. Rev 2 boards ignore this.`),
        r.attenuation && cfg.schedule.kind === 'duty' && cfg.schedule.duty_percent < 100 && r.revision !== 'r2' ? h('p.hint', {}, `Below 100 % duty the firmware cycles the attenuation ${r.attenuation} → ${Math.min(127, r.attenuation + 40)} → ${Math.min(127, r.attenuation + 20)} (0 / −10 / −5 dB) on successive cycles.`) : null,
        field('Measured power', h('div.row', {}, numInput(r.power_dbm ?? '', { min: -40, max: 40, step: 'any', width: '110px', onchange: val => { r.power_dbm = val; app.changed('radio'); } }), h('span.suffix', {}, 'dBm'), r.power_dbm != null ? h('button.btn.small', { onclick: () => { r.power_dbm = null; app.changed('radio'); } }, 'clear') : null), 'Optional: what your meter says at this attenuation; kept with the profile and the fleet log.'))),
    h('div.card', {}, h('h3', {}, 'Deviation'),
      h('div.two-col', {},
        devField('Morse ID', 'id_deviation_hz', `The firmware's own ID runs at ±7 kHz (MORSE_TONE_VOL 70). ±5 kHz is standard narrowband FM.`),
        devField('Audio payload', 'audio_deviation_hz', 'Peak deviation of the songs or message. The factory audio peaks at about ±5 kHz.')),
      h('p.hint', {}, `Deviation is the WAV level: full scale is ±${v.MAX_DEVIATION_HZ / 1000} kHz. Above ±5 kHz the signal is wider than a 12.5/25 kHz channel expects. The carrier itself also steps ±5 kHz segment by segment (firmware behaviour, see the Schedule tab), so a receiver sees up to ±10 kHz of movement in total.`),
      h('div.two-col', {},
        field('Tone shape', select([['bright', 'Bright — odd harmonics, like the ESP32\'s PWM tone'], ['sine', 'Sine — pure tone']], r.tone_shape || 'bright', val => { r.tone_shape = val; app.changed('radio'); }), 'The SA868 fox plays a square wave; a pure sine through the same receiver sounds duller.'),
        h('div.field', {}, h('label', {}, 'Pre-emphasis'), check('Boost highs 6 dB/octave like a voice radio\'s transmitter', r.preemphasis !== false, val => { r.preemphasis = val; app.changed('radio'); }, 'Receivers cut highs back (de-emphasis). The SA868 pre-emphasises; the PicoFox modulates straight from the samples, so without this low notes come out muffled.')))),
    h('div.card', {}, h('h3', {}, 'Region ', badge(app.region)),
      field('Band plan used for validation', select(Object.keys(app.catalog.bands).map(k => [k, k]), app.region, val => { app.region = val; app.changed('region'); }), 'The firmware\'s own limit (zone) is what matters here; the region table is shown on the Frequency tab for reference.')));
}

/** foxlib-c family (PicoFox, fox-bench firmware): zone, power, deviation, tone shape, sample rate. No module choice, no pins. */
function renderFoxlibC() {
  const cfg = app.cfg, r = cfg.radio, m = app.module;
  const zoneHi = r.itu_zone === 1 ? 146.0 : 148.0;
  const MAX_DBM = m.power_dbm.high, DB_PER_STEP = m.attenuation?.db_per_step || 0.25;
  const dbm = MAX_DBM - (r.attenuation || 0) * DB_PER_STEP;
  const devField = (label, key, hint) => field(label, h('div.row', {},
    numInput(r[key], { min: 500, max: 10000, step: 100, width: '110px', onchange: val => { r[key] = Math.round(val); app.changed('radio'); } }), h('span.suffix', {}, 'Hz peak'),
    [2500, 5000, 7000].map(d => h('button.btn.small', { 'aria-pressed': r[key] === d ? 'true' : 'false', onclick: () => { r[key] = d; app.changed('radio'); } }, `±${d / 1000} kHz`))), hint);
  const sr = r.sample_rate || 8000;
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Transmitter'),
        h('dl.kv', {}, h('dt', {}, 'Module'), h('dd', {}, m.name), h('dt', {}, 'Band'), h('dd', {}, `144–${zoneHi} MHz for ITU zone ${r.itu_zone}; the firmware keeps 20 kHz clear of the edges`), h('dt', {}, 'Modulation'), h('dd', {}, `FM: the firmware rewrites the PLL fraction ${sr} times a second; audio up to ${Math.floor(sr / 2) - 100} Hz`)),
        field('ITU zone', select([[1, '1 — 144–146 MHz (Europe, Africa, Middle East, N. Asia)'], [2, '2 — 144–148 MHz (Americas)'], [3, '3 — 144–148 MHz (Asia-Pacific)']], r.itu_zone, val => { r.itu_zone = +val; app.changed('radio'); }), 'Only the upper band edge changes.'),
        h('div.two-col', {},
          field('FM update rate', h('div.row', {}, numInput(sr, { min: 4000, max: 10000, step: 1000, width: '110px', onchange: val => { r.sample_rate = Math.round(val); app.changed('radio'); } }), h('span.suffix', {}, 'samples/s')), '8000 is the design point (one I²C fraction write fits in 125 µs). The banner\'s console "status" shows the measured write time; drop to 5000 if the log reports late samples.'),
          field('Reference correction', h('div.row', {}, numInput(r.correction_ppm || 0, { min: -200, max: 200, step: 0.1, width: '110px', onchange: val => { r.correction_ppm = val; app.changed('radio'); } }), h('span.suffix', {}, 'ppm')), 'The TCXO is ±2 ppm class (±300 Hz at 146 MHz). Measure the carrier with a counter or a receiver you trust and enter the correction here; 0 trusts the TCXO.')),
        h('div.field', {}, h('label', {}, 'While a computer has the drive'), check('Keep transmitting while the FOXBENCH drive is mounted', r.tx_while_mounted !== false, val => { r.tx_while_mounted = val; app.changed('radio'); }, 'On: the fox runs its cycle on the bench with USB plugged in (a dummy load, please), and reloads a second after each deploy. Off: it stays silent until the drive is ejected or unplugged, like the vendor firmware.'))),
      h('div.card', {}, h('h3', {}, 'Power'),
        field('Attenuation', h('div.row', {}, Object.assign(numInput(r.attenuation, { min: 0, max: 127, step: 1, width: '90px', onchange: val => { r.attenuation = Math.round(val); app.changed('radio'); } }), { style: 'width:90px;flex:0 0 auto' }), h('span.suffix', {}, `× ${DB_PER_STEP} dB = −${((r.attenuation || 0) * DB_PER_STEP).toFixed(2)} dB`),
          [0, 20, 40, 80, 127].map(a => h('button.btn.small', { 'aria-pressed': r.attenuation === a ? 'true' : 'false', onclick: () => { r.attenuation = a; app.changed('radio'); } }, String(a)))),
          `About ${dbm.toFixed(1)} dBm out (${(Math.pow(10, dbm / 10)).toFixed(dbm > 10 ? 0 : 1)} mW) from the ${MAX_DBM} dBm the hardware gives at attenuation 0. Rev 2 boards have no attenuator; the firmware detects the revision and ignores this on them.`),
        r.attenuation ? h('p.hint', {}, 'The firmware accepts attenuation codes on a rev 3 board; the dB per step has not been measured with a meter yet, so treat the computed power as nominal.') : null,
        field('Measured power', h('div.row', {}, numInput(r.power_dbm ?? '', { min: -40, max: 40, step: 'any', width: '110px', onchange: val => { r.power_dbm = val; app.changed('radio'); } }), h('span.suffix', {}, 'dBm'), r.power_dbm != null ? h('button.btn.small', { onclick: () => { r.power_dbm = null; app.changed('radio'); } }, 'clear') : null), 'Optional: what your meter says at this attenuation; kept with the profile and the fleet log.'))),
    h('div.card', {}, h('h3', {}, 'Deviation and tone'),
      h('div.two-col', {},
        devField('Morse ID', 'id_deviation_hz', '±5 kHz is standard narrowband FM. The carrier does not wander between segments with this firmware.'),
        devField('Audio payload', 'audio_deviation_hz', 'Peak deviation of the songs or message.')),
      h('div.two-col', {},
        field('Tone shape', select([['bright', 'Bright — odd harmonics, like the ESP32\'s PWM tone'], ['sine', 'Sine — pure tone']], r.tone_shape || 'bright', val => { r.tone_shape = val; app.changed('radio'); }), 'Synthesised in the firmware per sample; the same renderer the Payload preview uses.'),
        h('div.field', {}, h('label', {}, 'Pre-emphasis'), check('Boost highs 6 dB/octave like a voice radio\'s transmitter', r.preemphasis !== false, val => { r.preemphasis = val; app.changed('radio'); }, 'Receivers cut highs back (de-emphasis); without this low notes come out muffled.'))),
      h('p.hint', {}, `Channel width for the record: ${r.bandwidth_khz} kHz. Above ±5 kHz deviation a 12.5 kHz receiver distorts.`)),
    h('div.card', {}, h('h3', {}, 'Region ', badge(app.region)),
      field('Band plan used for validation', select(Object.keys(app.catalog.bands).map(k => [k, k]), app.region, val => { app.region = val; app.changed('region'); }), 'Used only to check frequencies; the zone above is what the firmware enforces.')));
}
