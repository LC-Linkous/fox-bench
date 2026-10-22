// board.js — Board tab: which fox is on the bench, connect to it, what is on it, flash it if bare.
// SPDX-License-Identifier: GPL-2.0-only
import { cmpVersion } from '../model/compat.js';
import { h, badge, field, select } from './dom.js';
import { download } from '../model/profiles.js';
import { flashCard, onChange as onFlashChange } from './flash.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); onFlashChange(render); render(); }

const FAMILY_LABEL = { foxlib: 'CircuitPython board + radio module', drive: 'Drive-configured fox (vendor firmware)', 'foxlib-c': 'fox-bench native firmware (UF2)' };

/** The board picker, grouped by family. This one choice drives every other tab. */
function pickerCard() {
  const groups = {};
  for (const b of Object.values(app.catalog.boards)) (groups[b.family || 'foxlib'] ??= []).push(b);
  const sel = h('select', { onchange: e => app.setBoard(e.target.value) });
  for (const [fam, list] of Object.entries(groups)) {
    const og = h('optgroup', { label: FAMILY_LABEL[fam] || fam });
    for (const b of list) { const o = h('option', { value: b.id }, b.name + (b.status === 'planned' ? ' — planned' : b.status === 'experimental' ? ' — experimental' : '')); if (b.id === app.boardId) o.selected = true; if (b.status === 'planned') o.disabled = true; og.appendChild(o); }
    sel.appendChild(og);
  }
  const how = app.family === 'drive'
    ? ['Then ', h('b', {}, `Open ${app.board.drive?.label || 'drive'}`), ' in the top bar picks its USB drive; ', h('b', {}, 'Listen only'), ' shows its serial boot messages.']
    : app.family === 'foxlib-c'
    ? ['Then ', h('b', {}, `Open ${app.board.drive?.label || 'drive'}`), ' in the top bar picks its USB drive (where fox.json lives); ', h('b', {}, 'Listen only'), ' opens its serial console for the banner, the log and bench commands.']
    : ['Then ', h('b', {}, 'Connect'), ' takes its REPL over USB; ', h('b', {}, 'Listen only'), ' watches a running fox without stopping it.'];
  return h('div.card', {}, h('h3', {}, 'Which fox is on the bench?'),
    field('Board', sel, h('span', {}, ...how, ' Changing the board switches the template when the current one does not apply, and keeps your callsign.')));
}

