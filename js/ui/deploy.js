// deploy.js — Deploy tab: diff, keydown limit, antenna gate, write set, reboot, banner.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, numInput, check } from './dom.js';
import { loadTemplateCode, loadFoxlibFile } from '../model/loaders.js';
import { parseBanner } from '../device/device.js';
import { airtime, fmtDuration } from '../model/airtime.js';
import { packImages } from '../audio/sstv.js';
import { fleet, download } from '../model/profiles.js';
import { makeZip } from '../model/zip.js';
import * as drive from './deploy-drive.js';
import * as foxlibc from './deploy-foxlibc.js';

let app, root, gateOk = false, lastResult = null, busy = false;
const setLast = r => { lastResult = r; app.lastDeploy = r ? { ...r, at: new Date().toISOString(), template: app.templateId, uid: app.info?.uid } : null; };
export function init(a, el) { app = a; root = el; drive.init(a); foxlibc.init(a); app.listeners.add(render); render(); }

/** Flatten a config to dotted key → JSON value for diffing. */
function flat(o, pre = '', out = {}) { for (const [k, v] of Object.entries(o || {})) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = JSON.stringify(v); } return out; }

function plan() {
  const files = [];
  const ob = app.onBoard, cfg = app.validCfg || app.cfg;
  const fwNeeded = !app.connected || ob.foxlibVersion !== app.catalog.foxlibVersion || !ob.foxlibComplete;
  if (fwNeeded) files.push({ path: 'foxlib/*', why: ob.foxlibVersion && !ob.foxlibComplete ? `foxlib ${ob.foxlibVersion} is incomplete on the board (${ob.foxlibMissing.length} file${ob.foxlibMissing.length === 1 ? '' : 's'} missing) → reinstall ${app.catalog.foxlibVersion}` : ob.foxlibVersion ? `foxlib ${ob.foxlibVersion} → ${app.catalog.foxlibVersion}` : 'install foxlib ' + app.catalog.foxlibVersion, kind: 'foxlib' });
  if (!app.connected || ob.template !== app.templateId || fwNeeded) files.push({ path: 'code.py', why: ob.template && ob.template !== app.templateId ? `${ob.template} → ${app.templateId}` : `${app.templateId} ${app.template.version}`, kind: 'code' });
  files.push({ path: 'defaults.json', why: `${app.templateId} defaults for ${app.boardId}`, kind: 'defaults' });
  files.push({ path: 'fox.json', why: 'configuration', kind: 'cfg' });
  if (cfg.payload.kind === 'sstv') files.push({ path: cfg.payload.images_file, why: app.images.length ? `${app.images.length} image${app.images.length === 1 ? '' : 's'}` : 'no images — firmware will use its test card', kind: 'images' });
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
  for (const name of app.catalog.foxlibFiles) files.push({ path: 'foxlib/' + name, data: await loadFoxlibFile(name) });
  files.push({ path: 'code.py', data: await loadTemplateCode(app.templateId) });
  files.push({ path: 'defaults.json', data: JSON.stringify(app.defaults) });
  files.push({ path: 'fox.json', data: JSON.stringify(cfg, null, 1) });
  if (cfg.payload.kind === 'sstv') files.push({ path: cfg.payload.images_file, data: packImages(app.images) });
  files.push({ path: 'README.txt', data: [
    `fox-bench deploy set — ${app.templateId} ${app.template.version}, foxlib ${app.catalog.foxlibVersion}, board ${app.boardId}`,
    `callsign ${cfg.id.callmessage} · ${cfg.plan.frequencies_mhz.join(', ')} MHz · exported ${new Date().toISOString()}`,
    '',
    'Copy everything in this zip to the root of the CircuitPython board, keeping the foxlib/ folder:',
    '  code.py  defaults.json  fox.json  foxlib/  ' + (cfg.payload.kind === 'sstv' ? cfg.payload.images_file : ''),
    'With Thonny: File → Open each file → File → Save As → CircuitPython device, same name and path.',
    'With a board that mounts a CIRCUITPY drive: drag the files onto the drive.',
    'Then reset (Ctrl-D in the REPL, or the R button). The boot log prints a line starting with "FOX" that reports',
    'cfg=ok radio=ok id=set when the fox came up correctly.',
    '',
    'To change the callsign or frequency later you only need to replace fox.json.',
  ].join('\n') });
  const safe = s => s.replace(/[^A-Za-z0-9._-]+/g, '_');
  download(`fox-${safe(cfg.id.callmessage.split(' ')[0])}-${app.templateId}.zip`, makeZip(files));
  fleet.append({ board_number: '', uid: app.info?.uid || '', board: app.boardId, action: 'export-zip', template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage, freq: cfg.plan.frequencies_mhz.join(' '), power: `${cfg.radio.high_power ? 'high' : 'low'}${cfg.radio.power_dbm != null ? ' ' + cfg.radio.power_dbm + 'dBm' : ''}`, seed: cfg.schedule.seed ?? '', result: 'zip', notes: '' });
  app.console.dim(`exported deploy set (${files.length} files)`);
}

