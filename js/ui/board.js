// board.js — Board tab: which fox is on the bench, connect to it, what is on it, flash it if bare.
// SPDX-License-Identifier: GPL-2.0-only
import { cmpVersion } from '../model/compat.js';
import { h, badge, field, check } from './dom.js';
import { download } from '../model/profiles.js';
import { savePacks } from '../model/loaders.js';
import { flashCard, onChange as onFlashChange } from './flash.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); onFlashChange(render); render(); }

// The picker groups by what the fox is and how it is configured, not by firmware family: a board wired to a radio module;
// a bare board whose own radio is the transmitter (listed by chip, the physical board chosen on the Radio tab); a fox
// configured through its USB drive (the PicoFox, vendor firmware first, fox-bench firmware second).
// the sections say how the page talks to the board: the CircuitPython REPL (a bare chip, or a chip + radio module), a USB
// drive (the PicoFox, either firmware), or a serial console alone (the ESP32 boards on fox-bench's C firmware)
const GROUP_LABEL = { combo: 'CircuitPython board + radio module', chip: 'CircuitPython board', drive: 'Drive-configured fox', console: 'Console-configured fox' };
const GROUP_ORDER = ['combo', 'drive', 'chip', 'console'];

/** The board picker, grouped by family. This one choice drives every other tab. */
function pickerCard() {
  const groups = {};
  // Targets not yet verified on hardware (status experimental) stay out
  // of the list unless asked for — a release is what the hardware log vouches for. The selected target is always listed.
  const hidden = Object.values(app.catalog.boards).filter(b => b.status === 'experimental' && !app.showExperimental && b.id !== app.boardId);
  const groupOf = b => app.transportOf(b) === 'console' ? 'console' : ({ fm: 'combo', net: 'chip', drive: 'drive' })[app.kindOf(b)];
  for (const b of Object.values(app.catalog.boards)) if (!hidden.includes(b)) (groups[groupOf(b)] ??= []).push(b);
  if (groups.drive) groups.drive.sort((a, b) => (a.family === 'drive' ? 0 : 1) - (b.family === 'drive' ? 0 : 1));   // vendor firmware first
  for (const g of ['chip', 'console']) if (groups[g]) groups[g].sort((a, b) => a.name.localeCompare(b.name));
  const sel = h('select', { onchange: e => app.setBoard(e.target.value) });
  for (const fam of [...GROUP_ORDER, ...Object.keys(groups).filter(g => !GROUP_ORDER.includes(g))]) {
    const list = groups[fam]; if (!list) continue;
    const og = h('optgroup', { label: GROUP_LABEL[fam] || fam });
    for (const b of list) { const o = h('option', { value: b.id },
      b.name + (b.status === 'planned' ? ' — planned' : b.status === 'experimental' ? ' — experimental' : '') + (b._pack ? ` [${b._pack}]` : '')); if (b.id === app.boardId) o.selected = true; if (b.status === 'planned') o.disabled = true; og.appendChild(o); }
    sel.appendChild(og);
  }
  const how = app.family === 'drive'
    ? ['Then ', h('b', {}, `Open ${app.board.drive?.label || 'drive'}`), ' in the top bar picks its USB drive; ', h('b', {}, 'Listen only'),
      ' shows its serial boot messages.']
    : app.family === 'foxlib-c'
    ? ['Then ', h('b', {}, `Open ${app.board.drive?.label || 'drive'}`), ' in the top bar picks its USB drive (where fox.json lives); ',
      h('b', {}, 'Listen only'), ' opens its serial console for the banner, the log and bench commands.']
    : ['Then ', h('b', {}, 'Connect'), ' takes its REPL over USB; ', h('b', {}, 'Listen only'),
      ' watches a running fox without stopping it.'];
  const anyExperimental = Object.values(app.catalog.boards).some(b => b.status === 'experimental');
  return h('div.card', {}, h('h3', {}, 'Which fox is on the bench?'),
    field('Board', sel,
      h('span', {}, ...how, ' Changing the board switches the template when the current one does not apply, and keeps your callsign.')),
    anyExperimental ? check('Show experimental targets', app.showExperimental, v => app.setShowExperimental(v),
      `${hidden.length ? hidden.length + ' hidden: ' : ''}boards described from documentation and not yet verified on hardware (docs/hardware-log.md). They flash and configure like the rest; nothing has been tried on a real one.`) : null,
    app.board._pack ? h('p.hint', {}, 'This target comes from the catalog pack ', h('b', {}, app.board._pack), '.') : null,
    packsDisclosure());
}

