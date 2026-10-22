// behavior.js — Behavior tab: the firmware template (what the fox does), from the set this board can run.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select } from './dom.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

function render() {
  const t = app.template;
  if (app.family === 'drive') {
  const tmplCard = h('div.card', {},
    h('h3', {}, 'Template'),
    field('Template', select(app.templatesFor('drive').map(x => [x.id, `${x.name}${x.status === 'experimental' ? ' (experimental)' : ''}`]), app.templateId, id => app.setTemplate(id)), t.description),
    h('dl.kv', {}, h('dt', {}, 'Status'), h('dd', {}, badge(t.status, t.status === 'stable' ? 'ok' : 'warn')), h('dt', {}, 'Tested on'), h('dd', {}, t.boards_tested.join(', ') || 'nothing yet'), h('dt', {}, 'Firmware'), h('dd', {}, 'the vendor\'s (unchanged)')));
    root.replaceChildren(tmplCard, h('div.card', {}, h('h3', {}, 'One behaviour'), h('p.hint', {}, 'The vendor firmware does one thing: play its audio file, send the ID, optionally pause. Everything that can be set about it is on the next tabs.')));
    return;
  }
  if (app.isCompiled) {
    const k = app.vendor.TEMPLATES[t.id] || {}, hw = app.hardware || {};
    const all = Object.values(app.catalog.templates).filter(x => (x.families || []).includes('compiled'));
    const cant = all.filter(x => !app.templatesFor('compiled').includes(x));
    root.replaceChildren(h('div.card', {},
      h('h3', {}, 'Challenge'),
      field('Challenge kind', select(app.templatesFor('compiled').map(x => [x.id, x.name]), app.templateId, id => app.setTemplate(id)), t.description),
      h('dl.kv', {}, h('dt', {}, 'kitsune project'), h('dd', {}, h('code', {}, k.project || '?'), k.mode ? ` (-D ${k.mode})` : ''), h('dt', {}, 'Radio'), h('dd', {}, k.radio || '?'), h('dt', {}, 'Status'), h('dd', {}, badge(t.status, t.status === 'stable' ? 'ok' : 'warn')), h('dt', {}, 'Tested on'), h('dd', {}, t.boards_tested.join(', ') || 'nothing yet')),
      cant.length ? h('p.hint', {}, `Not offered on the ${hw.name || app.board.name}: ${cant.map(x => x.name).join(', ')} — the board has no ${[...new Set(cant.flatMap(x => x.radios || []))].join('/')} radio.`) : null),
      h('div.card', {}, h('h3', {}, 'How kitsune behaves'), h('p.hint', {}, 'At power-on the fox sets its spoofed address, starts the radio for this challenge, checks that the address, channel and name it asked for are what the radio reports (a failed check = red/yellow blinking and no transmission), stays awake for the wake period, then deep-sleeps for the sleep period and starts over. The next tabs set exactly those values; tiers (easy / hard) are only a label on the challenge here — kitsune picks a block of values by tier at build time, this page writes one explicit configuration.')));
    return;
  }
  const tmplCard = h('div.card', {},
    h('h3', {}, 'Firmware template'),
    field('Template', select(app.templatesFor(app.family).map(x => [x.id, `${x.name}${x.status === 'experimental' ? ' (experimental)' : ''}`]), app.templateId, id => app.setTemplate(id)),
      (t.description || `Reads: ${t.sections.join(', ')}`) + (app.templatesFor(app.family).length < Object.keys(app.catalog.templates).length ? ` (templates for the ${app.board.name}; other boards have others)` : '')),
    h('dl.kv', {},
      h('dt', {}, 'Version'), h('dd', {}, `${t.version} · needs foxlib ${t.foxlib}`),
      h('dt', {}, 'Status'), h('dd', {}, badge(t.status, t.status === 'stable' ? 'ok' : 'warn')),
      h('dt', {}, 'Tested on'), h('dd', {}, t.boards_tested.join(', ') || 'nothing yet'),
      h('dt', {}, 'Payload files'), h('dd', {}, t.payloads.map(p => p.file).join(', ') || 'none'),
      h('dt', {}, 'Bench'), h('dd', {}, t.capabilities.join(', '))),
    t.status === 'experimental' ? h('p.hint.warn', {}, 'Experimental: any payload × schedule × plan. Combinations outside the six discrete templates have not been run on hardware yet.') : null);

  const others = app.templatesFor(app.family).filter(x => x.id !== t.id);
  root.replaceChildren(tmplCard,
    h('div.card', {}, h('h3', {}, 'What a template is'),
      h('p.hint', {}, 'A template is the behaviour: a short ', h('code', {}, 'code.py'), ' runner over the shared ', h('code', {}, 'foxlib'), '. It decides which payload kinds and schedules the next tabs offer; the frequency plan, callsign and radio settings apply to all of them. Switching keeps the sections the new template still reads.'),
      others.length ? h('p.hint', {}, 'Also available for this board: ', others.map(x => x.name).join(' · '), '.') : null));
}
