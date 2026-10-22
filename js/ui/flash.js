// flash.js — the Flash CircuitPython card (Board tab) and the batch card (Fleet tab).
// Both drive flasher/flasher.js (separate Apache-2.0 component) and write the same fleet-log rows as tools/batch_flash.py.
// SPDX-License-Identifier: GPL-2.0-only
import { checkImage, foxlibcVersionIn } from '../model/uf2.js';
import { cmpVersion } from '../model/compat.js';
import { h, badge, field, select, check } from './dom.js';
import { fleet } from '../model/profiles.js';
import * as flasher from '../../flasher/flasher.js';   // separate component, Apache-2.0 (flasher/LICENSE)

const KEY_N = 'fox-bench.batchNumber';
export const state = {
  busy: false, phase: '', progress: 0, last: null,          // last: { ok, facts, error, when }
  erase: true, baud: 460800,
  simulate: false, simulateChip: '',                        // tests: run the flasher against the simulated esptool, pretending this chip
  get boardNumber() { return parseInt(localStorage.getItem(KEY_N) || '1', 10) || 1; },
  set boardNumber(n) { try { localStorage.setItem(KEY_N, String(n)); } catch {} },
};
if (typeof window !== 'undefined') window.foxbenchFlash = state;   // the smoke test flips simulate
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
  if (!flasher.image.bytes) return app.isCompiled ? 'get or load an image first' : 'load a CircuitPython .bin first';
  if (app.device && app.device.kind !== 'demo') return 'disconnect from the board first (top bar) — the flasher opens the port itself';
  if (!app.device && !('serial' in navigator)) return 'Web Serial is not available in this browser';
  return '';
}

/** Run one flash, log to the console, append a fleet row. Returns facts or throws. */
export async function runFlash(app, { boardNumber = '' } = {}) {
  const demo = app.device?.kind === 'demo' || state.simulate;
  const b = app.board;
  if (demo) flasher.demoEsptool.chipName = state.simulateChip || (b.flash.chip === 'esp32c3' ? 'ESP32-C3 (QFN32) (revision v0.4)' : b.flash.chip.toUpperCase().replace(/^ESP32(.)/, 'ESP32-$1'));
  state.busy = true; state.phase = 'starting'; state.progress = 0; state.last = null; notify();
  const log = app.console;
  log.dim(`flash ${flasher.image.name} → ${b.name}${demo ? ' (demo)' : ''}`);
  let facts = null, error = null;
  try {
    facts = await flasher.flash({
      offset: parseInt(b.flash.offset, 16) || 0, eraseAll: state.erase, baud: state.baud, expectChip: b.flash.chip || '',
      impl: demo ? flasher.demoEsptool() : null,
      onLog: t => log.dim(t), onPhase: p => { state.phase = p; notify(); },
      onProgress: f => { state.progress = f; notify(); },
    });
    log.line(`flashed ${flasher.image.name} in ${facts.seconds} s · ${facts.chip} · MAC ${facts.mac}`, 'ok');
  } catch (e) {
    error = String(e.message || e); facts = e.facts || null;
    log.err('flash failed: ' + error);
  }
  state.busy = false; state.phase = ''; state.last = { ok: !error, facts, error, when: new Date().toISOString(), kind: app.isCompiled ? 'compiled' : 'circuitpython' };
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
      ? h('p.hint.ok', {}, `Flashed in ${l.facts.seconds} s — ${l.facts.chip}, MAC ${l.facts.mac}${l.facts.flash_size ? ', ' + l.facts.flash_size + ' flash' : ''}. `, l.kind === 'compiled' ? 'The board is rebooting into the kitsune firmware: the LED goes violet, then the challenge colour; Listen only shows its boot lines.' : ['The board is rebooting into CircuitPython; first boot takes ~10 s and it may come back on a different port. Then ', h('b', {}, 'Connect'), '.'])
      : h('p.hint.err', {}, 'Flash failed: ', l.error, l.facts?.chip ? ` (reached the chip: ${l.facts.chip})` : ' (never reached the bootloader — hold B while plugging in, pick the port that appears, and check nothing else holds it)'));
  }
  return out;
}