/** Catalog packs: descriptors another site owns (hardware, targets, templates), merged over the built-ins. Data only. */
function packsDisclosure() {
  const packs = app.catalog.packs || [], saved = (() => { try { return JSON.parse(localStorage.getItem('fox-bench.packs') || '[]'); } catch { return []; } })();
  const urlIn = h('input', { type: 'url', placeholder: 'https://…/bench/  (a directory with pack.json)', style: 'flex:1;min-width:260px' });
  const add = () => { const u = urlIn.value.trim(); if (!u) return; savePacks([...saved.filter(x => x !== u), u]); location.reload(); };
  urlIn.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  return h('details', { style: 'margin-top:8px', open: packs.length ? '' : null },
    h('summary.hint', {}, `Catalog packs${packs.length ? ` (${packs.length})` : ''}`),
    h('p.hint', {},
      'A pack is another site\'s set of descriptors — its boards, targets and templates — laid out like this repository with a pack.json naming them. Its entries appear here, marked with the pack\'s name, and replace built-in ones with the same id. Packs are data only: a target may use one of this page\'s vendor models, but no code is ever loaded from a pack. The page reloads when the list changes.'),
    packs.length ? h('ul', {}, packs.map(p => h('li.hint', {}, p.error ? [h('code', {}, p.url), ' — ', h('span.err', {}, p.error)] : [h('b', {}, p.name), p.version ? ` ${p.version}` : '', ` — ${Object.entries(p.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')} · `, h('code', {}, p.url)],
      saved.includes(p.url) || saved.includes(p.url.replace(/\/$/, '')) ? [' ',
        h('button.btn.small', { onclick: () => { savePacks(saved.filter(x => x !== p.url && x + '/' !== p.url)); location.reload(); } },
          'remove')] : h('span.hint', {}, ' (from ?pack= in the address)')))) : null,
    h('div.tools', {}, urlIn, h('button.btn.small', { onclick: add }, 'Add pack')));
}