async function deploy(btn) {
  if (busy) return;
  const overrides = app.issues.filter(e => e.level === 'err' && e.blocking === false);
  if (overrides.length && !confirm(`Deploy anyway?\n\n${overrides.map(o => '• ' + o.msg.replace(/ — .*$/, '')).join('\n')}\n\nThese are outside the ${app.region} amateur band table. Make sure this is intended (bench testing into a load, a different allocation, etc.).`)) return;
  busy = true; setLast(null); render();
  const d = app.device, cfg = app.validCfg, log = app.console;
  { const why = app.deployBlocker(); if (why) { log.err(`deploy refused: ${why}`); return; } }
  const { files } = plan();
  try {
    await d.interrupt();                       // the fox may be running from a previous deploy or restart
    for (const f of files) {
      if (f.kind === 'foxlib') { await d.mkdir('foxlib'); for (const name of app.catalog.foxlibFiles) await d.writeBytes('foxlib/' + name, await loadFoxlibFile(name)); }
      else if (f.kind === 'code') await d.writeText('code.py', await loadTemplateCode(app.templateId));
      else if (f.kind === 'defaults') await d.writeText('defaults.json', JSON.stringify(app.defaults));
      else if (f.kind === 'cfg') await d.writeText('fox.json', JSON.stringify(cfg, null, 1));
      else if (f.kind === 'images') await d.writeBytes(f.path, packImages(app.images));
    }
    const bootLog = await d.reboot();
    const banner = parseBanner(bootLog);
    if (banner) app.lastBanner = banner;
    setLast({ bootLog, banner, ok: !!banner && banner.cfg === 'ok' && banner.radio === 'ok' && banner.id === 'set' });
    const written = Object.fromEntries(files.map(f => [f.path.replace('/*', ''), { size: 1, dir: f.kind === 'foxlib' }]));
    app.onBoard = { ...app.onBoard, cfg: structuredClone(cfg), raw: JSON.stringify(cfg), template: app.templateId, foxlibVersion: app.catalog.foxlibVersion, foxlibComplete: true, foxlibMissing: [], files: { ...app.onBoard.files, ...written } };
    app.info.foxlibVersion = app.catalog.foxlibVersion;
    app.setStatus(`${d.kind === 'demo' ? 'Demo · ' : ''}${app.info.boardId} · uid ${app.info.uid.slice(-6)} · foxlib ${app.catalog.foxlibVersion} · fox running`, d.kind === 'demo' ? 'demo' : 'tx');
    fleet.append({ board_number: '', uid: app.info.uid, board: app.info.boardId, action: 'deploy', template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage, freq: cfg.plan.frequencies_mhz.join(' '), power: `${cfg.radio.high_power ? 'high' : 'low'}${cfg.radio.power_dbm != null ? ' ' + cfg.radio.power_dbm + 'dBm' : ''}`, seed: cfg.schedule.seed ?? '', result: lastResult.ok ? 'ok' : (banner ? `${banner.cfg} ${banner.radio} ${banner.id}` : 'no banner'), notes: app.device.kind === 'demo' ? 'demo' : '' });
  } catch (e) { setLast({ error: String(e.message || e) + (/HTTP 404/.test(e.message || '') ? ' — a firmware file is missing from the site; the repo needs a .nojekyll marker so GitHub Pages serves foxlib/__init__.py' : '') }); log.err(lastResult.error); }
  busy = false; gateOk = false; app.changed('deploy');
}