/** Board tab: image source, options, one flash. */
export function flashCard(app) {
  const b = app.board;
  if (b.flash.method === 'uf2') return uf2Card(app);
  if (app.isCompiled) return compiledCard(app);
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

/** Compiled family (kitsune): a merged image per board × challenge, from the site's manifest (built in CI from a pinned
 * commit, once agreed) or a file built with PlatformIO; esptool at the board's offset, chip checked first. */
let kManifest;   // undefined = not fetched; null = fetching; false = none on this site; else { commit, source, images: [...] }
async function loadKitsuneManifest(app) {
  if (kManifest !== undefined) return kManifest;
  kManifest = null;
  const url = app.board.firmware?.manifest || 'firmware/kitsune/manifest.json';
  try { const r = await fetch(url, { cache: 'no-cache' }); kManifest = r.ok ? await r.json() : false; } catch { kManifest = false; }
  notify(); return kManifest;
}
async function fetchKitsuneImage(app, entry) {
  state.fetchError = ''; state.fetching = true; notify();
  try {
    const r = await fetch(entry.url || `firmware/kitsune/${entry.file}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const d = await crypto.subtle.digest('SHA-256', bytes), sha = [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (entry.sha256 && sha !== entry.sha256.toLowerCase()) throw new Error(`sha256 ${sha.slice(0, 12)}… does not match the manifest's ${entry.sha256.slice(0, 12)}… (a deploy may be in progress: reload and try again)`);
    if (entry.size && bytes.length !== entry.size) throw new Error(`size ${bytes.length}, manifest says ${entry.size}`);
    flasher.setImage(entry.file, bytes, 'fox-bench-kitsune');
    app.console.dim(`fetched ${entry.file} (${(bytes.length / 1024).toFixed(0)} kB, sha256 ${sha.slice(0, 12)}… = manifest) — fox-bench's build of kitsune at ${(kManifest.commit || '').slice(0, 7)}`);
  } catch (e) { state.fetchError = String(e.message || e); app.console.err('image fetch failed: ' + state.fetchError); }
  state.fetching = false; notify();
}
function compiledCard(app) {
  const b = app.board, hw = app.hardware || {}, v = app.vendor, t = v?.TEMPLATES[app.templateId] || {};
  if (kManifest === undefined) loadKitsuneManifest(app);
  const fileIn = h('input', { type: 'file', accept: '.bin', hidden: true });
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (!f) return; flasher.setImage(f.name, new Uint8Array(await f.arrayBuffer()), 'file'); state.fetchError = ''; notify(); app.console.dim(`loaded ${f.name} (${f.size} B)`); fileIn.value = ''; });
  const why = blocker(app);
  const mine = Array.isArray(kManifest?.images) ? kManifest.images.filter(im => im.board === b.id && (!im.template || im.template === app.templateId)) : [];
  const tiers = mine.length ? h('div.tools', {}, ...mine.map(im => h('button.btn', { disabled: state.fetching || state.busy, onclick: () => fetchKitsuneImage(app, im) }, state.fetching ? 'Fetching…' : `Get ${im.tier ? im.tier + ' ' : ''}${im.template || ''}${im.band === '5' ? ' 5 GHz' : ''}${im.mode && im.template !== 'wifi-ap' && im.template !== 'wifi-client' ? ' (' + im.mode + ')' : ''}`)),
    h('span.hint', {}, `built from kitsune at ${(kManifest.commit || '?').slice(0, 7)}; checked against the manifest's sha256 before it can be flashed.`)) : null;
  return h('div.card', {}, h('h3', {}, 'Firmware ', imageBadge()),
    h('p.hint', {}, h('b', {}, 'Bootloader: '), hw.flash?.bootloader_instructions || '', ' The flasher checks that the port\'s chip is an ', h('code', {}, b.flash.chip), ' before it erases anything.'),
    kManifest === null ? h('p.hint', {}, 'looking for hosted images…')
      : kManifest === false ? h('p.hint', {}, h('b', {}, 'No kitsune images are hosted on this site. '), 'They will be built in CI from a pinned commit of kitsune once that is agreed with the project (docs/kitsune-integration-plan.md §7); until then, build it yourself with PlatformIO in a kitsune checkout and load the merged image here.')
      : mine.length ? h('div', {}, h('p.hint', {}, `Images for the ${b.name} and the ${app.template.name}:`), tiers)
      : h('p.hint', {}, `The site's manifest (kitsune at ${(kManifest.commit || '?').slice(0, 7)}) has no image for the ${b.name} × ${app.template.name}.`),
    h('details', {}, h('summary.hint', {}, 'A merged image from your own PlatformIO build'),
      h('p.hint', {}, 'In a kitsune checkout, after ', h('code', {}, `pio run -e <env>`), ' in ', h('code', {}, t.project || 'the project'), ', the pieces are under ', h('code', {}, '.pio/build/<env>/'), ' (bootloader.bin, partitions.bin, firmware.bin, and boot_app0.bin from the framework). Merge them into one file at the board\'s offsets with ', h('code', {}, 'esptool.py --chip ' + (b.flash.chip || 'esp32') + ' merge_bin -o merged.bin …'), ' (PlatformIO prints the exact offsets it flashes with ', h('code', {}, '-v'), '), then load merged.bin here; it is written at ', h('code', {}, b.flash.offset || '0x0'), '.')),
    field('Image', h('div.row', {}, h('button.btn.small', { onclick: () => fileIn.click() }, 'Load merged .bin…'), fileIn, h('span.hint', {}, flasher.image.bytes ? `${flasher.image.name} · ${(flasher.image.bytes.length / 1024).toFixed(0)} kB${flasher.image.source === 'fox-bench-kitsune' ? ' · from this site' : ''}` : 'nothing loaded'))),
    state.fetchError ? h('p.hint.err', {}, state.fetchError) : null,
    flasher.image.info ? h('p.hint.err', {}, `${flasher.image.name} is a CircuitPython image; a kitsune board wants a kitsune build.`) : null,
    h('div.two-col', {},
      check('Erase the whole flash first', state.erase, val => { state.erase = val; notify(); }, 'Recommended for a board coming from other firmware; a merged image covers everything a bare board needs anyway.'),
      field('Speed', select([[921600, '921600 baud'], [460800, '460800 baud (default)'], [230400, '230400 baud'], [115200, '115200 baud (safe)']], state.baud, val => { state.baud = +val; }), 'Drop it if the write fails part way.')),
    h('div.tools', {},
      h('button.btn.primary', { disabled: !!why || !!flasher.image.info, title: why, onclick: () => runFlash(app).catch(() => {}) }, state.busy ? 'Flashing…' : 'Flash'),
      why && !state.busy ? h('span.hint', {}, why) : null),
    ...statusBlock(),
    h('p.hint', {}, 'The fleet log gets a flash row with the chip\'s efuse MAC as the fox\'s UID — the one identity a kitsune fox has until it prints a banner. kitsune belongs to its authors: ', h('a', { href: v?.SOURCE || 'https://github.com/rfhs/kitsune', target: '_blank', rel: 'noopener' }, v?.SOURCE || 'https://github.com/rfhs/kitsune'), '.'));
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

/** UF2 boards (PicoFox): no CircuitPython. Firmware is a .uf2 copied to the bootloader drive: the vendor's (a file you
 * load) or fox-bench's own (fetched from this site for foxlib-c targets). The same card restores the vendor firmware. */
let uf2 = { name: '', bytes: null, busy: false, last: null, source: '', fetching: false, touching: false, forBoard: '', sha256: '', build: null };
/** Fingerprint of the hosted fox-bench UF2 (foxbench-picofox.json written by CI beside the file): version, commit,
 * compiler, sha256. null until fetched; false when the site has none (a local checkout without a CI build). */
let buildInfo;
async function loadBuildInfo(app) {
  if (buildInfo !== undefined || !app.board.firmware?.build_info) return buildInfo;
  buildInfo = null;
  try { const r = await fetch(app.board.firmware.build_info, { cache: 'no-cache' }); buildInfo = r.ok ? await r.json() : false; } catch { buildInfo = false; }
  notify(); return buildInfo;
}
/** A loaded image belongs to the target it was loaded for: switching targets forgets it, so the vendor target can never
 * flash the fox-bench image by accident (or the other way round). */
function uf2For(app) { if (uf2.forBoard !== app.boardId) uf2 = { ...uf2, name: '', bytes: null, last: null, source: '', forBoard: app.boardId }; return uf2; }
/** Fetch an image and check it before it can be copied: UF2 structure, RP2040 family id, and — when the descriptor or
 * the site's build info pins one — size and sha256. expect: { sha256?, size? }. A failed check leaves nothing loaded. */
async function fetchImage(app, url, source, label, expect = {}) {
  uf2.fetching = true; uf2.last = null; notify();
  try {
    let r;
    try { r = await fetch(url, { cache: 'no-cache' }); }
    catch (e) { throw new Error(`could not reach ${new URL(url, location.href).host} (offline, or the network blocks it): download the file yourself and use Load .uf2… — ${e.message || e}`); }
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}` + (source === 'fox-bench' ? ' — the site builds this file in CI; a local checkout has it only after a firmware build' : source.startsWith('vendor') ? ' — the vendor\'s file moved or was removed at the pinned commit; see boards/picofox-vendor.json' : ''));
    const bytes = new Uint8Array(await r.arrayBuffer());
    const chk = await checkImage(bytes, expect);
    if (!chk.ok) throw new Error(`${url.split('/').pop()} rejected: ${chk.problems.join('; ')}` + (expect.sha256 ? (source === 'fox-bench' ? ' (the site may be mid-deploy: reload the page and try again)' : ' (the vendor\'s file differs from the one this page was checked against; nothing was loaded)') : ''));
    uf2 = { ...uf2, name: url.split('/').pop(), bytes, source, last: null, forBoard: app.boardId, sha256: chk.sha256, version: source === 'fox-bench' ? foxlibcVersionIn(bytes) : null };
    app.console.dim(`fetched ${uf2.name} (${(bytes.length / 1024).toFixed(0)} kB, ${chk.blocks} blocks, RP2040, sha256 ${chk.sha256.slice(0, 12)}…${expect.sha256 ? ' = pinned' : ''}) — ${label}`);
  } catch (e) { uf2.last = { ok: false, text: String(e.message || e) }; app.console.err('firmware fetch failed: ' + uf2.last.text); }
  uf2.fetching = false; notify();
}
async function fetchHosted(app) {
  const bi = await loadBuildInfo(app);
  return fetchImage(app, app.board.firmware?.image, 'fox-bench', `fox-bench firmware ${bi?.version ? 'c-' + bi.version : ''} built from this site\'s source${bi?.commit ? ' at ' + bi.commit.slice(0, 7) : ''}`, bi ? { sha256: bi.sha256, size: bi.size } : {});
}
/** The Arduino "1200-baud touch": open the board's serial port at 1200 baud, drop DTR, close. Firmware built on the
 * Arduino RP2040 core (the PicoFox vendor's) and fox-bench's own both reboot into the UF2 bootloader on it. The only
 * way into the bootloader on a board whose BOOTSEL is inside the case. */
async function touch1200(app) {
  const b = app.board;
  uf2.touching = true; uf2.last = null; notify();
  try {
    if (!('serial' in navigator)) throw new Error('Web Serial is not available in this browser (Chrome or Edge on a laptop or desktop)');
    if (app.device) { app.console.dim('disconnecting first: the board is about to reboot, and an open drive or console from before a reboot is stale afterwards'); await app.disconnect(); }
    const port = await navigator.serial.requestPort();
    // Is this the fox's port? The hardware descriptor lists its USB ids; a USB-serial adapter or another board picked
    // by mistake takes the touch quietly and nothing reboots.
    const info = port.getInfo?.() || {}, ids = (b.usb || []).map(u => [parseInt(u.vid, 16), parseInt(u.pid, 16)]);
    const idText = info.usbVendorId != null ? `${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId || 0).toString(16).padStart(4, '0')}` : 'unknown ids';
    const known = ids.length && info.usbVendorId != null ? ids.some(([v, pd]) => v === info.usbVendorId && pd === info.usbProductId) : null;
    if (known === false) app.console.err(`the port picked is USB ${idText}, not one of the ${b.name}'s (${(b.usb || []).map(u => `${u.vid.slice(2)}:${u.pid.slice(2)}`).join(', ')}) — the touch is being sent to it anyway, but it is probably another device`);
    else app.console.dim(`touching port USB ${idText}${known ? ` (a ${b.name})` : ''} at 1200 baud`);
    await port.open({ baudRate: 1200 });
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); await new Promise(r => setTimeout(r, 100)); await port.setSignals({ dataTerminalReady: false, requestToSend: false }); await new Promise(r => setTimeout(r, 100)); } catch (e) { app.console.err('could not drive DTR on the port: ' + (e.message || e)); }
    try { await port.close(); } catch {}
    // Did it take? A board that rebooted into the bootloader drops off the bus: its port is no longer connected.
    let gone = null;
    if ('connected' in port) { for (let i = 0; i < 16 && port.connected; i++) await new Promise(r => setTimeout(r, 250)); gone = !port.connected; }
    if (gone === false) {
      uf2.last = { ok: false, text: `1200-baud touch sent, but the port is still there after 4 s: the board did not reboot. ${known === false ? 'The port picked was not the fox\'s — try again and choose the PicoFox\'s port (Device Manager shows which COM number has VID 2E8A).' : 'Try once more (Windows sometimes leaves DTR as it was); if it still stays, Listen only and type bootsel, which does the same from the console; the BOOTSEL button (SW2, inside the case) is the last resort.'}` };
      app.console.err(uf2.last.text);
    } else {
      uf2.last = { ok: true, text: `1200-baud touch sent${gone ? ' and the port went away' : ''}. A ${b.flash.drive_name} drive appears within a few seconds — then Copy below and pick that drive. If nothing appears, the firmware on the board does not answer the touch; the BOOTSEL button (SW2, inside the case) is the fallback.` };
      app.console.line(`1200-baud touch sent${gone ? ', port gone' : ''} — look for the ${b.flash.drive_name} drive`, 'ok');
    }
  } catch (e) { if (e.name !== 'NotFoundError') { uf2.last = { ok: false, text: 'bootloader touch failed: ' + String(e.message || e) }; app.console.err(uf2.last.text); } }
  uf2.touching = false; notify();
}
function uf2Card(app) {
  const b = app.board, ours = b.family === 'foxlib-c';
  uf2For(app);
  const fileIn = h('input', { type: 'file', accept: '.uf2', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return; fileIn.value = '';
    const bytes = new Uint8Array(await f.arrayBuffer()); const chk = await checkImage(bytes);
    if (!chk.ok) { uf2 = { ...uf2, name: '', bytes: null, source: '', last: { ok: false, text: `${f.name} rejected: ${chk.problems.join('; ')}` }, forBoard: app.boardId }; notify(); return; }
    const version = app.family === 'foxlib-c' ? foxlibcVersionIn(bytes) : null;
    uf2 = { ...uf2, name: f.name, bytes, source: 'file', last: null, forBoard: app.boardId, sha256: chk.sha256, version }; app.console.dim(`loaded ${f.name} (${chk.blocks} blocks, RP2040, sha256 ${chk.sha256.slice(0, 12)}…${app.family === 'foxlib-c' ? ', ' + (version ? 'foxlib-c ' + version : 'no version tag: a fox-bench build before 0.1.9, or not fox-bench firmware') : ''})`);
    if (app.family === 'foxlib-c' && app.catalog.foxlibcVersion && (!version || cmpVersion(version, app.catalog.foxlibcVersion) < 0)) app.console.err(`${f.name} is ${version ? 'foxlib-c ' + version : 'an untagged build'}; this site builds ${app.catalog.foxlibcVersion} — an old download? "Get fox-bench firmware" fetches the current one.`);
    notify();
  });
  if (ours) loadBuildInfo(app);
  const copy = async () => {
    uf2.busy = true; uf2.last = null; notify();
    try {
      if (!('showDirectoryPicker' in window)) throw new Error('this browser cannot open a drive folder (Chrome or Edge needed)');
      const dir = await window.showDirectoryPicker({ id: 'fox-bench-uf2', mode: 'readwrite' });
      // The RP2040 bootloader drive holds exactly INFO_UF2.TXT and INDEX.HTM. Its name is no use (a Windows drive root
      // is called "\"), and a .uf2 copied onto any other drive — the fox's own FOXBENCH/PicoFox volume, say — is just a
      // file: the board keeps running what it ran. So the folder is checked by content, not by name.
      const names = []; for await (const e of dir.values()) names.push(e.name.toUpperCase());
      const isBootloader = names.includes('INFO_UF2.TXT');
      if (!isBootloader) {
        const looksLikeFox = names.some(n => ['FOX.JSON', 'SETTINGS.TXT', 'AUDIO.WAV', 'DEFAULTS.JSON'].includes(n));
        throw new Error(`that folder is not the ${b.flash.drive_name} bootloader drive (no INFO_UF2.TXT; it holds ${names.filter(n => !n.startsWith('.') && n !== 'SYSTEM VOLUME INFORMATION').slice(0, 5).join(', ') || 'nothing'})${looksLikeFox ? ' — it is the fox\'s own drive, where a .uf2 would only sit as a file' : ''}. ${b.flash.bootloader_instructions} Then pick that drive.`);
      }
      let info = ''; try { info = await (await (await dir.getFileHandle('INFO_UF2.TXT')).getFile()).text(); } catch {}
      if (info && !/RP2040|RPI-RP2/i.test(info)) throw new Error(`the bootloader drive says "${info.split('\n')[0].trim()}", not an RP2040 — wrong board?`);
      // The RP2040 bootloader flashes blocks as they arrive and reboots when the last one lands — often before the
      // browser's close()/rename has finished, which then throws (NotFound/InvalidState) on a copy that succeeded.
      // So: write, then try to close, and let the "did the drive go away" check below be the verdict either way.
      const h2 = await dir.getFileHandle(uf2.name, { create: true }); const w = await h2.createWritable(); await w.write(uf2.bytes);
      let closeErr = null; try { await w.close(); } catch (e) { closeErr = e; }
      app.console.line(`UF2 ${uf2.name} written to the bootloader drive${closeErr ? ` (close() said "${closeErr.message || closeErr}" — expected when the board reboots mid-write)` : ''} — waiting for the board to reboot`, 'dim');
      // Verify: the bootloader drive must go away (the board rebooted into the new firmware). Listing it should fail.
      let gone = false;
      for (let i = 0; i < 12 && !gone; i++) { await new Promise(r => setTimeout(r, 500)); try { for await (const _ of dir.values()) { void _; break; } } catch { gone = true; } }
      const after = uf2.source === 'fox-bench' ? ' The fox\'s drive and a serial port come back; Listen only prints the FOX banner. (The drive keeps the name it was formatted with — PicoFox if the vendor firmware made it — the files on it are what changed.)'
        : uf2.source === 'vendor' ? ' The fox\'s drive and a serial port come back; Listen only shows "Revision: N … si5351 setup complete" after a power cycle. Select the "(vendor firmware)" target to write its files.'
        : uf2.source === 'vendor-recovery' ? ' THIS IMAGE REFORMATS THE DRIVE AT EVERY BOOT: do not write files yet. Flash pfoxr3v1.uf2 next (Reboot into bootloader → Copy), and only then write the four files and power-cycle.' : '';
      uf2.last = gone
        ? { ok: true, text: `${uf2.name} flashed (${(uf2.bytes.length / 1024).toFixed(0)} kB): the ${b.flash.drive_name} drive went away, so the board rebooted into it.${after}` }
        : { ok: false, text: `${uf2.name} was written but the ${b.flash.drive_name} drive is still there after 6 s — the bootloader did not accept it${closeErr ? ` and the copy itself failed (${closeErr.message || closeErr})` : ''}. A .uf2 for another chip, or a copy that did not complete; try again.` };
      app.console.line(uf2.last.text, gone ? 'ok' : 'err');
      if (gone && app.device) { await app.disconnect(); app.console.dim(`the board rebooted: open its drive again (${app.usesDrive ? 'Open ' + (b.drive?.label || 'drive') : 'Connect'} in the top bar) before writing files`); }
      fleet.append({ board_number: '', uid: '', board: b.id, action: 'flash', template: '', profile: '', callsign: '', freq: '', power: '', seed: '', result: gone ? 'ok' : 'not accepted', notes: uf2.name + ' (uf2' + (uf2.source === 'fox-bench' ? ', fox-bench firmware' : '') + ')' });
    } catch (e) { if (e.name !== 'AbortError' && e.message !== 'cancelled') { uf2.last = { ok: false, text: String(e.message || e) }; app.console.err('UF2 copy failed: ' + uf2.last.text); } }
    uf2.busy = false; notify(); app.changed('flash');
  };
  return h('div.card', {}, h('h3', {}, 'Firmware ', badge('no CircuitPython', 'warn')),
    h('p.hint', {}, h('b', {}, `This fox board does not run CircuitPython.`), ' ', b.firmware?.note || ''),
    h('p.hint', {}, h('b', {}, 'Bootloader: '), b.flash.bootloader_instructions, ' Firmware is a .uf2 file copied onto that drive; the board reboots when the copy finishes.', b.firmware?.stock_firmware_url ? [' The vendor\'s releases are at ', h('a', { href: b.firmware.stock_firmware_url, target: '_blank', rel: 'noopener' }, 'their GitHub'), '.'] : null),
    h('p.hint', {}, h('b', {}, 'Order: '), 'fox on, plugged in → ', h('b', {}, '1. Reboot into bootloader'), ' (pick the fox\'s serial port) → a drive with just ', h('code', {}, 'INFO_UF2.TXT'), ' and ', h('code', {}, 'INDEX.HTM'), ' appears → ', h('b', {}, '2. Copy'), ' and pick ', h('i', {}, 'that'), ' drive. The page checks for INFO_UF2.TXT, because a .uf2 copied onto the fox\'s own drive is only a file and the board keeps running what it ran.'),
    b.flash.touch_1200 ? h('div.tools', {}, h('button.btn', { disabled: uf2.touching || uf2.busy, onclick: () => touch1200(app) }, uf2.touching ? 'Touching…' : '1. Reboot into bootloader'), h('span.hint', {}, 'Opens the serial port at 1200 baud and closes it: the Arduino way into the bootloader, no button needed.')) : null,
    ours ? h('div.tools', {}, h('button.btn', { disabled: uf2.fetching || uf2.busy, onclick: () => fetchHosted(app) }, uf2.fetching ? 'Fetching…' : 'Get fox-bench firmware'), h('span.hint', {}, `foxbench-picofox.uf2 built from this site\'s source (firmware/foxlib-c/picofox). To go back to the vendor firmware, select the "(vendor firmware)" target: its card fetches the vendor\'s .uf2.`)) : null,
    ours ? h('p.hint', {}, h('b', {}, 'Hosted build: '), buildInfo ? [h('code', {}, `c-${buildInfo.version}`), ` · commit ${(buildInfo.commit || '').slice(0, 7)} · ${buildInfo.gcc || '?'} · pico-sdk ${(buildInfo.pico_sdk || '').slice(0, 7)} · sha256 ${(buildInfo.sha256 || '').slice(0, 12)}… · ${buildInfo.built || ''}`, ' — a fetched image must match this fingerprint before it can be copied.'] : buildInfo === false ? 'no build info on this site (a local checkout, or an older deploy): the image is checked as a UF2 for the RP2040 only.' : 'loading…') : null,
    !ours && b.firmware?.stock_firmware_files?.length ? h('div', {},
      ...b.firmware.stock_firmware_files.filter(f => !f.recovery).map(f => h('div.tools', {}, h('button.btn', { disabled: uf2.fetching || uf2.busy, onclick: () => fetchImage(app, f.url, 'vendor', f.note, { sha256: f.sha256, size: f.size }) }, uf2.fetching ? 'Fetching…' : `Get ${f.name}`), h('span.hint', {}, f.note, ` — fetched from the vendor\'s GitHub into this browser${b.firmware.stock_firmware_pinned_commit ? ` at commit ${b.firmware.stock_firmware_pinned_commit.slice(0, 7)} and checked against sha256 ${(f.sha256 || '').slice(0, 12)}…` : ''}.`))),
      ...b.firmware.stock_firmware_files.filter(f => f.recovery).map(f => h('details', { style: 'margin-top:6px' }, h('summary.hint', {}, 'Recovery image (wipes the drive)'), h('div.tools', {}, h('button.btn.small.danger', { disabled: uf2.fetching || uf2.busy, onclick: () => fetchImage(app, f.url, 'vendor-recovery', f.note, { sha256: f.sha256, size: f.size }) }, uf2.fetching ? 'Fetching…' : `Get ${f.name}`), h('span.hint.warn', {}, f.note))))) : null,
    h('div.tools', {}, h('button.btn.small', { onclick: () => fileIn.click() }, 'Load .uf2…'), fileIn, h('span.hint', {}, uf2.name ? `${uf2.name} · ${(uf2.bytes.length / 1024).toFixed(0)} kB${uf2.source === 'fox-bench' ? ' · fox-bench firmware' : ''}${uf2.version ? ' · foxlib-c ' + uf2.version : uf2.source === 'file' && app.family === 'foxlib-c' ? ' · no version tag' : ''}${uf2.sha256 ? ' · sha256 ' + uf2.sha256.slice(0, 12) + '…' : ''}` : 'nothing loaded'),
      uf2.bytes && app.family === 'foxlib-c' && app.catalog.foxlibcVersion && (!uf2.version || cmpVersion(uf2.version, app.catalog.foxlibcVersion) < 0) ? badge(uf2.version ? `older than this site's ${app.catalog.foxlibcVersion}` : 'untagged build', 'warn') : null,
      h('button.btn' + (uf2.source === 'fox-bench' || uf2.source === 'vendor' ? '.primary' : uf2.source === 'vendor-recovery' ? '.danger' : ''), { disabled: !uf2.bytes || uf2.busy, onclick: copy }, uf2.busy ? 'Copying…' : `2. Copy to ${b.flash.drive_name}…`)),
    uf2.last ? h('p.hint' + (uf2.last.ok ? '.ok' : '.err'), {}, uf2.last.text) : null,
    ours ? h('p.hint', {}, 'Running fox-bench firmware and Listening? ', h('code', {}, 'bootsel'), ' in the console (or the button on the Board tab) does the same as the touch.') : h('p.hint', {}, 'Want fox-bench\'s own firmware on this board instead (fox.json, the same templates as the CircuitPython foxes, bench over serial)? Pick the "(fox-bench firmware)" entry of this board above.'),
    h('p.hint', {}, 'There is no "flash CircuitPython" here on purpose; the batch-flashing card on the Fleet tab is for the ESP32 family.'));
}