function diagCard() {
  const diag = h('div.card', {}, h('h3', {}, 'Something wrong?'),
    h('p.hint', {}, 'Download a diagnostics file and attach it to a ',
      h('a', { href: 'https://github.com/LC-Linkous/fox-bench/issues/new/choose', target: '_blank', rel: 'noopener' }, 'GitHub issue'),
      '. It holds the page version, your form, what the board reported, the last deploy, bench results and the console — no more than you can already see on this page.'),
    h('div.tools', {},
      h('button.btn.small',
        { onclick: () => download(`fox-bench-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
          JSON.stringify(app.diagnostics(), null, 1), 'application/json') },
        'Download diagnostics'),
      h('button.btn.small',
        { onclick: async e => { try { await navigator.clipboard.writeText(JSON.stringify(app.diagnostics(), null, 1)); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy to clipboard'; }, 1200); } catch { app.console.err('clipboard unavailable'); } } },
        'Copy to clipboard')));
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
  if (app.family === 'foxlib-c') return app.transport === 'console' ? renderConsoleFox() : renderFoxlibC();
  const b = app.board, ob = app.onBoard, info = app.info;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Connection'),
    ob.listening && !ob.template ? h('p.hint', {},
      'Listening only. Whatever the fox prints appears in the console below; tap the board\'s R button to watch it boot and read its FOX banner. Re-read board takes control (stops the fox).') : null,
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Connect a board (Chrome or Edge) or start the simulated one from the top bar.'),
        h('p.hint', {}, h('b', {}, 'The board must already be running CircuitPython.'),
          ' A bare board gets it from the Flash CircuitPython card here (hold B while plugging in, pick the port, click).'),
        h('p.hint', {}, h('b', {}, 'Board already running fox or other firmware?'), ' Plug in normally (no B button). ',
          h('b', {}, 'Connect'), ' interrupts whatever is running and takes the REPL; ', h('b', {}, 'Listen only'),
          ' just opens the port and shows the fox\'s output without stopping it. If Connect times out waiting for a prompt, tap the board\'s R (reset) button and try again.'))
      : h('dl.kv', {},
        h('dt', {}, 'Board id'), h('dd', {}, info.boardId,
          app.targetForBoardId(info.boardId) ? (app.targetForBoardId(info.boardId) === info.boardId ? '' : h('span.hint', {},
            ` — the ${app.board.name} runs this build`)) : badge('unknown to fox-bench', 'warn')),
        h('dt', {}, 'Chip UID'), h('dd', {}, info.uid),
        h('dt', {}, 'CircuitPython'), h('dd', {}, info.cpVersion || '?'),
        info.safeResets || info.safeReason ? h('dt', {}, 'Safe mode') : null,
        info.safeResets || info.safeReason ? h('dd', {},
          info.safeResets ? badge(`${info.safeResets} reset${info.safeResets === 1 ? '' : 's'} in a row`, 'warn') : 'recovered',
          info.safeReason ? ` — last reason ${info.safeReason}` : '',
          h('span.hint', {},
            info.safeReason && !['BROWNOUT', 'WATCHDOG'].includes(info.safeReason) ? ' (CircuitPython itself crashed; safemode.py stops resetting after 3 so the bench can get in. The console shows what the fox printed before it, with Deploy → Trace the boot.)' : ' (safemode.py reset the board back into a normal boot; the count clears once a cycle completes)')) : null,
        h('dt', {}, 'foxlib on board'), h('dd', {}, ob.foxlibVersion || '—', ob.foxlibVersion && ob.mpy ? ' (precompiled .mpy)' : '',
          ob.foxlibVersion && !ob.foxlibComplete ? badge(`incomplete: ${ob.foxlibMissing.length} missing`, 'err') : ob.foxlibVersion && ob.foxlibVersion !== app.catalog.foxlibVersion ? badge(`repo has ${app.catalog.foxlibVersion}`, 'warn') : ''),
        h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'),
        h('dt', {}, 'fox.json'), h('dd', {},
          ob.cfg ? `${ob.cfg.id?.callmessage} · ${(ob.cfg.plan?.frequencies_mhz || []).join(', ')} MHz` : ob.raw ? badge('invalid JSON', 'err') : '—'),
        h('dt', {}, 'Files'), h('dd', {}, Object.keys(ob.files).sort().join('  ') || '(empty)')),
    info ? h('div.tools', { style: 'margin-top:10px' },
      ob.cfg ? h('button.btn',
        { onclick: () => app.guard(async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim('working config replaced with the board\'s fox.json'); }) },
        'Load the board\'s config into the form') : null,
      h('button.btn.small',
        {title: 'Interrupts a running fox and lists its files again',
          onclick: () => app.guard(async () => { await app.readBoard(); app.changed('reread'); })},
        'Re-read board'),
      ob.template ? h('button.btn.small', { title: 'Soft-reboot so code.py runs (Ctrl-D)', onclick: () => app.restartFox() }, 'Restart fox') : null,
      h('span.hint', {}, ob.cfg ? 'Otherwise the form keeps what you were editing; Deploy shows the difference.' : '')) : null);

  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works'),
    h('ol.steps', {},
      h('li', {}, 'The form on tabs 2–7 is a complete ', h('code', {}, 'fox.json'),
        '. Every field is validated here and again by the firmware at boot.'),
      h('li', {}, 'Deploy writes ', h('code', {}, 'fox.json'), ', the template\'s ', h('code', {}, 'defaults.json'), ' and ',
        h('code', {}, 'code.py'), ', and ', h('code', {}, 'foxlib/'),
        ' when its version differs or files are missing — through the CircuitPython REPL, the same way Thonny saves files, each file verified by size and CRC. The board therefore has to be running CircuitPython already (Board tab → Flash CircuitPython for a bare one).'),
      h('li', {}, 'The board soft-reboots and the page reads the ', h('code', {}, 'FOX …'),
        ' banner back: config status, radio status, callsign set or not.')));

  const facts = h('div.card', {}, h('h3', {}, 'Board facts'),
    h('dl.kv', {}, h('dt', {}, 'CircuitPython id'), h('dd', {}, b.circuitpython.board_id), h('dt', {}, 'Flash'),
      h('dd', {}, `${b.flash.method} · ${b.flash.chip} @ ${b.flash.offset}`), h('dt', {}, 'USB drive'),
      h('dd', {},
        b.has_usb_drive ? 'yes (CIRCUITPY) — files still go through the REPL; the first Deploy hands the filesystem to the board (boot.py)' : 'none — files go through the REPL'),
      h('dt', {}, 'Battery'), h('dd', {}, b.battery?.divider_note || '—')),
    h('p.hint', {}, 'Wiring between this board and the radio module is on the Radio & pins tab.'));
  root.replaceChildren(pickerCard(), h('div.cols', {}, deviceCard, flashCard(app)), facts, flow, diagCard());
}

/** Drive family (PicoFox): the drive's files instead of a REPL. */
function renderDrive() {
  const b = app.board, v = app.vendor, ob = app.onBoard, info = app.info, m = app.module;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Connection'),
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Switch the fox ', h('b', {}, 'on'), ', plug in USB, then ',
          h('b', {}, `Open ${b.drive?.label || 'drive'}`), ' in the top bar and pick the drive it mounts (Chrome or Edge). Or ',
          h('i', {}, 'Try without hardware'), '.'),
        h('p.hint', {}, h('b', {}, 'This board runs the vendor\'s firmware, not CircuitPython.'),
          ' fox-bench writes the files that firmware reads: ',
          b.drive.files.map(f => h('code', {}, f)).flatMap((e, i) => i ? [' ', e] : [e]), '. ', b.drive.note),
        h('p.hint', {}, h('b', {}, 'Listen only'),
          ' opens the board\'s serial port and shows its boot messages after you switch it off and on — the only confirmation it gives.'))
      : h('dl.kv', {},
        h('dt', {}, 'Drive'), h('dd', {}, info.driveName || '—', ob.settings ? '' : badge(`no ${v.FILES.settings}`, 'warn')),
        h('dt', {}, 'Files'), h('dd', {},
          Object.entries(ob.files || {}).sort().map(([n, f]) => `${n} (${f.size} B)`).join('  ') || '(empty)'),
        h('dt', {}, 'Settings'), h('dd', {},
          ob.settings ? `${ob.settings.CALLSIGN || '(no callsign — silent)'} · ${ob.settings.FREQ_MHZ} MHz · zone ${ob.settings.ITU_ZONE} · duty ${ob.settings.DUTY_CYCLE} % · atten ${ob.settings.ATTENUATION}` : '—'),
        h('dt', {}, 'ID audio'), h('dd', {},
          ob.markerOk == null ? '—' : ob.markerOk ? badge('kept by the firmware (marker matches)', 'ok') : badge('firmware will regenerate its own at power-on', 'warn'))),
    info ? h('div.tools', { style: 'margin-top:10px' },
      ob.cfg ? h('button.btn',
        { onclick: () => app.guard(async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim(`form replaced with the drive's ${v.FILES.settings}`); }) },
        'Load the drive\'s settings into the form') : null,
      h('button.btn.small', { onclick: () => app.guard(async () => { await app.readDrive(); app.changed('reread'); }) }, 'Re-read drive'),
      h('span.hint', {}, 'Only settings come back: the audio on the drive is not reversible into a playlist.')) : null);
  const notes = h('div.card', {}, h('h3', {}, 'Things this firmware does quietly'), h('ul', {}, (b.notes || []).map(n => h('li', {}, n))));
  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works here'),
    h('ol.steps', {},
      h('li', {}, 'The form (tabs 3–7) becomes ', h('code', {}, v.FILES.settings), ', an ', h('code', {}, v.FILES.audio),
        ' rendered from the payload, the Morse ID as ', h('code', {}, v.FILES.id), ' and the marker file ', h('code', {}, v.FILES.marker),
        ' (a byte-sum of the settings) that tells the firmware to keep our ID audio.'),
      h('li', {}, 'Deploy writes the four files to the drive and reads each one back.'),
      h('li', {}, 'You eject the drive and switch the fox off and on. It does not transmit while a computer has the drive mounted. ',
        h('b', {}, 'Listen only'), ' shows the boot messages if you want the confirmation.')));
  const facts = h('div.card', {}, h('h3', {}, 'Board facts'),
    h('dl.kv', {}, h('dt', {}, 'Family'), h('dd', {}, 'vendor firmware, configured by files on its USB drive'), h('dt', {}, 'Radio'),
      h('dd', {}, `${m.name}: ${m.ranges_mhz.map(([a, c]) => `${a}–${c} MHz`).join(', ')}`), h('dt', {}, 'Power'),
      h('dd', {}, `about ${m.power_dbm.high} dBm, attenuator to ${m.power_dbm.low} dBm (rev 3)`), h('dt', {}, 'Audio'),
      h('dd', {}, `${m.audio.sample_rate_hz} Hz ${m.audio.bits}-bit mono WAV, up to ±${m.audio.max_deviation_hz / 1000} kHz deviation`),
      h('dt', {}, 'USB'), h('dd', {}, `drive "${b.drive.label}" + serial (boot messages only)`), h('dt', {}, 'Battery'),
      h('dd', {}, b.battery?.divider_note || '—')));
  root.replaceChildren(pickerCard(), h('div.cols', {}, deviceCard, flashCard(app)), notes, facts, flow, diagCard());
}

/** A console-configured fox (an ESP32 board on fox-bench's C firmware): no drive — fox.json travels over the serial console
 *  the board is flashed through, and the banner, log and bench answer on the same console. */
function renderConsoleFox() {
  const b = app.board, ob = app.onBoard, info = app.info, hw = app.hardware;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Connection'),
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Plug in USB, then ', h('b', {}, 'Connect'), ' in the top bar and pick the board\'s serial port (Chrome or Edge): the page asks the fox who it is (', h('code', {}, 'version'), ', ', h('code', {}, 'uid'), ') and reads its ', h('code', {}, 'fox.json'), ' back. Or ', h('i', {}, 'Try without hardware'), '.'),
        h('p.hint', {}, h('b', {}, 'No fox on the port?'), ' The board still runs other firmware (CircuitPython, say). Flash fox-bench\'s from the card on the right; CircuitPython can be put back the same way at any time.'),
        h('p.hint', {}, h('b', {}, 'Listen only'), ' opens the console without taking control: the ', h('code', {}, 'FOX …'),
          ' banner appears at once, the log streams while the fox runs, and the console below takes commands (', h('code', {}, 'help'), ').'))
      : ob.listening ? h('dl.kv', {},
        h('dt', {}, 'Console'), h('dd', {}, 'listening',
          ob.template ? '' : badge('no banner yet — it prints when the port opens and after every reload', 'warn')),
        h('dt', {}, 'Board id'), h('dd', {}, info.boardId || '—'), h('dt', {}, 'Chip UID'), h('dd', {}, info.uid || '—'),
        h('dt', {}, 'Firmware'), h('dd', {}, ob.foxlibVersion ? `foxlib-${ob.foxlibVersion}` : '—', fwBadge(app, ob.foxlibVersion)), h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'))
      : h('dl.kv', {},
        h('dt', {}, 'Board id'), h('dd', {}, info.boardId || '—'), h('dt', {}, 'Chip UID'), h('dd', {}, info.uid || '—'),
        h('dt', {}, 'Firmware'), h('dd', {}, ob.foxlibVersion ? `foxlib-${ob.foxlibVersion}` : '—', fwBadge(app, ob.foxlibVersion)),
        h('dt', {}, 'Files'), h('dd', {},
          Object.entries(ob.files || {}).sort().map(([n, f]) => `${n} (${f.size} B)`).join('  ') || '(none)', ob.cfg ? '' : badge('no fox.json', 'warn')),
        h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'),
        h('dt', {}, 'fox.json'), h('dd', {},
          ob.cfg ? `${ob.cfg.id?.callmessage} · ${ob.cfg.net?.kind || '?'}${ob.cfg.net?.ssid ? ' "' + ob.cfg.net.ssid + '"' : ob.cfg.net?.name ? ' "' + ob.cfg.net.name + '"' : ''}` : ob.raw ? badge('invalid JSON', 'err') : '—')),
    info && !ob.listening ? h('div.tools', { style: 'margin-top:10px' },
      ob.cfg ? h('button.btn',
        { onclick: () => app.guard(async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim('working config replaced with the fox\'s fox.json'); }) },
        'Load the fox\'s config into the form') : null,
      h('button.btn.small', { onclick: () => app.guard(async () => { await app.readConsole(); app.changed('reread'); }) }, 'Re-read fox'),
      h('button.btn.small', { onclick: () => app.device.send?.('status') }, 'Status'),
      h('span.hint', {}, ob.cfg ? 'Otherwise the form keeps what you were editing; Deploy shows the difference.' : '')) : null);
  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works here'),
    h('ol.steps', {},
      h('li', {}, 'The form on tabs 2–7 is a complete ', h('code', {}, 'fox.json'),
        ', the same contract the CircuitPython network foxes use. Validated here and again by the firmware when it loads.'),
      h('li', {}, 'Deploy sends ', h('code', {}, 'fox.json'), ' and the template\'s ', h('code', {}, 'defaults.json'),
        ' over the console (', h('code', {}, 'put'), ', checked by size and CRC) and reads them back. There is no code to copy: the behaviour is in the firmware, chosen by the template id.'),
      h('li', {}, 'About a second after the last file the fox reloads by itself and prints a fresh ', h('code', {}, 'FOX …'),
        ' banner on the same console. No drive, no eject, no power cycle.')));
  const facts = h('div.card', {}, h('h3', {}, 'Board facts'),
    h('dl.kv', {}, h('dt', {}, 'Family'), h('dd', {}, `fox-bench native firmware (C, ESP-IDF, GPL-3.0-or-later) on the ${hw?.name || b.name}`),
      h('dt', {}, 'Radios'), h('dd', {}, (hw?.radios || []).join(', ') || '—'),
      h('dt', {}, 'USB'), h('dd', {}, 'serial console only (banner, log, bench commands, the files) — no drive'),
      h('dt', {}, 'LED'), h('dd', {}, hw?.net?.led ? hw.net.led : 'none on the bare board (the fox runs dark unless a LED is wired to a pin)')),
    h('p.hint', {}, b.firmware?.note || ''));
  root.replaceChildren(pickerCard(), h('div.cols', {}, deviceCard, flashCard(app)), facts, flow, diagCard());
}

