// deploy.js — Deploy tab: diff, keydown limit, antenna gate, write set, reboot, banner.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, numInput, check, select } from './dom.js';
import { loadTemplateCode, loadFoxlibFile, loadMpyFile, loadRootFile } from '../model/loaders.js';
import { issueItem } from './issues.js';

const BOOT_MARK = 'fox-bench boot.py';      // firmware/boot.py's first comment: a boot.py with it is ours to rewrite
/** Precompiled foxlib wanted and available for this board (the Deploy checkbox; off when the site has no set for
 *  the board's CircuitPython major, or the set is another foxlib version). */
function wantMpy() { return !!app.deployRecovery.mpy && !!app.mpySetFor(app.info?.cpVersion).set; }
/** A foxlib file to write: the .mpy of the board's major, or the source. */
function loadLib(name) { return name.endsWith('.mpy') ? loadMpyFile(app.mpySetFor(app.info?.cpVersion).major, name) : loadFoxlibFile(name); }
const TRACE_MARK = '# fox-bench: trace the boot';   // the settings.toml Deploy writes for a boot trace (network foxes); ours to remove
const TRACE_TOML = TRACE_MARK + ' (foxlib/netfox.py prints every init step before the banner). Remove this file, or untick "Trace the boot" on Deploy, to stop it.\nFOX_TRACE = 1\n';
import { parseBanner } from '../device/device.js';
import { airtime, fmtDuration } from '../model/airtime.js';
import { packImages } from '../audio/sstv.js';
import { fleet, download } from '../model/profiles.js';
import { firmwareText } from '../model/audit.js';
import { onAir } from '../model/sheet.js';
import { profiles } from '../model/profiles.js';
import { PLACEHOLDERS } from '../model/handoff.js';
import { makeZip } from '../model/zip.js';
import * as drive from './deploy-drive.js';
import * as foxlibc from './deploy-foxlibc.js';
import * as consoleFox from './deploy-console.js';

let app, root, gateOk = false, lastResult = null, busy = false;
// Set the board clock at deploy: CircuitPython boots at 2000-01-01, and a network fox's timed start (stealth.start.at)
// needs real time. Source: the browser's clock now, or a fixed time so every fox of a fleet is given the same one.
// Persisted in this browser, so it is a fleet setting: tick it once, deploy fox after fox.
const CLOCK_KEY = 'fox-bench.deployClock';
const RECOVERY_KEY = 'fox-bench.deployRecovery';          // whether safemode.py goes onto the board (a browser setting, remembered)
function loadRecovery() { try { return { safemode: true, ...JSON.parse(localStorage.getItem(RECOVERY_KEY) || '{}') }; } catch { return { safemode: true }; } }
function saveRecovery(r) { try { localStorage.setItem(RECOVERY_KEY, JSON.stringify(r)); } catch {} }
/** safemode.py is written when the browser setting says so and, on an FM fox, recovery is not switched off on Behavior. */
const wantSafemode = () => app.deployRecovery.safemode && !(app.cfg.limits && app.cfg.limits.recover === false);
function recoveryRow() {
  const r = app.deployRecovery, fmOff = app.cfg.limits && app.cfg.limits.recover === false;
  return h('div.row', { style: 'flex-wrap:wrap;gap:6px 12px;align-items:center;margin:6px 0' },
    check('Write safemode.py', r.safemode, v => { Object.assign(r, { safemode: v }); saveRecovery(r); app.changed('deploy'); },
      'the recovery file beside code.py (~2 KB): resets the board out of safe mode after a brownout or a watchdog reset'),
    fmOff ? h('span.hint', {}, 'not written: recovery is off on the Behavior tab') : !r.safemode ? h('span.hint.warn', {},
      'off: a browned-out board stays in safe mode, silent, until it is power-cycled') : null,
    app.isNet ? check('Trace the boot', !!r.trace, v => { Object.assign(r, { trace: v }); saveRecovery(r); app.changed('deploy'); },
      'writes settings.toml with FOX_TRACE = 1: the fox prints every step of its start (with the free memory) before the banner, so a board that hangs on the way up shows where. Untick to remove the file again.') : null,
    app.isNet && r.trace ? h('span.hint', {}, 'on: "init: …" lines before the banner; the fox runs as usual') : null,
    mpyRow(r));
}

/** Precompiled (.mpy): foxlib as bytecode instead of source. The board skips the compile — whose peak heap is several
 *  times the source and was more than the ESP32-C3 had beside its radio stacks — and the modules take less room on
 *  flash and in RAM. Needs a set for the board's CircuitPython major (tools/build_mpy.py, firmware/mpy/). */
