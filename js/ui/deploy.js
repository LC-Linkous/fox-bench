// deploy.js — Deploy tab: diff, keydown limit, antenna gate, write set, reboot, banner.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, numInput, check } from './dom.js';
import { loadTemplateCode, loadFoxlibFile } from '../model/loaders.js';
import { parseBanner } from '../device/device.js';
import { airtime, fmtDuration } from '../model/airtime.js';
import { packImages } from '../audio/sstv.js';
import { fleet } from '../model/profiles.js';

let app, root, gateOk = false, lastResult = null, busy = false;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

/** Flatten a config to dotted key → JSON value for diffing. */
function flat(o, pre = '', out = {}) { for (const [k, v] of Object.entries(o || {})) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = JSON.stringify(v); } return out; }

function plan() {
  const files = [];
  const ob = app.onBoard, cfg = app.validCfg || app.cfg;
  const fwNeeded = !app.connected || ob.foxlibVersion !== app.catalog.foxlibVersion;
  if (fwNeeded) files.push({ path: 'foxlib/*', why: ob.foxlibVersion ? `foxlib ${ob.foxlibVersion} → ${app.catalog.foxlibVersion}` : 'install foxlib ' + app.catalog.foxlibVersion, kind: 'foxlib' });
  if (!app.connected || ob.template !== app.templateId || fwNeeded) files.push({ path: 'code.py', why: ob.template && ob.template !== app.templateId ? `${ob.template} → ${app.templateId}` : `${app.templateId} ${app.template.version}`, kind: 'code' });
  files.push({ path: 'defaults.json', why: `${app.templateId} defaults for ${app.boardId}`, kind: 'defaults' });
  files.push({ path: 'fox.json', why: 'configuration', kind: 'cfg' });
  if (cfg.payload.kind === 'sstv') files.push({ path: cfg.payload.images_file, why: `${app.images.length} image${app.images.length === 1 ? '' : 's'}`, kind: 'images' });
  const a = flat(ob.cfg || {}), b = flat(cfg), changes = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k] && !k.startsWith('fleet.')) changes.push({ key: k, from: a[k], to: b[k] });
  return { files, changes };
}

async function deploy(btn) {
  if (busy) return; busy = true; lastResult = null; render();
  const d = app.device, cfg = app.validCfg, log = app.console;
  const { files } = plan();
  try {
    for (const f of files) {
      if (f.kind === 'foxlib') { await d.mkdir('foxlib'); for (const name of app.catalog.foxlibFiles) await d.writeBytes('foxlib/' + name, await loadFoxlibFile(name)); }
      else if (f.kind === 'code') await d.writeText('code.py', await loadTemplateCode(app.templateId));
      else if (f.kind === 'defaults') await d.writeText('defaults.json', JSON.stringify(app.defaults));
      else if (f.kind === 'cfg') await d.writeText('fox.json', JSON.stringify(cfg, null, 1));
      else if (f.kind === 'images') await d.writeBytes(f.path, packImages(app.images));
    }
    const bootLog = await d.reboot();
    const banner = parseBanner(bootLog);
    lastResult = { bootLog, banner, ok: !!banner && banner.cfg === 'ok' && banner.radio === 'ok' && banner.id === 'set' };
    fleet.append({ board_number: '', uid: app.info.uid, board: app.info.boardId, action: 'deploy', template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage, freq: cfg.plan.frequencies_mhz.join(' '), seed: cfg.schedule.seed ?? '', result: lastResult.ok ? 'ok' : (banner ? `${banner.cfg} ${banner.radio} ${banner.id}` : 'no banner'), notes: app.device.kind === 'demo' ? 'demo' : '' });
    await app.readBoard();
  } catch (e) { lastResult = { error: String(e.message || e) }; log.err(lastResult.error); }
  busy = false; gateOk = false; app.changed('deploy');
}

function render() {
  const cfg = app.cfg, { files, changes } = plan();
  const at = airtime(cfg, { images: app.images });
  const errs = [...app.report.map(r => ({ level: 'err', key: r.key, msg: r.reason })), ...app.issues];
  const blocking = errs.filter(e => e.level === 'err');
  const ready = app.connected && !blocking.length && gateOk && !busy;
  const lim = cfg.limits;
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Checks ', blocking.length ? badge(`${blocking.length} blocking`, 'err') : badge('all pass', 'ok')),
        errs.length ? h('ul', { style: 'margin:0;padding-left:1.2em' }, errs.map(e => h('li', { class: e.level === 'err' ? 'hint err' : e.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, e.key), ' ', e.msg))) : h('p.hint', {}, 'fox.json validates against CONFIG.md; callsign set; all frequencies in range and in band.'),
        h('p.hint', { style: 'margin-top:8px' }, 'Status the firmware would report: ', h('code', {}, `cfg=${app.status}`))),
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
        !app.connected ? h('span.hint', {}, 'Connect a board first.') : blocking.length ? h('span.hint.err', {}, 'Fix the blocking checks above.') : null),
      lastResult ? resultBox(lastResult) : null),
    h('div.card', {}, h('h3', {}, 'Flash CircuitPython ', badge('next milestone', 'warn')),
      h('p.hint', {}, 'For a factory-fresh board: hold B while plugging in, then erase and write CircuitPython from this page with esptool-js. Until that lands, use ', h('a', { href: app.board.circuitpython.download, target: '_blank', rel: 'noopener' }, 'the CircuitPython .bin for this board'), ' with Adafruit\'s WebSerial ESPTool or ', h('code', {}, 'tools/batch_flash.py'), '.')));
}

function resultBox(r) {
  if (r.error) return h('pre.out', {}, h('span.err', {}, 'deploy failed: ' + r.error));
  const b = r.banner;
  const kv = b ? ['template', 'foxlib', 'cfg', 'radio', 'id', 'freq'].map(k => h('span', { class: k === 'cfg' ? (b.cfg === 'ok' ? 'ok' : 'warn') : k === 'radio' ? (b.radio === 'ok' ? 'ok' : 'err') : k === 'id' ? (b.id === 'set' ? 'ok' : 'err') : '' }, `${k}=${b[k] ?? '?'}  `)) : [h('span.err', {}, 'no FOX banner in the boot log — the firmware did not start')];
  return h('div', {}, h('p', { style: 'margin:12px 0 4px' }, r.ok ? badge('fox is up', 'ok') : badge('check the banner', 'warn'), ' ', ...kv), h('details', {}, h('summary.hint', {}, 'boot log'), h('pre.out', {}, r.bootLog)));
}
