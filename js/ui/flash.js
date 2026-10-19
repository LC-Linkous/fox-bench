// flash.js — the Flash CircuitPython card (Board tab) and the batch card (Fleet tab).
// Both drive flasher/flasher.js (separate Apache-2.0 component) and write the same fleet-log rows as tools/batch_flash.py.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select, check } from './dom.js';
import { fleet } from '../model/profiles.js';
import * as flasher from '../../flasher/flasher.js';   // separate component, Apache-2.0 (flasher/LICENSE)

const KEY_N = 'fox-bench.batchNumber';
export const state = {
  busy: false, phase: '', progress: 0, last: null,          // last: { ok, facts, error, when }
  erase: true, baud: 460800,
  get boardNumber() { return parseInt(localStorage.getItem(KEY_N) || '1', 10) || 1; },
  set boardNumber(n) { try { localStorage.setItem(KEY_N, String(n)); } catch {} },
};
const rerenders = new Set();
export const onChange = fn => rerenders.add(fn);
const notify = () => rerenders.forEach(fn => fn());

function imageBadge() {
  const im = flasher.image;
  if (!im.bytes) return badge('no image loaded', 'warn');
  return badge(`${im.name} · ${(im.bytes.length / 1024).toFixed(0)} kB`, 'ok');
}

/** Why the Flash button is disabled, or '' if it can go. */
export function blocker(app) {
  if (state.busy) return 'flashing…';
  if (!flasher.image.bytes) return 'load a CircuitPython .bin first';
  if (app.device && app.device.kind !== 'demo') return 'disconnect from the board first (top bar) — the flasher opens the port itself';
  if (!app.device && !('serial' in navigator)) return 'Web Serial is not available in this browser';
  return '';
}

/** Run one flash, log to the console, append a fleet row. Returns facts or throws. */
export async function runFlash(app, { boardNumber = '' } = {}) {
  const demo = app.device?.kind === 'demo';
  const b = app.board;
  state.busy = true; state.phase = 'starting'; state.progress = 0; state.last = null; notify();
  const log = app.console;
  log.dim(`flash ${flasher.image.name} → ${b.name}${demo ? ' (demo)' : ''}`);
  let facts = null, error = null;
  try {
    facts = await flasher.flash({
      offset: parseInt(b.flash.offset, 16) || 0, eraseAll: state.erase, baud: state.baud,
      impl: demo ? flasher.demoEsptool() : null,
      onLog: t => log.dim(t), onPhase: p => { state.phase = p; notify(); },
      onProgress: f => { state.progress = f; notify(); },
    });
    log.line(`flashed ${flasher.image.name} in ${facts.seconds} s · ${facts.chip} · MAC ${facts.mac}`, 'ok');
  } catch (e) {
    error = String(e.message || e); facts = e.facts || null;
    log.err('flash failed: ' + error);
  }
  state.busy = false; state.phase = ''; state.last = { ok: !error, facts, error, when: new Date().toISOString() };
  fleet.append({
    board_number: boardNumber, uid: (facts?.mac || '').replace(/:/g, ''), mac: facts?.mac || '', board: b.id,
    chip_type: facts?.chip || '', revision: facts?.revision || '', features: facts?.features || '', crystal: facts?.crystal || '', usb_mode: '',
    action: 'flash', template: '', profile: '', callsign: '', freq: '', power: '', seed: '',
    result: error ? 'fail: ' + error.slice(0, 80) : 'ok', notes: [flasher.image.name, facts?.flash_size, demo ? 'demo' : ''].filter(Boolean).join(' · '),
  });
  notify(); app.changed('flash');
  if (error) throw new Error(error);
  return facts;
}

/** Progress / result block shared by both cards. */
export function statusBlock() {
  const out = [];
  if (state.busy) out.push(h('p.hint', {}, badge('working', 'warn'), ' ', state.phase), h('progress', { max: 1, value: state.progress, style: 'width:100%' }));
  const l = state.last;
  if (l && !state.busy) {
    out.push(l.ok
      ? h('p.hint.ok', {}, `Flashed in ${l.facts.seconds} s — ${l.facts.chip}, MAC ${l.facts.mac}${l.facts.flash_size ? ', ' + l.facts.flash_size + ' flash' : ''}. The board is rebooting into CircuitPython; first boot takes ~10 s and it may come back on a different port. Then `, h('b', {}, 'Connect'), '.')
      : h('p.hint.err', {}, 'Flash failed: ', l.error, l.facts?.chip ? ` (reached the chip: ${l.facts.chip})` : ' (never reached the bootloader — hold B while plugging in, pick the port that appears, and check nothing else holds it)'));
  }
  return out;
}