/** foxlib-c family (PicoFox with fox-bench's own firmware): fox.json on its FOXBENCH drive, banner and bench on its serial console. */
function renderFoxlibC() {
  const b = app.board, ob = app.onBoard, info = app.info, m = app.module;
  const deviceCard = h('div.card', {},
    h('h3', {}, 'Connection'),
    !info ? h('div', {},
        h('p.hint', {}, 'Not connected. Switch the fox ', h('b', {}, 'on'), ', plug in USB, then ',
          h('b', {}, `Open ${b.drive?.label || 'drive'}`), ' in the top bar and pick the ', h('code', {}, b.drive?.label || 'FOXBENCH'),
          ' drive (Chrome or Edge). Or ', h('i', {}, 'Try without hardware'), '.'),
        h('p.hint', {}, h('b', {}, 'No ', h('code', {}, b.drive?.label || 'FOXBENCH'), ' drive?'),
          ' The board still runs other firmware. Flash fox-bench\'s from the card on the right ("Reboot into bootloader", then copy; BOOTSEL itself is inside the case). The vendor firmware can be put back the same way at any time.'),
        h('p.hint', {}, h('b', {}, 'Listen only'), ' opens the serial console: the ', h('code', {}, 'FOX …'),
          ' banner appears at once, the log streams while the fox runs, and the console below takes commands (', h('code', {}, 'help'), ').'))
      : ob.listening ? h('dl.kv', {},
        h('dt', {}, 'Console'), h('dd', {}, 'listening',
          ob.template ? '' : badge('no banner yet — it prints when the port opens and after every reload', 'warn')),
        h('dt', {}, 'Board id'), h('dd', {}, info.boardId || '—'), h('dt', {}, 'Chip UID'), h('dd', {}, info.uid || '—'),
        h('dt', {}, 'Firmware'), h('dd', {}, ob.foxlibVersion ? `foxlib-${ob.foxlibVersion}` : '—', fwBadge(app, ob.foxlibVersion)), h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'))
      : h('dl.kv', {},
        h('dt', {}, 'Drive'), h('dd', {}, info.driveName || '—', ob.cfg ? '' : badge('no fox.json', 'warn')),
        h('dt', {}, 'Firmware'), h('dd', {}, ob.foxlibVersion ? `foxlib-${ob.foxlibVersion}` : '— (no board.json: firmware before 0.1.4)',
          fwBadge(app, ob.foxlibVersion)),
        h('dt', {}, 'Files'), h('dd', {},
          Object.entries(ob.files || {}).sort().map(([n, f]) => `${n} (${f.size} B)`).join('  ') || '(empty)'),
        h('dt', {}, 'Template on board'), h('dd', {}, ob.template || '—'),
        h('dt', {}, 'fox.json'), h('dd', {},
          ob.cfg ? `${ob.cfg.id?.callmessage} · ${(ob.cfg.plan?.frequencies_mhz || []).join(', ')} MHz` : ob.raw ? badge('invalid JSON', 'err') : '—')),
    info && !ob.listening ? h('div.tools', { style: 'margin-top:10px' },
      ob.cfg ? h('button.btn',
        { onclick: () => app.guard(async () => { await app.loadCfg(ob.cfg, { source: 'board' }); app.console.dim('working config replaced with the drive\'s fox.json'); }) },
        'Load the drive\'s config into the form') : null,
      h('button.btn.small', { onclick: () => app.guard(async () => { await app.readDrive(); app.changed('reread'); }) }, 'Re-read drive'),
      h('span.hint', {}, ob.cfg ? 'Otherwise the form keeps what you were editing; Deploy shows the difference.' : '')) : null,
    app.consoleDevice() ? h('div.tools', { style: 'margin-top:10px' },
      h('button.btn.small',
        { onclick: async e => { if (!confirm('Jump to the UF2 bootloader? The fox stops, this port disappears and an RPI-RP2 drive appears. Copy a .uf2 there to come back (fox-bench or the vendor\'s).')) return; e.currentTarget.disabled = true; const ok = await app.consoleDevice().bootsel(); app.console.line(ok ? 'bootsel sent — look for the RPI-RP2 drive' : 'bootsel: no reply', ok ? 'ok' : 'err'); } },
        'Enter UF2 bootloader (bootsel)'),
      h('button.btn.small', { onclick: () => app.consoleDevice().send('status') }, 'Status'),
      h('span.hint', {}, 'The firmware card on the right then copies a .uf2 onto that drive.')) : null);
  const flow = h('div.card', {}, h('h3', {}, 'How a deploy works here'),
    h('ol.steps', {},
      h('li', {}, 'The form on tabs 2–7 is a complete ', h('code', {}, 'fox.json'),
        ', the same contract the CircuitPython foxes use. Validated here and again by the firmware when it loads.'),
      h('li', {}, 'Deploy writes ', h('code', {}, 'fox.json'), ', the template\'s ', h('code', {}, 'defaults.json'), ' and, for SSTV, ',
        h('code', {}, 'images.bin'),
        ' to the drive and reads them back. There is no code to copy: the behaviour is in the firmware, chosen by the template id.'),
      h('li', {}, 'About a second after the last write the fox reloads by itself and prints a fresh ', h('code', {}, 'FOX …'),
        ' banner on its serial console (Listen only). No eject, no power cycle — unless you turned ', h('code', {}, 'tx_while_mounted'),
        ' off on the Radio tab.')));
  const facts = h('div.card', {}, h('h3', {}, 'Board facts'),
    h('dl.kv', {}, h('dt', {}, 'Family'), h('dd', {}, 'fox-bench native firmware (C, Pico SDK, GPL-3.0-or-later) on the PicoFox hardware'),
      h('dt', {}, 'Radio'),
      h('dd', {}, `${m.name}: ${m.ranges_mhz.map(([a, c]) => `${a}–${c} MHz`).join(', ')}; FM by PLL fraction updates at 8 000 samples/s`),
      h('dt', {}, 'Power'), h('dd', {}, `about ${m.power_dbm.high} dBm, attenuator to ${m.power_dbm.low} dBm (rev 3)`), h('dt', {}, 'USB'),
      h('dd', {}, `drive "${b.drive.label}" + serial console (banner, log, bench commands)`), h('dt', {}, 'Battery'),
      h('dd', {}, 'internal LiPo; the firmware can only report whether it is charging')),
    h('p.hint', {},
      'Hardware design by AI6YM.radio (CC BY-NC-SA 4.0). The firmware is fox-bench\'s own, written from the published schematic — see ',
      h('code', {}, 'docs/picofox.md'),
      '. On the air since October 2026 on a rev 3 board (keying, FM, live reload, the console bench). Still unmeasured: the attenuator\'s dB per step — the firmware accepts the codes; a power meter will confirm the scale.'));
  root.replaceChildren(pickerCard(), h('div.cols', {}, deviceCard, flashCard(app)), facts, flow, diagCard());
}

