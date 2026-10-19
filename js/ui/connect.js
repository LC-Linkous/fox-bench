// connect.js — Connect tab: what's on the board, template choice, load from board.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select } from './dom.js';
import { download } from '../model/profiles.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

function render() {
  const t = app.template, ob = app.onBoard, info = app.info;
  if (app.family === 'drive') return renderDrive();
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
    field('Template', select(app.templatesFor(app.family).map(x => [x.id, `${x.name}${x.status === 'experimental' ? ' (experimental)' : ''}`]), app.templateId, id => app.setTemplate(id)),
      (t.description || `Reads: ${t.sections.join(', ')}`) + (app.templatesFor(app.family).length < Object.keys(app.catalog.templates).length ? ` (templates for the ${app.board.name}; other boards have others)` : '')),
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

/** Drive family (PicoFox): the drive's files instead of a REPL; the template list is the vendor's one. */
function renderDrive() {
  const b = app.board, v = app.vendor, ob = app.onBoard, info = app.info, t = app.template;
  const deviceCard = h('div.card', {},
    h('h3', {}, b.name),
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Switch the fox ', h('b', {}, 'on'), ', plug in USB, then ', h('b', {}, `Open ${b.drive?.label || 'drive'}`), ' in the top bar and pick the drive it mounts (Chrome or Edge). Or ', h('i', {}, 'Try without hardware'), '.'),
        h('p.hint', {}, h('b', {}, 'This board runs the vendor\'s firmware, not CircuitPython.'), ' fox-bench writes the files that firmware reads: ', b.drive.files.map(f => h('code', {}, f)).flatMap((e, i) => i ? [' ', e] : [e]), '. ', b.drive.note),
        h('p.hint', {}, h('b', {}, 'Listen only'), ' opens the board\'s serial port and shows its boot messages after you switch it off and on — the only confirmation it gives.'))
      : h('dl.kv', {},
        h('dt', {}, 'Drive'), h('dd', {}, info.driveName || '—', ob.settings ? '' : badge(`no ${v.FILES.settings}`, 'warn')),
        h('dt', {}, 'Files'), h('dd', {}, Object.entries(ob.files || {}).sort().map(([n, f]) => `${n} (${f.size} B)`).join('  ') || '(empty)'),
        h('dt', {}, 'Settings'), h('dd', {}, ob.settings ? `${ob.settings.CALLSIGN || '(no callsign — silent)'} · ${ob.settings.FREQ_MHZ} MHz · zone ${ob.settings.ITU_ZONE} · duty ${ob.settings.DUTY_CYCLE} % · atten ${ob.settings.ATTENUATION}` : '—'),
        h('dt', {}, 'ID audio'), h('dd', {}, ob.markerOk == null ? '—' : ob.markerOk ? badge('kept by the firmware (marker matches)', 'ok') : badge('firmware will regenerate its own at power-on', 'warn'))),
    info ? h('div.tools', { style: 'margin-top:10px' },
      ob.cfg ? h('button.btn', { onclick: async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim(`form replaced with the drive's ${v.FILES.settings}`); } }, 'Load the drive\'s settings into the form') : null,
      h('button.btn.small', { onclick: async () => { await app.readDrive(); app.changed('reread'); } }, 'Re-read drive'),
      h('span.hint', {}, 'Only settings come back: the audio on the drive is not reversible into a playlist.')) : null);
  const tmplCard = h('div.card', {},
    h('h3', {}, 'Template'),
    field('Template', select(app.templatesFor('drive').map(x => [x.id, `${x.name}${x.status === 'experimental' ? ' (experimental)' : ''}`]), app.templateId, id => app.setTemplate(id)), t.description),
    h('dl.kv', {}, h('dt', {}, 'Status'), h('dd', {}, badge(t.status, t.status === 'stable' ? 'ok' : 'warn')), h('dt', {}, 'Tested on'), h('dd', {}, t.boards_tested.join(', ') || 'nothing yet'), h('dt', {}, 'Firmware'), h('dd', {}, 'the vendor\'s (unchanged)')));
  const notes = h('div.card', {}, h('h3', {}, 'Things this firmware does quietly'), h('ul', {}, (b.notes || []).map(n => h('li', {}, n))));
  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works here'),
    h('ol.steps', {},
      h('li', {}, 'The form (tabs 3–7) becomes ', h('code', {}, v.FILES.settings), ', an ', h('code', {}, v.FILES.audio), ' rendered from the payload, the Morse ID as ', h('code', {}, v.FILES.id), ' and the marker file ', h('code', {}, v.FILES.marker), ' (a byte-sum of the settings) that tells the firmware to keep our ID audio.'),
      h('li', {}, 'Deploy writes the four files to the drive and reads each one back.'),
      h('li', {}, 'You eject the drive and switch the fox off and on. It does not transmit while a computer has the drive mounted. ', h('b', {}, 'Listen only'), ' shows the boot messages if you want the confirmation.')));
  root.replaceChildren(h('div.cols', {}, deviceCard, tmplCard), notes, flow);
}
