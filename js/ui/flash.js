// flash.js — the Flash CircuitPython card (Board tab) and the batch card (Fleet tab).
// Both drive flasher/flasher.js (separate Apache-2.0 component) and write the same fleet-log rows as tools/batch_flash.py.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select, check } from './dom.js';
import { fleet } from '../model/profiles.js';
import * as flasher from '../../flasher/flasher.js';   // separate component, Apache-2.0 (flasher/LICENSE)

const KEY_N = 'fox-bench.batchNumber';
export const state = {
  busy: false, phase: '', progress: 0, last: null,          // last: { ok, facts, error, when }
  erase: true, baud: 460800, version: '', fetching: false, fetchError: '',
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
  if (app.device && app.device.kind !== 'demo') return 'disconnect from the board first (Connect tab) — the flasher opens the port itself';
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
  if (b.flash.method !== 'esptool') {
    return h('div.card', {}, h('h3', {}, 'Flash CircuitPython'), h('p.hint', {}, `${b.name} is flashed by ${b.flash.method}, which this page does not do yet. `, h('a', { href: b.circuitpython.download, target: '_blank', rel: 'noopener' }, 'CircuitPython downloads for this board'), '.'));
  }
  if (!state.version) state.version = b.circuitpython.latest_known || '';
  const fileIn = h('input', { type: 'file', accept: '.bin', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    flasher.setImage(f.name, new Uint8Array(await f.arrayBuffer()), 'file'); state.fetchError = ''; notify(); app.console.dim(`loaded ${f.name} (${f.size} B)`); fileIn.value = '';
  });
  const verIn = h('input', { type: 'text', value: state.version, placeholder: '10.2.1', style: 'width:110px', oninput: e => { state.version = e.target.value.trim(); } });
  const fetchBtn = h('button.btn.small', { disabled: state.fetching, onclick: async () => {
    const url = flasher.BIN_URL(b.circuitpython.board_id, state.version);
    state.fetching = true; state.fetchError = ''; notify();
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      flasher.setImage(url.split('/').pop(), new Uint8Array(await r.arrayBuffer()), 'download'); app.console.dim(`downloaded ${url}`);
    } catch (e) { state.fetchError = `Could not fetch ${url} from the browser (${e.message}). Download it from circuitpython.org and use Load .bin.`; }
    state.fetching = false; notify();
  } }, state.fetching ? 'Fetching…' : 'Fetch from circuitpython.org');
  const mism = flasher.image.info && flasher.image.info.boardId !== b.circuitpython.board_id;
  const why = blocker(app);
  return h('div.card', {}, h('h3', {}, 'Flash CircuitPython ', imageBadge()),
    h('p.hint', {}, 'For a bare board, or to reset one to factory CircuitPython. ', h('b', {}, b.flash.bootloader_instructions), ' The board then shows up as a new serial port; pick that one when asked.'),
    field('Image', h('div.row', {}, h('button.btn.small', { onclick: () => fileIn.click() }, 'Load .bin…'), fileIn, h('span.hint', {}, 'or version'), verIn, fetchBtn),
      h('span', {}, h('a', { href: b.circuitpython.download, target: '_blank', rel: 'noopener' }, `CircuitPython downloads for ${b.name}`), ' — the .bin, not the .uf2.')),
    state.fetchError ? h('p.hint.warn', {}, state.fetchError) : null,
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
