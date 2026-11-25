// deploy-console.js — Deploy tab for a console-configured fox: a foxlib-c target with no USB drive
// (the ESP32 boards on fox-bench's C firmware). fox.json and defaults.json go over the serial
// console (PROTOCOL.md "Files over the console") and are read back; the firmware reloads by
// itself about a second after the last write and prints its banner on the same console. No
// code.py, no foxlib/, no reboot — and no FM cards: these targets run the network templates.
// SPDX-License-Identifier: GPL-2.0-only
import { stringifyFoxJson } from '../model/foxlibc-limits.js';
import { firmwareText } from '../model/audit.js';
import { h, badge } from './dom.js';
import { fleet, download } from '../model/profiles.js';
import { onAir } from '../model/sheet.js';
import { makeZip } from '../model/zip.js';

let app, gateOk = false, busy = false, last = null;
export function init(a) { app = a; }
const setLast = r => { last = r; app.lastDeploy = r ? { ...r, at: new Date().toISOString(), template: app.templateId } : null; };
const safe = s => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fox';
function flat(o, pre = '', out = {}) { for (const [k, v] of Object.entries(o || {})) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = JSON.stringify(v); } return out; }

/** The two files, as the page sends them. */
export function files(cfg) {
  return [
    { path: 'fox.json', data: stringifyFoxJson(cfg), why: 'configuration' },
    { path: 'defaults.json', data: stringifyFoxJson(app.defaults), why: `${app.templateId} ${app.template.version} defaults for ${app.boardId}` },
  ];
}

async function write(btn, render) {
  if (busy) return;
  const d = app.device, cfg = app.validCfg, log = app.console;
  { const why = app.deployBlocker(); if (why) { log.err(`deploy refused: ${why}`); return; } }
  busy = true; setLast(null); render();
  try {
    const fs = files(cfg);
    for (const f of fs) await d.writeText(f.path, f.data);   // put, verified by size and crc32 by the device
    setLast({ ok: true, files: fs.map(f => ({ path: f.path, size: f.data.length })) });
    await app.readConsole();
    app.setStatus(`${d.kind === 'demo' ? 'Demo · ' : ''}${app.board.name} · fox.json sent — the fox reloads by itself`, d.kind === 'demo' ? 'demo' : 'ok');
    fleet.append({ board_number: '', uid: app.info?.uid || '', board: app.boardId, action: 'deploy',
      template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage,
      owner: cfg.fleet?.owner || '', event: cfg.fleet?.event || '', on_air: onAir(cfg, { family: app.family, template: app.templateId }),
      freq: '', power: cfg.net?.tx_power_dbm != null ? `${cfg.net.tx_power_dbm} dBm` : '', seed: cfg.schedule?.seed ?? '', result: 'written',
      firmware: firmwareText(app.info?.foxlibVersion || app.onBoard?.foxlibVersion || ''),
      notes: ['over the console', d.kind === 'demo' ? 'demo' : ''].filter(Boolean).join(' · ') });
    log.line('sent fox.json and defaults.json over the console — the fox reloads them in about a second and prints its banner here', 'ok');
  } catch (e) { setLast({ error: String(e.message || e) }); log.err('deploy failed: ' + last.error); }
  busy = false; gateOk = false; app.changed('deploy');
}

function exportZip() {
  const cfg = app.validCfg, fs = files(cfg);
  const readme = [
    `fox-bench deploy set for the ${app.board.name} — ${cfg.id.callmessage} · ${onAir(cfg, { family: app.family, template: app.templateId })} · template ${app.templateId} ${app.template.version} · exported ${new Date().toISOString()}`,
    '', 'This board has no drive: send both files over its serial console with `put <name> <size>` (PROTOCOL.md, "Files over the',
    'console"), or from the page\'s Deploy tab with the board connected. The firmware reloads about a second after the last file.', ''].join('\n');
  download(`${safe(app.boardId)}-${safe(cfg.id.callmessage)}-${app.templateId}.zip`, makeZip([...fs, { path: 'README.txt', data: readme }]), 'application/zip');
}

