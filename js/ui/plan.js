// plan.js — Frequency plan tab: one frequency or a rotating list, validated.
// SPDX-License-Identifier: GPL-2.0-only
import * as kitsune from './kitsune.js';
import { h, badge, numInput, check, fill } from './dom.js';

let app, root;
export function init(a, el) { app = a; root = el; kitsune.init(a); app.listeners.add(render); render(); }   // kitsune.init before the first render: a saved kitsune form renders this tab at boot, before the ID tab's init

function whyBad(f) {
  const inMod = app.cfg.radio.ranges_mhz.some(([a, b]) => f >= a && f <= b);
  const bands = app.catalog.bands[app.region] || {};
  const band = Object.entries(bands).find(([, [a, b]]) => f >= a && f <= b);
  if (!inMod) return { cls: 'err', text: `outside the ${app.module.name} range` };
  if (!band) return { cls: 'err', text: `outside the ${app.region} bands — allowed, confirmed at deploy` };
  return { cls: 'ok', text: band[0] };
}

function render() {
  if (app.isCompiled) return kitsune.renderPlan(root);
  if (app.isNet) { fill(root, h('div.card', {}, h('p.hint', {}, 'A network fox has no frequency plan: it is found by its SSID, beacon or device name. See the Radio tab.'))); return; }
  const p = app.cfg.plan;
  if (app.family === 'drive') return renderDrive();
  const rows = p.frequencies_mhz.map((f, i) => {
    const v = whyBad(f);
    return h('li', {},
      numInput(f, { min: 1, max: 1000, step: 0.0125, width: '130px', onchange: val => { p.frequencies_mhz[i] = Math.round(val * 1e4) / 1e4; app.changed('plan'); } }),
      h('span.suffix', {}, 'MHz'), badge(v.text, v.cls),
      h('span.name', {}),
      i > 0 ? h('button', { title: 'move up', onclick: () => { [p.frequencies_mhz[i - 1], p.frequencies_mhz[i]] = [p.frequencies_mhz[i], p.frequencies_mhz[i - 1]]; app.changed('plan'); } }, '↑') : null,
      p.frequencies_mhz.length > 1 ? h('button', { title: 'remove', onclick: () => { p.frequencies_mhz.splice(i, 1); app.changed('plan'); } }, '✕') : null);
  });
  const presets = [['146.565', 'common 2 m fox'], ['147.420', ''], ['147.445', ''], ['433.900', 'common 70 cm fox']];
  root.replaceChildren(
    h('div.card', {}, h('h3', {}, p.frequencies_mhz.length > 1 ? 'Rotating list' : 'Frequency'),
      h('ul.list', {}, rows),
      h('div.tools', {},
        h('button.btn.small', { onclick: () => { p.frequencies_mhz.push(p.frequencies_mhz.at(-1) || 146.565); app.changed('plan'); } }, '+ Add frequency'),
        h('span.hint', {}, 'Presets:'), presets.map(([f, t]) => h('button.btn.small', { title: t, onclick: () => { p.frequencies_mhz.push(+f); app.changed('plan'); } }, f))),
      h('p.hint', {}, 'With more than one entry the fox retunes after each transmission, in order, wrapping. Entries the module can\'t reach are dropped by the firmware at boot and named in the banner. Entries outside the band table are allowed (bench testing, other allocations) and shown in red; Deploy asks you to confirm them.')),
    h('div.card', { hidden: p.frequencies_mhz.length < 2 }, h('h3', {}, 'Rotation'),
      check('Announce the next frequency in Morse before moving ("QSY 147.445")', p.announce_qsy, v => { p.announce_qsy = v; app.changed('plan'); }),
      h('p.hint', {}, 'Courtesy variant: the exercise is following the fox. Off: hunters have to find each new frequency themselves.')),
    h('div.card', {}, h('h3', {}, 'Band reference · ' + app.region),
      h('dl.kv', {}, Object.entries(app.catalog.bands[app.region] || {}).flatMap(([n, [a, b]]) => [h('dt', {}, n), h('dd', {}, `${a} – ${b} MHz`)])),
      h('p.hint', {}, 'Module range: ', app.cfg.radio.ranges_mhz.map(([a, b]) => `${a}–${b}`).join(', '), ' MHz. Change region on the Radio tab.')));
}

/** Drive family (PicoFox): one frequency, checked against the firmware's zone limits. */
function renderDrive() {
  const p = app.cfg.plan, v = app.vendor, zone = app.cfg.radio.itu_zone, [lo, hi] = v.allowedRange(zone);
  const f = p.frequencies_mhz[0], ok = f >= lo && f <= hi;
  const bands = app.catalog.bands[app.region] || {};
  const band = Object.entries(bands).find(([, [a, b]]) => f >= a && f <= b);
  root.replaceChildren(
    h('div.card', {}, h('h3', {}, 'Frequency'),
      h('ul.list', {}, h('li', {}, numInput(f, { min: 144, max: 148, step: 0.005, width: '130px', onchange: val => { p.frequencies_mhz = [Math.round(val * 1e4) / 1e4]; app.changed('plan'); } }), h('span.suffix', {}, 'MHz'),
        ok ? badge(band ? band[0] : 'inside the firmware limit', 'ok') : badge(`outside ${lo}–${hi} MHz for zone ${zone} — the fox would stay silent`, 'err'), h('span.name', {}))),
      h('div.tools', {}, h('span.hint', {}, 'Presets:'), [['146.565', 'common 2 m fox'], ['147.420', ''], ['147.445', ''], ['146.520', 'national simplex — avoid for a hunt']].map(([x, t]) => h('button.btn.small', { title: t, onclick: () => { p.frequencies_mhz = [+x]; app.changed('plan'); } }, x))),
      h('p.hint', {}, `One frequency: the firmware has no rotation. It must sit 20 kHz inside the band edge for the zone (${lo}–${hi} MHz for zone ${zone}); outside that the fox boots and never transmits, without an error. The firmware also moves the carrier ±5 kHz around this value segment by segment.`)),
    h('div.card', {}, h('h3', {}, 'Band reference · ' + app.region),
      h('dl.kv', {}, Object.entries(bands).flatMap(([n, [a, b]]) => [h('dt', {}, n), h('dd', {}, `${a} – ${b} MHz`)])),
      h('p.hint', {}, 'Change region on the Radio tab. Staying within your licence privileges is yours to confirm.')));
}