function diagCard() {
  const diag = h('div.card', {}, h('h3', {}, 'Something wrong?'),
    h('p.hint', {}, 'Download a diagnostics file and attach it to a ', h('a', { href: 'https://github.com/LC-Linkous/fox-bench/issues/new/choose', target: '_blank', rel: 'noopener' }, 'GitHub issue'), '. It holds the page version, your form, what the board reported, the last deploy, bench results and the console — no more than you can already see on this page.'),
    h('div.tools', {},
      h('button.btn.small', { onclick: () => download(`fox-bench-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(app.diagnostics(), null, 1), 'application/json') }, 'Download diagnostics'),
      h('button.btn.small', { onclick: async e => { try { await navigator.clipboard.writeText(JSON.stringify(app.diagnostics(), null, 1)); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy to clipboard'; }, 1200); } catch { app.console.err('clipboard unavailable'); } } }, 'Copy to clipboard')));
  return diag;
}

/** The fox's foxlib-c version against the one this site builds. */
function fwBadge(app, v) {
  const fox = String(v || '').replace(/^c-/, ''), hosted = app.catalog.foxlibcVersion;
  if (!fox || !hosted || fox === 'demo') return '';
  const c = cmpVersion(fox, hosted);
  return c === 0 ? badge('matches this site', 'ok') : c < 0 ? badge(`this site builds ${hosted} — update from the firmware card`, 'warn') : badge(`newer than this page (${hosted})`, 'info');
}

function render() {
  if (app.family === 'drive') return renderDrive();
  if (app.family === 'foxlib-c') return renderFoxlibC();
  const b = app.board, ob = app.onBoard, info = app.info;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Connection'),
    ob.listening && !ob.template ? h('p.hint', {}, 'Listening only. Whatever the fox prints appears in the console below; tap the board\'s R button to watch it boot and read its FOX banner. Re-read board takes control (stops the fox).') : null,
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Connect a board (Chrome or Edge) or start the simulated one from the top bar.'),
        h('p.hint', {}, h('b', {}, 'The board must already be running CircuitPython.'), ' A bare board gets it from the Flash CircuitPython card here (hold B while plugging in, pick the port, click).'),
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

  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works'),
    h('ol.steps', {},
      h('li', {}, 'The form on tabs 2–7 is a complete ', h('code', {}, 'fox.json'), '. Every field is validated here and again by the firmware at boot.'),
      h('li', {}, 'Deploy writes ', h('code', {}, 'fox.json'), ', the template\'s ', h('code', {}, 'defaults.json'), ' and ', h('code', {}, 'code.py'), ', and ', h('code', {}, 'foxlib/'), ' when its version differs or files are missing — through the CircuitPython REPL, the same way Thonny saves files, each file verified by size and CRC. The board therefore has to be running CircuitPython already (Board tab → Flash CircuitPython for a bare one).'),
      h('li', {}, 'The board soft-reboots and the page reads the ', h('code', {}, 'FOX …'), ' banner back: config status, radio status, callsign set or not.')));

  const facts = h('div.card', {}, h('h3', {}, 'Board facts'),
    h('dl.kv', {}, h('dt', {}, 'CircuitPython id'), h('dd', {}, b.circuitpython.board_id), h('dt', {}, 'Flash'), h('dd', {}, `${b.flash.method} · ${b.flash.chip} @ ${b.flash.offset}`), h('dt', {}, 'USB drive'), h('dd', {}, b.has_usb_drive ? 'yes (CIRCUITPY)' : 'none — files go through the REPL'), h('dt', {}, 'Battery'), h('dd', {}, b.battery?.divider_note || '—')),
    h('p.hint', {}, 'Wiring between this board and the radio module is on the Radio & pins tab.'));
  root.replaceChildren(pickerCard(), h('div.cols', {}, deviceCard, flashCard(app)), facts, flow, diagCard());
}

/** Drive family (PicoFox): the drive's files instead of a REPL. */
function renderDrive() {
  const b = app.board, v = app.vendor, ob = app.onBoard, info = app.info, m = app.module;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Connection'),
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
  const notes = h('div.card', {}, h('h3', {}, 'Things this firmware does quietly'), h('ul', {}, (b.notes || []).map(n => h('li', {}, n))));
  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works here'),
    h('ol.steps', {},
      h('li', {}, 'The form (tabs 3–7) becomes ', h('code', {}, v.FILES.settings), ', an ', h('code', {}, v.FILES.audio), ' rendered from the payload, the Morse ID as ', h('code', {}, v.FILES.id), ' and the marker file ', h('code', {}, v.FILES.marker), ' (a byte-sum of the settings) that tells the firmware to keep our ID audio.'),
      h('li', {}, 'Deploy writes the four files to the drive and reads each one back.'),
      h('li', {}, 'You eject the drive and switch the fox off and on. It does not transmit while a computer has the drive mounted. ', h('b', {}, 'Listen only'), ' shows the boot messages if you want the confirmation.')));
  const facts = h('div.card', {}, h('h3', {}, 'Board facts'),
    h('dl.kv', {}, h('dt', {}, 'Family'), h('dd', {}, 'vendor firmware, configured by files on its USB drive'), h('dt', {}, 'Radio'), h('dd', {}, `${m.name}: ${m.ranges_mhz.map(([a, c]) => `${a}–${c} MHz`).join(', ')}`), h('dt', {}, 'Power'), h('dd', {}, `about ${m.power_dbm.high} dBm, attenuator to ${m.power_dbm.low} dBm (rev 3)`), h('dt', {}, 'Audio'), h('dd', {}, `${m.audio.sample_rate_hz} Hz ${m.audio.bits}-bit mono WAV, up to ±${m.audio.max_deviation_hz / 1000} kHz deviation`), h('dt', {}, 'USB'), h('dd', {}, `drive "${b.drive.label}" + serial (boot messages only)`), h('dt', {}, 'Battery'), h('dd', {}, b.battery?.divider_note || '—')));
  root.replaceChildren(pickerCard(), h('div.cols', {}, deviceCard, flashCard(app)), notes, facts, flow, diagCard());
}

/** foxlib-c family (PicoFox with fox-bench's own firmware): fox.json on its FOXBENCH drive, banner and bench on its serial console. */
function renderFoxlibC() {
  const b = app.board, ob = app.onBoard, info = app.info, m = app.module;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Connection'),
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Switch the fox ', h('b', {}, 'on'), ', plug in USB, then ', h('b', {}, `Open ${b.drive?.label || 'drive'}`), ' in the top bar and pick the ', h('code', {}, b.drive?.label || 'FOXBENCH'), ' drive (Chrome or Edge). Or ', h('i', {}, 'Try without hardware'), '.'),
        h('p.hint', {}, h('b', {}, 'No ', h('code', {}, b.drive?.label || 'FOXBENCH'), ' drive?'), ' The board still runs other firmware. Flash fox-bench\'s from the card on the right ("Reboot into bootloader", then copy; BOOTSEL itself is inside the case). The vendor firmware can be put back the same way at any time.'),
        h('p.hint', {}, h('b', {}, 'Listen only'), ' opens the serial console: the ', h('code', {}, 'FOX …'), ' banner appears at once, the log streams while the fox runs, and the console below takes commands (', h('code', {}, 'help'), ').'))
      : ob.listening ? h('dl.kv', {},
        h('dt', {}, 'Console'), h('dd', {}, 'listening', ob.template ? '' : badge('no banner yet — it prints when the port opens and after every reload', 'warn')),
        h('dt', {}, 'Board id'), h('dd', {}, info.boardId || '—'), h('dt', {}, 'Chip UID'), h('dd', {}, info.uid || '—'),
        h('dt', {}, 'Firmware'), h('dd', {}, ob.foxlibVersion ? `foxlib-${ob.foxlibVersion}` : '—', fwBadge(app, ob.foxlibVersion)), h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'))
      : h('dl.kv', {},
        h('dt', {}, 'Drive'), h('dd', {}, info.driveName || '—', ob.cfg ? '' : badge('no fox.json', 'warn')),
        h('dt', {}, 'Firmware'), h('dd', {}, ob.foxlibVersion ? `foxlib-${ob.foxlibVersion}` : '— (no board.json: firmware before 0.1.4)', fwBadge(app, ob.foxlibVersion)),
        h('dt', {}, 'Files'), h('dd', {}, Object.entries(ob.files || {}).sort().map(([n, f]) => `${n} (${f.size} B)`).join('  ') || '(empty)'),
        h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'),
        h('dt', {}, 'fox.json'), h('dd', {}, ob.cfg ? `${ob.cfg.id?.callmessage} · ${(ob.cfg.plan?.frequencies_mhz || []).join(', ')} MHz` : ob.raw ? badge('invalid JSON', 'err') : '—')),
    info && !ob.listening ? h('div.tools', { style: 'margin-top:10px' },
      ob.cfg ? h('button.btn', { onclick: async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim('working config replaced with the drive\'s fox.json'); } }, 'Load the drive\'s config into the form') : null,
      h('button.btn.small', { onclick: async () => { await app.readDrive(); app.changed('reread'); } }, 'Re-read drive'),
      h('span.hint', {}, ob.cfg ? 'Otherwise the form keeps what you were editing; Deploy shows the difference.' : '')) : null,
    app.consoleDevice() ? h('div.tools', { style: 'margin-top:10px' },
      h('button.btn.small', { onclick: async e => { if (!confirm('Jump to the UF2 bootloader? The fox stops, this port disappears and an RPI-RP2 drive appears. Copy a .uf2 there to come back (fox-bench or the vendor\'s).')) return; e.currentTarget.disabled = true; const ok = await app.consoleDevice().bootsel(); app.console.line(ok ? 'bootsel sent — look for the RPI-RP2 drive' : 'bootsel: no reply', ok ? 'ok' : 'err'); } }, 'Enter UF2 bootloader (bootsel)'),
      h('button.btn.small', { onclick: () => app.consoleDevice().send('status') }, 'Status'),
      h('span.hint', {}, 'The firmware card on the right then copies a .uf2 onto that drive.')) : null);
  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works here'),
    h('ol.steps', {},
      h('li', {}, 'The form on tabs 2–7 is a complete ', h('code', {}, 'fox.json'), ', the same contract the CircuitPython foxes use. Validated here and again by the firmware when it loads.'),
      h('li', {}, 'Deploy writes ', h('code', {}, 'fox.json'), ', the template\'s ', h('code', {}, 'defaults.json'), ' and, for SSTV, ', h('code', {}, 'images.bin'), ' to the drive and reads them back. There is no code to copy: the behaviour is in the firmware, chosen by the template id.'),
      h('li', {}, 'About a second after the last write the fox reloads by itself and prints a fresh ', h('code', {}, 'FOX …'), ' banner on its serial console (Listen only). No eject, no power cycle — unless you turned ', h('code', {}, 'tx_while_mounted'), ' off on the Radio tab.')));
  const facts = h('div.card', {}, h('h3', {}, 'Board facts'),
    h('dl.kv', {}, h('dt', {}, 'Family'), h('dd', {}, 'fox-bench native firmware (C, Pico SDK, GPL-3.0-or-later) on the PicoFox hardware'), h('dt', {}, 'Radio'), h('dd', {}, `${m.name}: ${m.ranges_mhz.map(([a, c]) => `${a}–${c} MHz`).join(', ')}; FM by PLL fraction updates at 8 000 samples/s`), h('dt', {}, 'Power'), h('dd', {}, `about ${m.power_dbm.high} dBm, attenuator to ${m.power_dbm.low} dBm (rev 3)`), h('dt', {}, 'USB'), h('dd', {}, `drive "${b.drive.label}" + serial console (banner, log, bench commands)`), h('dt', {}, 'Battery'), h('dd', {}, 'internal LiPo; the firmware can only report whether it is charging')),
    h('p.hint', {}, 'Hardware design by AI6YM.radio (CC BY-NC-SA 4.0). The firmware is fox-bench\'s own, written from the published schematic — see ', h('code', {}, 'docs/picofox-hardware.md'), '. On the air since October 2026 on a rev 3 board (keying, FM, live reload, the console bench). Still unmeasured: the attenuator\'s dB per step — the firmware accepts the codes; a power meter will confirm the scale.'));
  root.replaceChildren(pickerCard(), h('div.cols', {}, deviceCard, flashCard(app)), facts, flow, diagCard());
}