function mpyRow(r) {
  const m = app.mpySetFor(app.info?.cpVersion);
  const on = !!r.mpy && !!m.set;
  return h('div', {},
    check('Precompiled (.mpy)', on, v => { Object.assign(r, { mpy: v }); saveRecovery(r); app.changed('deploy'); },
      m.set ? `foxlib ${m.set.foxlib} as bytecode built with CircuitPython ${m.set.circuitpython}'s mpy-cross: no compile on the board (that peak is what the ESP32-C3 ran out of), about a third of the source size. Untick to write the sources again; either way the other form is removed as stale.` : m.why, { disabled: !m.set }),
    on ? h('span.hint', {}, `on: the ${m.major}.x set; the board imports .mpy (a .py beside one would win, so none is left)`) : null);   // without a set the checkbox's own text is the reason (it was shown twice until 0.18.25)
}
function loadClock() { try { return { enabled: false, source: 'browser', fixed: '', ...JSON.parse(localStorage.getItem(CLOCK_KEY) || '{}') }; } catch { return { enabled: false, source: 'browser', fixed: '' }; } }
function saveClock(c) { try { localStorage.setItem(CLOCK_KEY, JSON.stringify(c)); } catch {} }
/** The time to set, as a struct_time tuple (local wall time of the browser, or the fixed field), or null. */
export function clockToSet() {
  const c = app.deployClock; if (!c?.enabled) return null;
  const d = c.source === 'fixed' ? new Date(c.fixed) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
}
const setLast = r => { lastResult = r; app.lastDeploy = r ? {...r, at: new Date().toISOString(), template: app.templateId,
  uid: app.info?.uid} : null; };
export function init(a, el) { app = a; root = el; app.deployClock = loadClock(); app.deployRecovery = loadRecovery(); app.setDeployClock = patch => { Object.assign(app.deployClock, patch); saveClock(app.deployClock); app.changed('deploy'); }; drive.init(a); foxlibc.init(a); consoleFox.init(a); app.listeners.add(render); render(); }

/** The clock control (Deploy card): on, and from where. Changing it re-runs the page checks (stealth.start.at wants it on). */
function clockRow() {
  const c = app.deployClock;
  const set = patch => { Object.assign(c, patch); saveClock(c); app.changed('deploy'); };
  const fixed = h('input', { type: 'datetime-local', value: c.fixed, step: 1, disabled: c.source !== 'fixed', style: 'margin-left:6px' }); fixed.addEventListener('change', () => set({ fixed: fixed.value }));
  return h('div.row', { style: 'flex-wrap:wrap;gap:6px 12px;align-items:center;margin:6px 0' },
    check('Set the board clock', c.enabled, v => set({ enabled: v }), 'CircuitPython boots at 2000-01-01; a timed start needs real time'),
    c.enabled ? h('label.row', {},
      h('select', { onchange: e => set({ source: e.target.value }) },
        h('option', { value: 'browser', selected: c.source === 'browser' }, 'this browser\'s time, now'),
        h('option', { value: 'fixed', selected: c.source === 'fixed' }, 'a fixed time (every fox of the fleet gets the same)')),
      fixed) : null,
    c.enabled && c.source === 'fixed' && !clockToSet() ? h('span.hint.err', {}, 'enter a date and time') : null,
    c.enabled && app.device && !app.device.setClock ? h('span.hint.warn', {}, 'this device cannot set the clock') : null);
}

/** Flatten a config to dotted key → JSON value for diffing. */
/** The fleet section of fox.json: bookkeeping the firmware ignores and the fleet log / event sheet carry. */
function fleetRecordCard() {
  const f = app.cfg.fleet || (app.cfg.fleet = {});
  const txt = (key, attrs = {}) => { const i = h('input', { type: 'text', value: f[key] ?? '', style: 'width:100%', ...attrs }); i.addEventListener('change', () => { f[key] = i.value.trim(); app.changed('deploy'); }); return i; };
  return h('div.card', {}, h('h3', {}, 'Fleet record'),
    h('p.hint', {}, 'Written into fox.json (', h('code', {}, 'fleet'),
      ') and onto every fleet-log row this deploy makes; the Event sheet (Fleet tab) is built from them. The firmware ignores all of it.'),
    h('div.two-col', {},
      field('Fox number',
        numInput(f.number ?? '',
          { min: 1, max: 999, step: 1, width: '100px', onchange: v => { f.number = Math.round(v); app.changed('deploy'); } }),
        'the # on the sheet and the fleet log'),
      field('Event', txt('event', { placeholder: 'Spring hunt 2027', maxlength: 64 }),
        'filters the Event sheet; one name for the whole fleet')),
    h('div.two-col', {},
      field('Operator', txt('owner', { placeholder: 'W1ABC', maxlength: 32, style: 'width:100%;text-transform:uppercase' }),
        'whose fox this is when the callsign is not theirs; never on the air'),
      field('Notes', txt('notes', { maxlength: 120 }), 'free text for the sheet')),
    pointsToField(f));
}