/** Board tab: image source, options, one flash. */
export function flashCard(app) {
  const b = app.board;
  if (b.flash.method === 'uf2') return uf2Card(app);
  if (b.flash.method !== 'esptool') {
    return h('div.card', {}, h('h3', {}, 'Flash CircuitPython'), h('p.hint', {}, `${b.name} is flashed by ${b.flash.method}, which this page does not do yet. `, b.circuitpython ? h('a', { href: b.circuitpython.download, target: '_blank', rel: 'noopener' }, 'CircuitPython downloads for this board') : null, '.'));
  }
  const fileIn = h('input', { type: 'file', accept: '.bin', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    flasher.setImage(f.name, new Uint8Array(await f.arrayBuffer()), 'file'); state.fetchError = ''; notify(); app.console.dim(`loaded ${f.name} (${f.size} B)`); fileIn.value = '';
  });
  const mism = flasher.image.info && flasher.image.info.boardId !== b.circuitpython.board_id;
  const why = blocker(app);
  return h('div.card', {}, h('h3', {}, 'Flash CircuitPython ', imageBadge()),
    h('p.hint', {}, 'For a bare board, or to reset one to factory CircuitPython. ', h('b', {}, b.flash.bootloader_instructions), ' The board then shows up as a new serial port; pick that one when asked.'),
    field('Image', h('div.row', {}, h('button.btn.small', { onclick: () => fileIn.click() }, 'Load .bin…'), fileIn, h('span.hint', {}, flasher.image.bytes ? `${flasher.image.name}${flasher.image.info ? ' · CircuitPython ' + flasher.image.info.version : ''}` : 'nothing loaded')),
      h('span', {}, 'Get it from ', h('a', { href: b.circuitpython.download, target: '_blank', rel: 'noopener' }, `circuitpython.org › ${b.name}`), ` — the .bin (not the .uf2). ${b.circuitpython.latest_known ? 'Last known good: ' + b.circuitpython.latest_known + '. ' : ''}The download site does not allow a page to fetch it directly, so it is a save-then-load.`)),
    mism ? h('p.hint.err', {}, `This image is for "${flasher.image.info.boardId}", not ${b.circuitpython.board_id}. Flashing it would brick nothing but it will not run right.`) : null,
    h('div.two-col', {},
      check('Erase the whole flash first', state.erase, v => { state.erase = v; notify(); }, 'Also wipes the board\'s files (fox.json, foxlib). What a fleet reset wants; off only for a quick CircuitPython upgrade that keeps the files.'),
      field('Speed', select([[921600, '921600 baud'], [460800, '460800 baud (default)'], [230400, '230400 baud'], [115200, '115200 baud (safe)']], state.baud, v => { state.baud = +v; }), 'Drop it if the write fails part way.')),
    h('div.tools', {},
      h('button.btn.primary', { disabled: !!why, title: why, onclick: () => runFlash(app).catch(() => {}) }, state.busy ? 'Flashing…' : 'Flash CircuitPython'),
      why && !state.busy ? h('span.hint', {}, why) : null),
    ...statusBlock(),
    h('p.hint', {}, 'The flasher is a separate component of fox-bench (', h('code', {}, 'flasher/'), ', Apache-2.0) built on ', h('a', { href: 'https://github.com/espressif/esptool-js', target: '_blank', rel: 'noopener' }, 'esptool-js'), ` ${flasher.ESPTOOL_VERSION}. Works offline. From a terminal, `, h('code', {}, 'tools/batch_flash.py'), ' does the same with the same log columns.'));
}

