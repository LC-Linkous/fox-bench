// connect.js — Connect tab: what's on the board, template choice, load from board.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select } from './dom.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

function render() {
  const t = app.template, ob = app.onBoard, info = app.info;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Board'),
    !info ? h('p.hint', {}, 'Not connected. Connect a board (Chrome or Edge) or start the simulated one from the top bar. Hold B while plugging in only when you want the bootloader for flashing CircuitPython; for everything else plug in normally.')
      : h('dl.kv', {},
        h('dt', {}, 'Board id'), h('dd', {}, info.boardId, app.catalog.boards[info.boardId] ? '' : badge('unknown to fox-bench', 'warn')),
        h('dt', {}, 'Chip UID'), h('dd', {}, info.uid),
        h('dt', {}, 'CircuitPython'), h('dd', {}, info.cpVersion || '?'),
        h('dt', {}, 'foxlib on board'), h('dd', {}, ob.foxlibVersion || '—', ob.foxlibVersion && ob.foxlibVersion !== app.catalog.foxlibVersion ? badge(`repo has ${app.catalog.foxlibVersion}`, 'warn') : ''),
        h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'),
        h('dt', {}, 'fox.json'), h('dd', {}, ob.cfg ? `${ob.cfg.id?.callmessage} · ${(ob.cfg.plan?.frequencies_mhz || []).join(', ')} MHz` : ob.raw ? badge('invalid JSON', 'err') : '—'),
        h('dt', {}, 'Files'), h('dd', {}, Object.keys(ob.files).sort().join('  ') || '(empty)')),
    info && ob.cfg ? h('div.tools', { style: 'margin-top:10px' },
      h('button.btn', { onclick: async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim('working config replaced with the board\'s fox.json'); } }, 'Load the board\'s config into the form'),
      h('span.hint', {}, 'Otherwise the form keeps what you were editing; Deploy shows the difference.')) : null);

  const tmplCard = h('div.card', {},
    h('h3', {}, 'Firmware template'),
    field('Template', select(Object.values(app.catalog.templates).map(x => [x.id, `${x.name}${x.status === 'experimental' ? ' (experimental)' : ''}`]), app.templateId, id => app.setTemplate(id)),
      t.description || `Reads: ${t.sections.join(', ')}`),
    h('dl.kv', {},
      h('dt', {}, 'Version'), h('dd', {}, `${t.version} · needs foxlib ${t.foxlib}`),
      h('dt', {}, 'Status'), h('dd', {}, badge(t.status, t.status === 'stable' ? 'ok' : 'warn')),
      h('dt', {}, 'Tested on'), h('dd', {}, t.boards_tested.join(', ') || 'nothing yet'),
      h('dt', {}, 'Payload files'), h('dd', {}, t.payloads.map(p => p.file).join(', ') || 'none'),
      h('dt', {}, 'Bench'), h('dd', {}, t.capabilities.join(', '))),
    t.status === 'experimental' ? h('p.hint.warn', {}, 'Experimental: any payload × schedule × plan. Combinations outside the six discrete templates have not been run on hardware yet.') : null);

  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works'),
    h('ol.steps', {},
      h('li', {}, 'The form on tabs 2–7 is a complete ', h('code', {}, 'fox.json'), '. Every field is validated here and again by the firmware at boot.'),
      h('li', {}, 'Deploy writes ', h('code', {}, 'fox.json'), ', the template\'s ', h('code', {}, 'defaults.json'), ' and ', h('code', {}, 'code.py'), ', and ', h('code', {}, 'foxlib/'), ' when its version differs — through the CircuitPython REPL, the same way Thonny saves files.'),
      h('li', {}, 'The board soft-reboots and the page reads the ', h('code', {}, 'FOX …'), ' banner back: config status, radio status, callsign set or not.')));

  root.replaceChildren(h('div.cols', {}, deviceCard, tmplCard), flow);
}