/** Phase J: the fox this one leads to, and what its placeholders will say. */
function pointsToField(f) {
  const others = profiles.all().filter(p => p.cfg && (p.cfg.fleet?.number != null && p.cfg.fleet.number !== '' || p.name) && p.name !== app.cfg.fleet?.profile);
  const opt = p => { const n = p.cfg.fleet?.number; return [n != null && n !== '' ? String(n) : p.name,
    (n != null && n !== '' ? `#${n} ` : '') + p.name]; };
  const cur = f.points_to == null ? '' : String(f.points_to);
  const known = others.some(p => opt(p)[0] === cur);
  const h2 = app.handoff;
  const vals = h2?.target ? Object.entries(h2.values).map(([k, v]) => `{{to.${k}}} → ${v}`).join(' · ') : '';
  return field('Points to', h('div', {},
    select([['', 'nothing'], ...others.map(opt), ...(cur && !known ? [[cur, `${cur} (not a saved profile)`]] : [])], cur,
      v => { if (v === '') delete f.points_to; else f.points_to = /^\d+$/.test(v) ? Number(v) : v; app.changed('deploy'); }),
    h('p.hint', {}, cur ? (h2?.target ? `Text anywhere in this fox may use ${vals || 'its placeholders'}; filled in at deploy, the editor keeps the placeholders.` : 'No saved profile has that number or name: save the other fox as a profile first.')
      : `The fox this one leads to (a saved profile, by fox number). Then any text — portal body, a beacon name, the Morse message — may say ${PLACEHOLDERS.map(k => '{{to.' + k + '}}').join(', ')}; the sheet prints the chain.`)));
}

/** The fleet-log 'freq' and 'power' columns: the FM plan, or for a network fox its kind (and channel) and radio power. */
const freqText = cfg => app.isNet ? `${cfg.net.kind}${cfg.net.kind === 'wifi-ap' ? ' ch' + cfg.net.channel : ''}` : cfg.plan.frequencies_mhz.join(' ');
const powerText = cfg => app.isNet ? `${cfg.net.tx_power_dbm}dBm` : `${cfg.radio.high_power ? 'high' : 'low'}${cfg.radio.power_dbm != null ? ' ' + cfg.radio.power_dbm + 'dBm' : ''}`;
function flat(o, pre = '', out = {}) { for (const [k, v] of Object.entries(o || {})) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = JSON.stringify(v); } return out; }

function plan() {
  const files = [];
  const ob = app.onBoard, cfg = app.validCfg || app.cfg;
  // foxlib: the files this template needs (firmware/index.json's sets, from the import graph); judged against the
  // selected template, not the board's — switching families on a board means the other family's modules
  const mpy = wantMpy();
  const need = app.foxlibFilesFor(app.templateId, mpy), missing = app.connected ? app.foxlibMissingFor(app.templateId, undefined, mpy) : need, stale = app.connected ? app.foxlibStaleFor(app.templateId, undefined, mpy) : [];
  const fwNeeded = !app.connected || ob.foxlibVersion !== app.catalog.foxlibVersion || missing.length > 0;
  const setName = `${app.catalog.templateSets[app.templateId] ? ` (${app.catalog.templateSets[app.templateId]} set, ${need.length} files` : ' ('}${mpy ? ', precompiled .mpy)' : app.catalog.templateSets[app.templateId] ? ')' : 'sources)'}`;
  if (fwNeeded) files.push({path: 'foxlib/*',
    why: ob.foxlibVersion && ob.foxlibVersion === app.catalog.foxlibVersion ? `foxlib ${ob.foxlibVersion} on the board lacks ${missing.length} file${missing.length === 1 ? '' : 's'} ${app.templateId} needs (${missing.join(', ')})${setName}` : ob.foxlibVersion ? `foxlib ${ob.foxlibVersion} → ${app.catalog.foxlibVersion}${setName}` : `install foxlib ${app.catalog.foxlibVersion}${setName}`,
    kind: 'foxlib'});
  if (stale.length) files.push({path: 'foxlib/' + (stale.length === 1 ? stale[0] : `{${stale.join(',')}}`),
    why: stale.some(n => mpy ? n.endsWith('.py') : n.endsWith('.mpy')) ? `removed: ${mpy ? 'the sources: the board imports the .mpy set, and a .py beside one would win' : 'the precompiled .mpy: the sources are written instead'}${stale.some(n => mpy ? !n.endsWith('.py') : !n.endsWith('.mpy')) ? ', and modules this template does not use' : ''}` : `removed: ${app.templateId} does not use ${stale.length === 1 ? 'it' : 'them'} (${app.catalog.templateSets[app.templateId] || 'all'} set)`,
    kind: 'stale', names: stale});
  for (const name of app.catalog.rootFiles) {
    if (wantSafemode()) { if (fwNeeded || (app.connected && !ob.files?.[name])) files.push({path: name,
      why: 'with foxlib: resets the board out of safe mode after a brownout or watchdog reset', kind: 'root'}); }
    else if (app.connected && ob.files?.[name]) files.push({ path: name, why: 'removed: the recovery file is switched off', kind: 'remove' });
  }
  if (app.isNet && app.deployRecovery.trace) files.push({ path: 'settings.toml', why: 'trace the boot: FOX_TRACE = 1', kind: 'trace' });
  else if (app.isNet && app.connected && ob.files?.['settings.toml']) files.push({path: 'settings.toml',
    why: 'removed if it is the boot trace Deploy wrote (any other settings.toml is left alone)', kind: 'trace-off'});
  if (!app.connected || ob.template !== app.templateId || fwNeeded) files.push({path: 'code.py',
    why: ob.template && ob.template !== app.templateId ? `${ob.template} → ${app.templateId}` : `${app.templateId} ${app.template.version}`,
    kind: 'code'});
  files.push({ path: 'defaults.json', why: `${app.templateId} defaults for ${app.boardId}`, kind: 'defaults' });
  files.push({ path: 'fox.json', why: 'configuration', kind: 'cfg' });
  if (cfg.payload?.kind === 'sstv') files.push({path: cfg.payload.images_file,
    why: app.images.length ? `${app.images.length} image${app.images.length === 1 ? '' : 's'}` : 'no images — firmware will use its test card',
    kind: 'images'});
  const a = flat(ob.cfg || {}), b = flat(cfg), changes = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k] && !k.startsWith('fleet.')) changes.push({ key: k, from: a[k], to: b[k] });
  return { files, changes };
}