/** Fleet tab: plug → click → next. */
export function batchCard(app) {
  if (app.board.flash.method !== 'esptool') return h('div.card', {}, h('h3', {}, 'Batch flashing'), h('p.hint', {}, `${app.board.name} does not run CircuitPython; there is nothing to batch-flash. Select an ESP32 board on the Board tab for this.`));
  const why = blocker(app);
  const n = state.boardNumber;
  return h('div.card', {}, h('h3', {}, 'Batch flashing ', imageBadge()),
    h('p.hint', {}, 'Plug a board in with B held → click → it is erased, flashed and logged with its MAC and chip facts → unplug → next. One click per board because the browser grants each port by hand. Same CSV columns as ', h('code', {}, 'tools/batch_flash.py'), '.'),
    flasher.image.bytes ? null : h('p.hint.warn', {}, 'Load the CircuitPython image on the Board tab first.'),
    h('div.tools', {},
      h('button.btn.primary', { disabled: !!why, title: why, onclick: () => runFlash(app, { boardNumber: n }).then(() => { state.boardNumber = n + 1; notify(); }).catch(() => {}) }, state.busy ? 'Flashing…' : `Flash board #${n}`),
      h('span.hint', {}, 'next number '), h('input', { type: 'number', min: 1, value: n, style: 'width:80px', onchange: e => { state.boardNumber = Math.max(1, parseInt(e.target.value, 10) || 1); notify(); } }),
      why && !state.busy ? h('span.hint', {}, why) : null),
    ...statusBlock());
}

/** UF2 boards (PicoFox): no CircuitPython; the only flash operation is copying a vendor .uf2 to the bootloader drive. */
let uf2 = { name: '', bytes: null, busy: false, last: null };
function uf2Card(app) {
  const b = app.board;
  const fileIn = h('input', { type: 'file', accept: '.uf2', hidden: true });
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (!f) return; uf2 = { ...uf2, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), last: null }; notify(); fileIn.value = ''; });
  const copy = async () => {
    uf2.busy = true; uf2.last = null; notify();
    try {
      if (!('showDirectoryPicker' in window)) throw new Error('this browser cannot open a drive folder (Chrome or Edge needed)');
      const dir = await window.showDirectoryPicker({ id: 'fox-bench-uf2', mode: 'readwrite' });
      if (dir.name && b.flash.drive_name && dir.name.toUpperCase() !== b.flash.drive_name && !confirm(`The folder is "${dir.name}", not ${b.flash.drive_name}. Copy the UF2 there anyway?`)) throw new Error('cancelled');
      const h2 = await dir.getFileHandle(uf2.name, { create: true }); const w = await h2.createWritable(); await w.write(uf2.bytes); await w.close();
      uf2.last = { ok: true, text: `${uf2.name} copied (${(uf2.bytes.length / 1024).toFixed(0)} kB). The board reboots into the new firmware by itself and the ${b.flash.drive_name} drive disappears.` };
      app.console.line(`UF2 ${uf2.name} copied to ${dir.name}`, 'ok');
      fleet.append({ board_number: '', uid: '', board: b.id, action: 'flash', template: '', profile: '', callsign: '', freq: '', power: '', seed: '', result: 'ok', notes: uf2.name + ' (uf2)' });
    } catch (e) { if (e.name !== 'AbortError' && e.message !== 'cancelled') { uf2.last = { ok: false, text: String(e.message || e) }; app.console.err('UF2 copy failed: ' + uf2.last.text); } }
    uf2.busy = false; notify(); app.changed('flash');
  };
  return h('div.card', {}, h('h3', {}, 'Firmware ', badge('no CircuitPython', 'warn')),
    h('p.hint', {}, h('b', {}, `This fox board does not run CircuitPython.`), ' ', b.flash.note),
    h('p.hint', {}, h('b', {}, 'Bootloader: '), b.flash.bootloader_instructions, ' Firmware is a .uf2 file copied onto that drive; the board reboots when the copy finishes. The vendor\'s releases are at ', h('a', { href: b.flash.stock_firmware_url, target: '_blank', rel: 'noopener' }, 'their GitHub'), '.'),
    h('div.tools', {}, h('button.btn.small', { onclick: () => fileIn.click() }, 'Load .uf2…'), fileIn, h('span.hint', {}, uf2.name ? `${uf2.name} · ${(uf2.bytes.length / 1024).toFixed(0)} kB` : 'nothing loaded'),
      h('button.btn', { disabled: !uf2.bytes || uf2.busy, onclick: copy }, uf2.busy ? 'Copying…' : `Copy to ${b.flash.drive_name}…`)),
    uf2.last ? h('p.hint' + (uf2.last.ok ? '.ok' : '.err'), {}, uf2.last.text) : null,
    h('p.hint', {}, 'There is no "flash CircuitPython" here on purpose; the batch-flashing card on the Fleet tab is for the ESP32 family.'));
}
