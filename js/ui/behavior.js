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