/** The complete deploy set as a zip: what Deploy would write, laid out as the board root. */
async function exportZip() {
  try { await _exportZip(); }
  catch (e) { const msg = 'export failed: ' + (e.message || e); app.console.err(msg); alert(msg + '\n\nIf this is an HTTP 404 for a firmware file, the site is missing its .nojekyll marker (GitHub Pages drops files whose names start with an underscore).'); }
}
async function _exportZip() {
  const overrides = app.issues.filter(e => e.level === 'err' && e.blocking === false);
  if (overrides.length && !confirm(`Export anyway?\n\n${overrides.map(o => '• ' + o.msg.replace(/ — .*$/, '')).join('\n')}`)) return;
  const cfg = app.validCfg, files = [];
  for (const name of app.foxlibFilesFor(app.templateId, wantMpy())) files.push({ path: 'foxlib/' + name, data: await loadLib(name) });
  if (wantSafemode()) for (const name of app.catalog.rootFiles) files.push({ path: name, data: await loadRootFile(name) });
  if (app.isNet && app.deployRecovery.trace) files.push({ path: 'settings.toml', data: TRACE_TOML });
  files.push({ path: 'code.py', data: await loadTemplateCode(app.templateId) });
  files.push({ path: 'defaults.json', data: JSON.stringify(app.defaults) });
  files.push({ path: 'fox.json', data: JSON.stringify(cfg, null, 1) });
  if (cfg.payload?.kind === 'sstv') files.push({ path: cfg.payload.images_file, data: packImages(app.images) });
  files.push({ path: 'README.txt', data: [
    `fox-bench deploy set — ${app.templateId} ${app.template.version}, foxlib ${app.catalog.foxlibVersion}, board ${app.boardId}`,
    `callsign ${cfg.id.callmessage} · ${app.isNet ? freqText(cfg) : cfg.plan.frequencies_mhz.join(', ') + ' MHz'} · exported ${new Date().toISOString()}`,
    '',
    'Copy everything in this zip to the root of the CircuitPython board, keeping the foxlib/ folder:',
    '  code.py  defaults.json  fox.json  foxlib/  ' + (wantSafemode() ? 'safemode.py  ' : '') + (cfg.payload?.kind === 'sstv' ? cfg.payload.images_file : ''),
    ...(wantSafemode() ? ['safemode.py runs only when CircuitPython boots into safe mode (a brownout while keyed, the watchdog): it resets the',
      'board so the fox comes back instead of sitting silent until someone power-cycles it.'] : []),
    'With Thonny: File → Open each file → File → Save As → CircuitPython device, same name and path.',
    'With a board that mounts a CIRCUITPY drive: drag the files onto the drive.',
    'Then reset (Ctrl-D in the REPL, or the R button). The boot log prints a line starting with "FOX" that reports',
    'cfg=ok radio=ok id=set when the fox came up correctly.',
    '',
    'To change the callsign or frequency later you only need to replace fox.json.',
  ].join('\n') });
  const safe = s => s.replace(/[^A-Za-z0-9._-]+/g, '_');
  download(`fox-${safe(cfg.id.callmessage.split(' ')[0])}-${app.templateId}.zip`, makeZip(files));
  fleet.append({board_number: cfg.fleet?.number ?? '', uid: app.info?.uid || '', board: app.boardId, action: 'export-zip',
    template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage,
    owner: cfg.fleet?.owner || '', event: cfg.fleet?.event || '', on_air: onAir(cfg, { template: app.templateId }), freq: freqText(cfg),
    power: powerText(cfg), seed: cfg.schedule?.seed ?? '', result: 'zip', notes: ''});
  app.console.dim(`exported deploy set (${files.length} files)`);
}

