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
  const canProbe = app.connected && (app.device.kind === 'demo' || app.onBoard.foxlibVersion);
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Module'),
        field('Radio module', select(Object.values(app.catalog.modules).map(x => [x.id, x.name]), app.moduleId, id => app.setModule(id)), 'The board doesn\'t know which module is soldered next to it. Ranges below are copied into fox.json so the firmware can refuse out-of-range frequencies.'),
        h('dl.kv', {}, h('dt', {}, 'Ranges'), h('dd', {}, m.ranges_mhz.map(([a, b]) => `${a}–${b} MHz`).join(' and ')), h('dt', {}, 'Power'), h('dd', {}, `low ${m.power_dbm.low} dBm · high ${m.power_dbm.high} dBm`), h('dt', {}, 'Channel step'), h('dd', {}, m.step_khz.join(' / ') + ' kHz')),
        h('div.tools', { style: 'margin-top:12px' },
          h('button.btn', { disabled: !canProbe, onclick: e => probe(e.currentTarget) }, 'Probe fitted band'),
          h('span.hint', {}, canProbe ? 'Retunes the receiver to 146.5 and 433.5 MHz and reads the module\'s reply. Nothing is transmitted.' : 'Needs a connected board with the fox firmware deployed.')),
        probeOut ? h('p.hint' + (probeOut.vhf || probeOut.uhf ? '.ok' : '.err'), {}, probeOut.text) : null),
      h('div.card', {}, h('h3', {}, 'Settings'),
        check('High power', r.high_power, v => { r.high_power = v; app.changed('radio'); }, `(${m.power_dbm.high} dBm instead of ${m.power_dbm.low} dBm — more battery, more heat)`),
        field('Bandwidth', select([[1, '25 kHz (wide)'], [0, '12.5 kHz (narrow)']], r.bandwidth, v => { r.bandwidth = +v; app.changed('radio'); })),
        h('div.two-col', {},
          field('Squelch (0–8)', numInput(r.squelch, { min: 0, max: 8, step: 1, onchange: v => { r.squelch = v; app.changed('radio'); } })),
          field('Volume (1–8)', numInput(r.volume, { min: 1, max: 8, step: 1, onchange: v => { r.volume = v; app.changed('radio'); } }))),
        h('p.hint', {}, 'Squelch and volume are receive-side settings on the module. They do not change the transmitted signal; they are here because the module\'s setup sequence sets them, and because a receive-triggered fox would use them. Transmitted audio level is the PWM on the audio pin.'))),
    h('div.card', {}, h('h3', {}, 'Region ', badge(app.region)),
      field('Band plan used for validation', select(Object.keys(app.catalog.bands).map(k => [k, k]), app.region, v => { app.region = v; app.changed('region'); }),
        'Only used by the page to check frequencies. Staying within your licence privileges is yours to confirm.')));
}