export function render(root, rerender) {
  const cfg = app.validCfg || app.cfg, b = app.board;
  const errs = [...app.report.map(r => ({ level: 'err', key: r.key, msg: r.reason })), ...app.issues];
  const blocking = errs.filter(e => e.level === 'err' && e.blocking !== false);
  const transportWhy = app.deployBlocker();
  const ready = !transportWhy && !blocking.length && gateOk && !busy;
  const fs = files(cfg);
  const cur = app.onBoard.cfg ? flat(app.onBoard.cfg) : null, next = flat(cfg);
  const changes = cur ? [...new Set([...Object.keys(cur), ...Object.keys(next)])].filter(k => cur[k] !== next[k] && !k.startsWith('fleet.')).map(k => ({ key: k, from: cur[k], to: next[k] })) : [];
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Checks ', blocking.length ? badge(`${blocking.length} blocking`, 'err') : badge('all pass', 'ok')),
        errs.length ? h('ul', { style: 'margin:0;padding-left:1.2em' },
          errs.map(e => h('li', { class: e.level === 'err' ? 'hint err' : e.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, e.key), ' ', e.msg)))
          : h('p.hint', {}, 'fox.json validates against CONFIG.md; callsign set; the radio section fits this chip.'),
        h('p.hint', { style: 'margin-top:8px' }, 'Status the firmware would report: ', h('code', {}, `cfg=${app.status}`), '. The firmware\'s validator is a line-for-line twin of this one (tested in CI).')),
      h('div.card', {}, h('h3', {}, 'On the air'),
        h('p', {}, onAir(cfg, { family: app.family, template: app.templateId })),
        h('p.hint', {}, `${b.name}: fox-bench's C firmware on the chip's own radio. No CircuitPython, no drive — the USB lead is the console that configures it and the port that flashes it.`))),
    h('div.card', {}, h('h3', {}, 'What will be sent'),
      h('ul.diff', {}, fs.map(f => h('li.file', {}, h('span', {}, f.path), h('span.to', {}, f.why), h('span.mono', {}, `${(f.data.length / 1024).toFixed(1)} kB`)))),
      changes.length ? h('details', { open: changes.length < 12, style: 'margin-top:10px' },
        h('summary', { class: 'hint' }, `${changes.length} field${changes.length === 1 ? '' : 's'} differ from the fox's fox.json`),
        h('ul.diff', {}, changes.map(c => h('li', {}, h('span', {}, c.key), h('span.from', {}, c.from ?? '—'), h('span.to', {}, c.to ?? '—')))))
        : app.onBoard.cfg ? h('p.hint', {}, 'fox.json matches what is on the fox.') : h('p.hint', {}, app.connected && !app.onBoard.listening ? 'No fox.json on the fox yet.' : 'Connect to see the difference.')),
    h('div.card', {}, h('h3', {}, 'Deploy'),
      h('label.gate', {}, h('input', { type: 'checkbox', checked: gateOk, onchange: e => { gateOk = e.target.checked; rerender(); } }),
        h('span', {}, h('b', {}, 'The antenna is fitted.'), ' The fox is on the air within seconds of the reload.')),
      h('div.tools', {}, h('button.btn.primary', { disabled: !ready, onclick: e => write(e.currentTarget, rerender) }, busy ? 'Sending…' : 'Send over the console'),
        h('button.btn', { disabled: !!blocking.length || busy, title: 'The same two files, to send by hand', onclick: exportZip }, 'Export files (.zip)'),
        !app.connected || app.onBoard.listening ? h('span.hint', {}, 'Connect to the fox\'s console to send (Listen only watches; Connect identifies it first), or export the zip.')
          : transportWhy ? h('span.hint.err', {}, transportWhy) : null),
      last ? resultBox(last) : null),
    h('div.card', {}, h('h3', {}, 'Save as profile'),
      h('p.hint', {}, 'Keep this whole configuration under a name (Profiles & fleet tab). Saving here sends nothing to the fox.'),
      (() => { const nameIn = h('input', { type: 'text', value: cfg.fleet?.profile || '', placeholder: 'Fox 1 — checkpoint', style: 'flex:1;min-width:220px' });
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') app.saveProfile(nameIn.value); });
        return h('div.tools', {}, nameIn, h('button.btn', { onclick: () => app.saveProfile(nameIn.value) }, cfg.fleet?.profile ? 'Update profile' : 'Save profile'),
          cfg.fleet?.profile ? h('span.hint', {}, `current: "${cfg.fleet.profile}"`) : null); })()));
}

function resultBox(r) {
  if (r.error) return h('pre.out', {}, h('span.err', {}, 'deploy failed: ' + r.error));
  return h('div', {}, h('p', { style: 'margin:12px 0 4px' }, badge('files sent and verified', 'ok'), ' ', r.files.map(f => `${f.path} ${f.size} B`).join(' · ')),
    h('ol.steps', {}, h('li', {}, 'The fox reloads about a second after the last file and prints ', h('code', {}, 'FOX template=… cfg=… radio=… id=set'), ' on this console.'),
      h('li', {}, h('code', {}, 'status'), ' and the Bench tab\'s actions work on the same connection.')));
}