async function deploy(btn) {
  if (busy) return;
  const overrides = app.issues.filter(e => e.level === 'err' && e.blocking === false);
  if (overrides.length && !confirm(`Deploy anyway?\n\n${overrides.map(o => '• ' + o.msg.replace(/ — .*$/, '')).join('\n')}\n\nThese are outside the ${app.region} amateur band table. Make sure this is intended (bench testing into a load, a different allocation, etc.).`)) return;
  const d = app.device, cfg = app.validCfg, log = app.console;
  { const why = app.deployBlocker(); if (why) { log.err(`deploy refused: ${why}`); return; } }   // before busy: a refusal must not leave the button at "Writing…"
  busy = true; app.deployBusy = true; setLast(null); render();
  const { files } = plan();
  try {
    await d.interrupt();                       // the fox may be running from a previous deploy or restart
    // a board with a CIRCUITPY drive: its code cannot write until the filesystem is the board's (firmware/boot.py)
    const fs = d.makeWritable ? await d.makeWritable() : 'rw';
    if (fs === 'usb') throw Object.assign(new Error('the board\'s files are read-only to the board: it shows up as a CIRCUITPY drive, and the computer has it'),
      { usbDrive: true });
    if (fs === 'remounted') {
      const have = await d.readText('boot.py');
      if (have == null || have.includes(BOOT_MARK)) { await d.writeBytes('boot.py', await loadRootFile('boot.py')); log.dim('wrote boot.py: from the next reset the board\'s files belong to the board (the CIRCUITPY drive is read-only on the computer)'); }
      else log.err('the board has its own boot.py, left alone: add  import storage; storage.remount("/", readonly=False)  to it, or the next power-up is read-only again');
    }
    const t = clockToSet();
    if (t && d.setClock) { await d.setClock(t); log.dim(`board clock set to ${t[0]}-${String(t[1]).padStart(2, '0')}-${String(t[2]).padStart(2, '0')} ${String(t[3]).padStart(2, '0')}:${String(t[4]).padStart(2, '0')}:${String(t[5]).padStart(2, '0')} (${app.deployClock.source === 'fixed' ? 'fixed time' : 'this browser\'s time'})`); }
    else if (t) log.dim('this device cannot set the board clock; skipped');
    for (const f of files) {
      if (f.kind === 'foxlib') { await d.mkdir('foxlib'); for (const name of app.foxlibFilesFor(app.templateId, wantMpy())) await d.writeBytes('foxlib/' + name, await loadLib(name)); }
      else if (f.kind === 'stale') { for (const name of f.names) await d.remove('foxlib/' + name); log.dim(`removed stale: ${f.names.join(', ')}`); }
      else if (f.kind === 'root') await d.writeBytes(f.path, await loadRootFile(f.path));
      else if (f.kind === 'remove') await d.remove(f.path);
      else if (f.kind === 'trace') { const have = await d.readText('settings.toml'); if (have && !have.includes(TRACE_MARK)) log.err('the board has its own settings.toml, left alone: add  FOX_TRACE = 1  to it for the boot trace'); else await d.writeText('settings.toml', TRACE_TOML); }
      else if (f.kind === 'trace-off') { const have = await d.readText('settings.toml'); if (have && have.includes(TRACE_MARK)) { await d.remove('settings.toml'); log.dim('removed the boot trace (settings.toml)'); } }
      else if (f.kind === 'code') await d.writeText('code.py', await loadTemplateCode(app.templateId));
      else if (f.kind === 'defaults') await d.writeText('defaults.json', JSON.stringify(app.defaults));
      else if (f.kind === 'cfg') await d.writeText('fox.json', JSON.stringify(cfg, null, 1));
      else if (f.kind === 'images') await d.writeBytes(f.path, packImages(app.images));
    }
    const bootLog = await d.reboot();
    const banner = parseBanner(bootLog);
    if (banner) app.lastBanner = banner;
    const failedFeature = /\*\* (\w+) failed to load on this board \(([^)]*)\)/.exec(bootLog || '');   // a contest feature the board could not import
    setLast({ bootLog, banner, failedFeature: failedFeature ? `${failedFeature[1]} (${failedFeature[2]})` : null,
      ok: !!banner && banner.cfg === 'ok' && banner.radio === 'ok' && (banner.id === 'set' || banner.id === 'none') && !failedFeature });   // none: a network fox with no callsign on the air
    const written = Object.fromEntries(files.filter(f => !['remove', 'trace-off', 'stale'].includes(f.kind)).map(f => [f.path.replace('/*', ''), { size: 1, dir: f.kind === 'foxlib' }]));
    const remaining = { ...app.onBoard.files, ...written }; for (const f of files) if (f.kind === 'remove' || f.kind === 'trace-off') delete remaining[f.path];
    const libFiles = Object.fromEntries(app.foxlibFilesFor(app.templateId, wantMpy()).map(n => [n, { size: 1 }]));    // what foxlib/ holds now: the set, nothing else
    app.onBoard = {...app.onBoard, cfg: structuredClone(cfg), raw: JSON.stringify(cfg), template: app.templateId,
      foxlibVersion: app.catalog.foxlibVersion, foxlibComplete: true, foxlibMissing: [], files: remaining, libFiles, mpy: wantMpy()};
    app.info.foxlibVersion = app.catalog.foxlibVersion;
    app.setStatus(`${d.kind === 'demo' ? 'Demo · ' : ''}${app.info.boardId} · uid ${app.info.uid.slice(-6)} · foxlib ${app.catalog.foxlibVersion} · fox running`,
      d.kind === 'demo' ? 'demo' : 'tx');
    fleet.append({board_number: cfg.fleet?.number ?? '', uid: app.info.uid, board: app.info.boardId, action: 'deploy',
      template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage,
      owner: cfg.fleet?.owner || '', event: cfg.fleet?.event || '', on_air: onAir(cfg, { template: app.templateId }), freq: freqText(cfg),
      power: powerText(cfg), seed: cfg.schedule?.seed ?? '',
      result: lastResult.ok ? 'ok' : lastResult.failedFeature ? `failed to load: ${lastResult.failedFeature}` : (banner ? `${banner.cfg} ${banner.radio} ${banner.id}` : 'no banner'),
      firmware: firmwareText(app.catalog.foxlibVersion, app.info?.cpVersion || '') + (wantMpy() ? ' (.mpy)' : ''),
      notes: [app.variantId ? app.board.variantName : '', app.device.kind === 'demo' ? 'demo' : ''].filter(Boolean).join(' · ')});
  } catch (e) {
    setLast({usbDrive: !!e.usbDrive,
      error: String(e.message || e) + (/HTTP 404/.test(e.message || '') ? ' — a firmware file is missing from the site; the repo needs a .nojekyll marker so GitHub Pages serves foxlib/__init__.py' : '')}); log.err(lastResult.error);
    // the board is in an unknown state between what was written and what was not: the next plan must not trust the
    // last read (a foxlib/ half written would otherwise read as current). The next Deploy rewrites the whole set.
    // (not after the read-only-drive stop: nothing was written yet, the board is as it was)
    if (app.onBoard && !e.usbDrive) { app.onBoard = { ...app.onBoard, foxlibVersion: null, foxlibComplete: false, libFiles: {}, template: null }; log.dim('the board\'s state is unknown after this; the next Deploy writes everything (or Re-read board)'); }
  }
  busy = false; app.deployBusy = false; gateOk = false; app.changed('deploy');
}

