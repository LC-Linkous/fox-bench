// connect.js — Connect tab: what's on the board, template choice, load from board.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select } from './dom.js';
import { download } from '../model/profiles.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

function render() {
  const t = app.template, ob = app.onBoard, info = app.info;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Board'),
    ob.listening && !ob.template ? h('p.hint', {}, 'Listening only. Whatever the fox prints appears in the console below; tap the board\'s R button to watch it boot and read its FOX banner. Re-read board takes control (stops the fox).') : null,
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Connect a board (Chrome or Edge) or start the simulated one from the top bar.'),
        h('p.hint', {}, h('b', {}, 'The board must already be running CircuitPython.'), ' A bare board gets it from the Board & pins tab (Flash CircuitPython: hold B while plugging in, pick the port, click).'),
        h('p.hint', {}, h('b', {}, 'Board already running fox or other firmware?'), ' Plug in normally (no B button). ', h('b', {}, 'Connect'), ' interrupts whatever is running and takes the REPL; ', h('b', {}, 'Listen only'), ' just opens the port and shows the fox\'s output without stopping it. If Connect times out waiting for a prompt, tap the board\'s R (reset) button and try again.'))
      : h('dl.kv', {},
        h('dt', {}, 'Board id'), h('dd', {}, info.boardId, app.catalog.boards[info.boardId] ? '' : badge('unknown to fox-bench', 'warn')),
        h('dt', {}, 'Chip UID'), h('dd', {}, info.uid),
        h('dt', {}, 'CircuitPython'), h('dd', {}, info.cpVersion || '?'),
        h('dt', {}, 'foxlib on board'), h('dd', {}, ob.foxlibVersion || '—', ob.foxlibVersion && !ob.foxlibComplete ? badge(`incomplete: ${ob.foxlibMissing.length} missing`, 'err') : ob.foxlibVersion && ob.foxlibVersion !== app.catalog.foxlibVersion ? badge(`repo has ${app.catalog.foxlibVersion}`, 'warn') : ''),
        h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'),
        h('dt', {}, 'fox.json'), h('dd', {}, ob.cfg ? `${ob.cfg.id?.callmessage} · ${(ob.cfg.plan?.frequencies_mhz || []).join(', ')} MHz` : ob.raw ? badge('invalid JSON', 'err') : '—'),
        h('dt', {}, 'Files'), h('dd', {}, Object.keys(ob.files).sort().join('  ') || '(empty)')),
    info ? h('div.tools', { style: 'margin-top:10px' },
      ob.cfg ? h('button.btn', { onclick: async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim('working config replaced with the board\'s fox.json'); } }, 'Load the board\'s config into the form') : null,
      h('button.btn.small', { title: 'Interrupts a running fox and lists its files again', onclick: async () => { await app.readBoard(); app.changed('reread'); } }, 'Re-read board'),
      ob.template ? h('button.btn.small', { title: 'Soft-reboot so code.py runs (Ctrl-D)', onclick: () => app.restartFox() }, 'Restart fox') : null,
      h('span.hint', {}, ob.cfg ? 'Otherwise the form keeps what you were editing; Deploy shows the difference.' : '')) : null);

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
      h('li', {}, 'Deploy writes ', h('code', {}, 'fox.json'), ', the template\'s ', h('code', {}, 'defaults.json'), ' and ', h('code', {}, 'code.py'), ', and ', h('code', {}, 'foxlib/'), ' when its version differs or files are missing — through the CircuitPython REPL, the same way Thonny saves files, each file verified by size and CRC. The board therefore has to be running CircuitPython already (Board tab → Flash CircuitPython for a bare one).'),
      h('li', {}, 'The board soft-reboots and the page reads the ', h('code', {}, 'FOX …'), ' banner back: config status, radio status, callsign set or not.')));

  const diag = h('div.card', {}, h('h3', {}, 'Something wrong?'),
    h('p.hint', {}, 'Download a diagnostics file and attach it to a ', h('a', { href: 'https://github.com/LC-Linkous/fox-bench/issues/new/choose', target: '_blank', rel: 'noopener' }, 'GitHub issue'), '. It holds the page version, your form, what the board reported, the last deploy, bench results and the console — no more than you can already see on this page.'),
    h('div.tools', {},
      h('button.btn.small', { onclick: () => download(`fox-bench-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(app.diagnostics(), null, 1), 'application/json') }, 'Download diagnostics'),
      h('button.btn.small', { onclick: async e => { try { await navigator.clipboard.writeText(JSON.stringify(app.diagnostics(), null, 1)); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy to clipboard'; }, 1200); } catch { app.console.err('clipboard unavailable'); } } }, 'Copy to clipboard')));
  root.replaceChildren(h('div.cols', {}, deviceCard, tmplCard), flow, diag);
}
