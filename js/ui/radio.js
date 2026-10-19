// radio.js — Radio tab: module, Probe, power, bandwidth, squelch/volume.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select, numInput, check } from './dom.js';

let app, root, probeOut = null;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

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
  const cfg = app.cfg, r = cfg.radio, m = app.module;
  if (app.family === 'drive') return renderDrive();
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
      h('p.hint', {}, `Deviation is the WAV level: full scale is ±${v.MAX_DEVIATION_HZ / 1000} kHz. Above ±5 kHz the signal is wider than a 12.5/25 kHz channel expects. The carrier itself also steps ±5 kHz segment by segment (firmware behaviour, see the Schedule tab), so a receiver sees up to ±10 kHz of movement in total.`)),
    h('div.card', {}, h('h3', {}, 'Region ', badge(app.region)),
      field('Band plan used for validation', select(Object.keys(app.catalog.bands).map(k => [k, k]), app.region, val => { app.region = val; app.changed('region'); }), 'The firmware\'s own limit (zone) is what matters here; the region table is shown on the Frequency tab for reference.')));
}