function render() {
  if (app.family === 'drive') return drive.render(root, render);
  if (app.family === 'foxlib-c' && app.transport === 'console') return consoleFox.render(root, render);
  if (app.family === 'foxlib-c') return foxlibc.render(root, render);
  const cfg = app.cfg, { files, changes } = plan();
  // a network fox has no keydown: its "transmission" is the wake time on the Schedule tab
  const at = app.isNet ? { typical_ms: cfg.schedule.wake_s * 1000, worst_ms: cfg.schedule.wake_s * 1000 } : airtime(cfg, { images: app.images });
  const errs = [...app.report.map(r => ({ level: 'err', key: r.key, msg: r.reason })), ...app.issues];
  const blocking = errs.filter(e => e.level === 'err' && e.blocking !== false);
  const overrides = errs.filter(e => e.level === 'err' && e.blocking === false);
  const transportWhy = app.deployBlocker();
  const ready = !transportWhy && !blocking.length && gateOk && !busy;
  const lim = cfg.limits || {};
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Checks ', blocking.length ? badge(`${blocking.length} blocking`, 'err') : badge('all pass', 'ok')),
        errs.length ? h('ul', { style: 'margin:0;padding-left:1.2em' }, errs.map(e => issueItem(app, e, 'deploy'))) : h('p.hint', {}, 'fox.json validates against CONFIG.md; callsign set; all frequencies in range and in band.'),
        h('p.hint', { style: 'margin-top:8px' }, 'Status the firmware would report: ', h('code', {}, `cfg=${app.status}`),
          '. Blocking: invalid config, unset callsign, missing required pins. Not blocking: frequencies outside the band table (confirmed at deploy).')),
      app.isNet ? h('div.card', {}, h('h3', {}, 'On the air'),
        h('dl.kv', {}, h('dt', {}, 'Each wake'), h('dd', {}, fmtDuration(at.typical_ms)), h('dt', {}, 'Then'),
          h('dd', {},
            cfg.schedule.sleep_s ? `${cfg.schedule.sleep_s} s ${cfg.schedule.sleep === 'deep' ? 'deep sleep' : 'radio off'}` : 'no off time: always on')),
        h('p.hint', {},
          'No Morse, no keydown limit: a Part 15 radio on a duty cycle. The name and MAC on the Radio and ID tabs are what hunters see.'))
      : h('div.card', {}, h('h3', {}, 'Keydown'),
        h('dl.kv', {}, h('dt', {}, 'Typical transmission'), h('dd', {}, fmtDuration(at.typical_ms)), h('dt', {}, 'Worst case'),
          h('dd', {}, fmtDuration(at.worst_ms))),
        field('Keydown limit', h('div.row', {},
          numInput(lim.max_keydown_s ?? '',
            { min: 1, max: 7200, step: 1, width: '120px', onchange: v => { lim.max_keydown_s = v; app.changed('limits'); } }),
          h('span.suffix', {}, 's'),
          h('button.btn.small', { onclick: () => { lim.max_keydown_s = null; app.changed('limits'); } }, 'no limit')),
          lim.max_keydown_s ? `The firmware unkeys at ${lim.max_keydown_s} s and logs it.` : 'None set (default). No template imposes one; a QRSS fox keys as long as its message takes.'),
        lim.max_keydown_s && at.worst_ms > lim.max_keydown_s * 1000 ? h('p.hint.warn', {},
          'The worst-case transmission is longer than this limit and will be cut.') : null,
        field('Watchdog', h('div.row', {},
          numInput(lim.watchdog_s ?? '',
            { min: 10, max: 3600, step: 1, width: '120px', onchange: v => { lim.watchdog_s = v; app.changed('limits'); } }),
          h('span.suffix', {}, 's'), h('button.btn.small', { onclick: () => { lim.watchdog_s = null; app.changed('limits'); } }, 'off')),
          lim.watchdog_s ? `The board resets itself if the firmware stops for ${lim.watchdog_s} s (a hung console write, a stuck peripheral); safemode.py brings it back into a normal boot. Every wait in foxlib feeds it.` : 'Off: a hung board stays hung until someone power-cycles it. 90 s is the field default.'))),
    h('div.card', {}, h('h3', {}, 'What will be written'),
      h('ul.diff', {}, files.map(f => h('li.file', {}, h('span', {}, f.path), h('span.to', {}, f.why), h('span')))),
      changes.length ? h('details', { open: changes.length < 12, style: 'margin-top:10px' },
        h('summary', { class: 'hint' }, `${changes.length} field${changes.length === 1 ? '' : 's'} differ from the board's fox.json`),
        h('ul.diff', {},
          changes.map(c => h('li', {}, h('span', {}, c.key), h('span.from', {}, c.from ?? '—'), h('span.to', {}, c.to ?? '—')))))
        : app.onBoard.cfg ? h('p.hint', {}, 'fox.json matches what is on the board.') : h('p.hint', {},
          app.connected ? 'No fox.json on the board yet.' : 'Connect a board to see the difference.')),
    h('div.card', {}, h('h3', {}, 'Deploy'),
      app.template.needs?.length ? h('p.hint.warn', {}, h('b', {}, 'This template needs: '), app.template.needs.join('; ')) : null,
      app.isNet ? clockRow() : null,
      recoveryRow(),
      h('label.gate', {}, h('input', { type: 'checkbox', checked: gateOk, onchange: e => { gateOk = e.target.checked; render(); } }),
        h('span', {}, h('b', {}, 'Antenna or dummy load is connected.'),
          ' The fox transmits within seconds of rebooting, and keying the module with nothing on the RF connector can damage it.')),
      h('div.tools', {}, h('button.btn.primary', { disabled: !ready, onclick: e => deploy(e.currentTarget) },
        busy ? 'Writing…' : 'Write to board and reboot'),
        h('button.btn',
          {disabled: !!blocking.length || busy,
            title: 'Download the same files as a zip, to copy onto a board by hand (Thonny or a CIRCUITPY drive)', onclick: exportZip},
          'Export deploy set (.zip)'),
        !app.connected ? h('span.hint', {}, 'Connect a board to write, or export the zip.') : transportWhy ? h('span.hint.err', {}, transportWhy) : blocking.length ? h('span.hint.err', {}, 'Fix the blocking checks above.') : overrides.length ? h('span.hint.err', {}, `${overrides.length} out-of-band override${overrides.length === 1 ? '' : 's'} — you will be asked to confirm.`) : null),
      lastResult ? resultBox(lastResult) : null),
    fleetRecordCard(),
    h('div.card', {}, h('h3', {}, 'Save as profile'),
      h('p.hint', {},
        'Keep this whole configuration under a name so it can be loaded onto the next fox in a couple of clicks (Profiles & fleet tab). Saving here does not write anything to the board.'),
      (() => { const nameIn = h('input',
        { type: 'text', value: cfg.fleet?.profile || '', placeholder: 'Fox 3 — 146.565 — W1ABC/3', style: 'flex:1;min-width:220px' });
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') app.saveProfile(nameIn.value); });
        return h('div.tools', {}, nameIn,
          h('button.btn', { onclick: () => app.saveProfile(nameIn.value) }, cfg.fleet?.profile ? 'Update profile' : 'Save profile'),
          cfg.fleet?.profile ? h('span.hint', {}, `current: "${cfg.fleet.profile}"`) : null); })()),
    h('div.card', {}, h('h3', {}, 'No CircuitPython on the board yet?'),
      h('p.hint', {}, 'Deploy writes files through CircuitPython, so a factory-fresh board needs it first: ',
        h('b', {}, 'Board → Flash CircuitPython'), ' (one board), or ', h('b', {}, 'Profiles & fleet → Batch flashing'),
        ' (several in a row). Then come back here.')));
}