function render() {
  if (app.family === 'drive') return drive.render(root, render);
  if (app.family === 'foxlib-c') return foxlibc.render(root, render);
  const cfg = app.cfg, { files, changes } = plan();
  const at = airtime(cfg, { images: app.images });
  const errs = [...app.report.map(r => ({ level: 'err', key: r.key, msg: r.reason })), ...app.issues];
  const blocking = errs.filter(e => e.level === 'err' && e.blocking !== false);
  const overrides = errs.filter(e => e.level === 'err' && e.blocking === false);
  const transportWhy = app.deployBlocker();
  const ready = !transportWhy && !blocking.length && gateOk && !busy;
  const lim = cfg.limits;
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Checks ', blocking.length ? badge(`${blocking.length} blocking`, 'err') : badge('all pass', 'ok')),
        errs.length ? h('ul', { style: 'margin:0;padding-left:1.2em' }, errs.map(e => h('li', { class: e.level === 'err' ? 'hint err' : e.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, e.key), ' ', e.msg))) : h('p.hint', {}, 'fox.json validates against CONFIG.md; callsign set; all frequencies in range and in band.'),
        h('p.hint', { style: 'margin-top:8px' }, 'Status the firmware would report: ', h('code', {}, `cfg=${app.status}`), '. Blocking: invalid config, unset callsign, missing required pins. Not blocking: frequencies outside the band table (confirmed at deploy).')),
      h('div.card', {}, h('h3', {}, 'Keydown'),
        h('dl.kv', {}, h('dt', {}, 'Typical transmission'), h('dd', {}, fmtDuration(at.typical_ms)), h('dt', {}, 'Worst case'), h('dd', {}, fmtDuration(at.worst_ms))),
        field('Keydown limit', h('div.row', {}, numInput(lim.max_keydown_s ?? '', { min: 1, max: 7200, step: 1, width: '120px', onchange: v => { lim.max_keydown_s = v; app.changed('limits'); } }), h('span.suffix', {}, 's'), h('button.btn.small', { onclick: () => { lim.max_keydown_s = null; app.changed('limits'); } }, 'no limit')),
          lim.max_keydown_s ? `The firmware unkeys at ${lim.max_keydown_s} s and logs it.` : 'None set (default). No template imposes one; a QRSS fox keys as long as its message takes.'),
        lim.max_keydown_s && at.worst_ms > lim.max_keydown_s * 1000 ? h('p.hint.warn', {}, 'The worst-case transmission is longer than this limit and will be cut.') : null)),
    h('div.card', {}, h('h3', {}, 'What will be written'),
      h('ul.diff', {}, files.map(f => h('li.file', {}, h('span', {}, f.path), h('span.to', {}, f.why), h('span')))),
      changes.length ? h('details', { open: changes.length < 12, style: 'margin-top:10px' }, h('summary', { class: 'hint' }, `${changes.length} field${changes.length === 1 ? '' : 's'} differ from the board's fox.json`), h('ul.diff', {}, changes.map(c => h('li', {}, h('span', {}, c.key), h('span.from', {}, c.from ?? '—'), h('span.to', {}, c.to ?? '—')))))
        : app.onBoard.cfg ? h('p.hint', {}, 'fox.json matches what is on the board.') : h('p.hint', {}, app.connected ? 'No fox.json on the board yet.' : 'Connect a board to see the difference.')),
    h('div.card', {}, h('h3', {}, 'Deploy'),
      h('label.gate', {}, h('input', { type: 'checkbox', checked: gateOk, onchange: e => { gateOk = e.target.checked; render(); } }), h('span', {}, h('b', {}, 'Antenna or dummy load is connected.'), ' The fox transmits within seconds of rebooting, and keying the module with nothing on the RF connector can damage it.')),
      h('div.tools', {}, h('button.btn.primary', { disabled: !ready, onclick: e => deploy(e.currentTarget) }, busy ? 'Writing…' : 'Write to board and reboot'),
        h('button.btn', { disabled: !!blocking.length || busy, title: 'Download the same files as a zip, to copy onto a board by hand (Thonny or a CIRCUITPY drive)', onclick: exportZip }, 'Export deploy set (.zip)'),
        !app.connected ? h('span.hint', {}, 'Connect a board to write, or export the zip.') : transportWhy ? h('span.hint.err', {}, transportWhy) : blocking.length ? h('span.hint.err', {}, 'Fix the blocking checks above.') : overrides.length ? h('span.hint.err', {}, `${overrides.length} out-of-band override${overrides.length === 1 ? '' : 's'} — you will be asked to confirm.`) : null),
      lastResult ? resultBox(lastResult) : null),
    h('div.card', {}, h('h3', {}, 'Save as profile'),
      h('p.hint', {}, 'Keep this whole configuration under a name so it can be loaded onto the next fox in a couple of clicks (Profiles & fleet tab). Saving here does not write anything to the board.'),
      (() => { const nameIn = h('input', { type: 'text', value: cfg.fleet?.profile || '', placeholder: 'Fox 3 — 146.565 — W1ABC/3', style: 'flex:1;min-width:220px' });
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') app.saveProfile(nameIn.value); });
        return h('div.tools', {}, nameIn, h('button.btn', { onclick: () => app.saveProfile(nameIn.value) }, cfg.fleet?.profile ? 'Update profile' : 'Save profile'), cfg.fleet?.profile ? h('span.hint', {}, `current: "${cfg.fleet.profile}"`) : null); })()),
    h('div.card', {}, h('h3', {}, 'No CircuitPython on the board yet?'),
      h('p.hint', {}, 'Deploy writes files through CircuitPython, so a factory-fresh board needs it first: ', h('b', {}, 'Board → Flash CircuitPython'), ' (one board), or ', h('b', {}, 'Profiles & fleet → Batch flashing'), ' (several in a row). Then come back here.')));
}

function resultBox(r) {
  if (r.error) return h('pre.out', {}, h('span.err', {}, 'deploy failed: ' + r.error));
  const b = r.banner;
  const kv = b ? ['template', 'foxlib', 'cfg', 'radio', 'id', 'freq'].map(k => h('span', { class: k === 'cfg' ? (b.cfg === 'ok' ? 'ok' : 'warn') : k === 'radio' ? (b.radio === 'ok' ? 'ok' : 'err') : k === 'id' ? (b.id === 'set' ? 'ok' : 'err') : '' }, `${k}=${b[k] ?? '?'}  `)) : [h('span.err', {}, 'no FOX banner in the boot log — the firmware did not start')];
  return h('div', {}, h('p', { style: 'margin:12px 0 4px' }, r.ok ? badge('fox is up', 'ok') : badge('check the banner', 'warn'), ' ', ...kv),
    h('p.hint', {}, 'The fox is running now. Re-read board (Board tab) or a Bench action interrupts it; ', h('button.btn.small', { onclick: () => app.restartFox() }, 'Restart fox'), ' starts it again.'),
    h('details', {}, h('summary.hint', {}, 'boot log'), h('pre.out', {}, r.bootLog)));
}