/** What to do when the board's files are the computer's (a board with a CIRCUITPY drive, before boot.py). */
function usbDriveBox() {
  const get = async () => { try { download('boot.py', await loadRootFile('boot.py')); } catch (e) { app.console.err(String(e.message || e)); } };
  return h('div', {}, h('p.hint.err', {},
    'Deploy stopped before writing anything: this board shows up on the computer as a CIRCUITPY drive, and CircuitPython lets only one side write its files. Out of the box that is the computer, so neither this page (which writes through the serial port) nor the fox itself (finds.csv, near.csv) can.'),
    h('p.hint', {}, 'Give the files to the board, once per board, either way:'),
    h('ol', { style: 'margin:4px 0;padding-left:1.4em;font-size:.9rem' },
      h('li', {}, h('button.btn.small', { onclick: get }, 'Download boot.py'),
        ' and copy it onto the CIRCUITPY drive. Press the board\'s reset button (R), click Connect again, then Deploy.'),
      h('li', {},
        'Or eject the CIRCUITPY drive in the file manager (leave the cable in) and click Deploy again: the page writes boot.py itself. If the serial port drops when you eject, use the first way.')),
    h('p.hint', {},
      'From then on the drive is read-only on the computer and everything goes through this page. To undo it, at the console: ',
      h('code', {}, 'import os; os.remove("boot.py")'), ' and reset; or start the board in safe mode, where boot.py is not run.'));
}

function resultBox(r) {
  if (r.usbDrive) return usbDriveBox();
  if (r.error) return h('pre.out', {}, h('span.err', {}, 'deploy failed: ' + r.error));
  const b = r.banner;
  // mem= (network foxes, foxlib 1.10.11): the heap left after init. Under ~20 kB a feature switched on later, or a longer
  // payload, is the next MemoryError; the ESP32-C3 started 1.10.6 with 46 kB *before* its radio stack
  const kv = b ? ['template', 'foxlib', 'cfg', 'radio', 'id', 'freq', ...(b.mem ? ['mem'] : [])].map(k => h('span',
    {class: k === 'cfg' ? (b.cfg === 'ok' ? 'ok' : 'warn') : k === 'radio' ? (b.radio === 'ok' ? 'ok' : 'err') : k === 'id' ? (b.id === 'set' ? 'ok' : b.id === 'none' ? 'warn' : 'err') : k === 'mem' ? (Number(b.mem) >= 20000 ? 'ok' : 'warn') : '',
      title: k === 'mem' ? 'free heap after init (bytes); below 20 kB a feature switched on later is the next MemoryError' : ''},
    `${k}=${b[k] ?? '?'}  `)) : [h('span.err', {}, 'no FOX banner in the boot log — the firmware did not start')];
  return h('div', {}, h('p', { style: 'margin:12px 0 4px' }, r.ok ? badge('fox is up', 'ok') : badge('check the banner', 'warn'), ' ', ...kv),
    r.failedFeature ? h('p.hint.err', {},
      `${r.failedFeature.split(' ')[0]} failed to load on this board ${r.failedFeature.slice(r.failedFeature.indexOf('('))}: the fox is on the air without it. A foxlib bug, not a configuration problem — see the boot log.`) : null,
    h('p.hint', {}, 'The fox is running now. Re-read board (Board tab) or a Bench action interrupts it; ',
      h('button.btn.small', { onclick: () => app.restartFox() }, 'Restart fox'), ' starts it again.'),
    h('details', {}, h('summary.hint', {}, 'boot log'), h('pre.out', {}, r.bootLog)));
}
