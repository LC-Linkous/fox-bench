// deploy-foxlibc.js — Deploy tab for the foxlib-c family (PicoFox running fox-bench's own firmware):
// fox.json and defaults.json written to the FOXBENCH drive and read back. No code.py, no foxlib/,
// no reboot: the firmware reloads by itself a second after the last write and prints its banner on
// the serial console (Listen only).
// SPDX-License-Identifier: GPL-2.0-only
import { stringifyFoxJson } from '../model/foxlibc-limits.js';
import { h, badge, field, numInput } from './dom.js';
import { fleet, download } from '../model/profiles.js';
import { makeZip } from '../model/zip.js';
import { airtime, fmtDuration } from '../model/airtime.js';
import { packImages } from '../audio/sstv.js';

let app, gateOk = false, busy = false, last = null;
export function init(a) { app = a; }
const setLast = r => { last = r; app.lastDeploy = r ? { ...r, at: new Date().toISOString(), template: app.templateId } : null; };
const safe = s => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fox';
function flat(o, pre = '', out = {}) { for (const [k, v] of Object.entries(o || {})) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = JSON.stringify(v); } return out; }

/** The files, as the page writes them: fox.json, defaults.json and, for an SSTV payload, the images. */
export function files(cfg) {
  const out = [
    { path: 'fox.json', data: stringifyFoxJson(cfg), why: 'configuration' },
    { path: 'defaults.json', data: stringifyFoxJson(app.defaults), why: `${app.templateId} ${app.template.version} defaults for ${app.boardId}` },
  ];
  if (cfg.payload.kind === 'sstv') out.push({ path: cfg.payload.images_file, data: packImages(app.images), why: app.images.length ? `${app.images.length} image${app.images.length === 1 ? '' : 's'} (${app.images.map(im => im.name).join(', ')})` : 'no images — the firmware sends its test card' });
  return out;
}
const size = f => typeof f.data === 'string' ? f.data.length : f.data.length;
const powerText = cfg => `${(app.module.power_dbm.high - (cfg.radio.attenuation || 0) * (app.module.attenuation?.db_per_step || 0.25)).toFixed(1)} dBm (attenuation ${cfg.radio.attenuation || 0})`;

async function write(btn, render) {
  if (busy) return;
  const d = app.device, cfg = app.validCfg, log = app.console;
  { const why = app.deployBlocker(); if (why) { log.err(`deploy refused: ${why}`); return; } }
  busy = true; setLast(null); render();
  try {
    const fs = files(cfg);
    for (const f of fs) { if (typeof f.data === 'string') await d.writeText(f.path, f.data); else await d.writeBytes(f.path, f.data); }
    setLast({ ok: true, files: fs.map(f => ({ path: f.path, size: size(f) })) });
    await app.readDrive();
    app.setStatus(`${d.kind === 'demo' ? 'Demo · ' : ''}${app.board.name} · fox.json written — the fox reloads by itself`, d.kind === 'demo' ? 'demo' : 'ok');
    fleet.append({ board_number: '', uid: app.info?.uid || '', board: app.boardId, action: 'deploy', template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage, freq: cfg.plan.frequencies_mhz.join(' '), power: powerText(cfg), seed: cfg.schedule.seed ?? '', result: 'written', notes: [app.info?.driveName, d.kind === 'demo' ? 'demo' : ''].filter(Boolean).join(' · ') });
    log.line(`wrote fox.json and defaults.json to ${app.info?.driveName || 'the drive'} — the fox reloads them in about a second; Listen only shows the new banner`, 'ok');
  } catch (e) { setLast({ error: String(e.message || e) }); log.err('deploy failed: ' + last.error); }
  busy = false; gateOk = false; app.changed('deploy');
}

function exportZip() {
  const cfg = app.validCfg, fs = files(cfg);
  const readme = [
    `fox-bench deploy set for the ${app.board.name} — ${cfg.id.callmessage} · ${cfg.plan.frequencies_mhz.join(', ')} MHz · template ${app.templateId} ${app.template.version} · exported ${new Date().toISOString()}`,
    '', 'Copy the files to the root of the FOXBENCH drive (replace what is there). The fox reloads them by itself about a second',
    'after the last write and prints a new FOX banner on its serial console. No eject or power cycle is needed unless',
    'radio.tx_while_mounted is false, in which case it transmits once the drive is ejected.',
    '', 'No FOXBENCH drive? The board is not running fox-bench firmware: use "Reboot into bootloader" on the Board tab (BOOTSEL is inside the case) and copy',
    'foxbench-picofox.uf2 (Board tab → Firmware) onto the RPI-RP2 drive first.',
  ].join('\n');
  download(`picofox-foxbench-${safe(cfg.id.callmessage.split(' ')[0])}-${app.templateId}.zip`, makeZip([...fs, { path: 'README.txt', data: readme }]));
  fleet.append({ board_number: '', uid: '', board: app.boardId, action: 'export-zip', template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage, freq: cfg.plan.frequencies_mhz.join(' '), power: powerText(cfg), seed: cfg.schedule.seed ?? '', result: 'zip', notes: '' });
  app.console.dim('exported fox.json + defaults.json as a zip');
}

export function render(root, rerender) {
  const cfg = app.validCfg || app.cfg, b = app.board;
  const errs = [...app.report.map(r => ({ level: 'err', key: r.key, msg: r.reason })), ...app.issues];
  const blocking = errs.filter(e => e.level === 'err' && e.blocking !== false);
  const overrides = errs.filter(e => e.level === 'err' && e.blocking === false);
  const transportWhy = app.deployBlocker();
  const ready = !transportWhy && !blocking.length && gateOk && !busy;
  const at = airtime(cfg, { images: app.images });
  const lim = cfg.limits;
  const fs = files(cfg);
  const cur = app.onBoard.cfg ? flat(app.onBoard.cfg) : null, next = flat(cfg);
  const changes = cur ? [...new Set([...Object.keys(cur), ...Object.keys(next)])].filter(k => cur[k] !== next[k] && !k.startsWith('fleet.')).map(k => ({ key: k, from: cur[k], to: next[k] })) : [];
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Checks ', blocking.length ? badge(`${blocking.length} blocking`, 'err') : badge('all pass', 'ok')),
        errs.length ? h('ul', { style: 'margin:0;padding-left:1.2em' }, errs.map(e => h('li', { class: e.level === 'err' ? 'hint err' : e.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, e.key), ' ', e.msg))) : h('p.hint', {}, 'fox.json validates against CONFIG.md; callsign set; frequencies in range, in band and 20 kHz clear of the band edges.'),
        h('p.hint', { style: 'margin-top:8px' }, 'Status the firmware would report: ', h('code', {}, `cfg=${app.status}`), '. The firmware\'s validator is a line-for-line twin of this one (tested in CI).')),
      h('div.card', {}, h('h3', {}, 'Keydown'),
        h('dl.kv', {}, h('dt', {}, 'Typical transmission'), h('dd', {}, fmtDuration(at.typical_ms)), h('dt', {}, 'Worst case'), h('dd', {}, fmtDuration(at.worst_ms)), h('dt', {}, 'Power'), h('dd', {}, powerText(cfg)), h('dt', {}, 'Deviation'), h('dd', {}, `ID ±${cfg.radio.id_deviation_hz} Hz · audio ±${cfg.radio.audio_deviation_hz} Hz`)),
        field('Keydown limit', h('div.row', {}, numInput(lim.max_keydown_s ?? '', { min: 1, max: 7200, step: 1, width: '120px', onchange: v => { lim.max_keydown_s = v; app.changed('limits'); } }), h('span.suffix', {}, 's'), h('button.btn.small', { onclick: () => { lim.max_keydown_s = null; app.changed('limits'); } }, 'no limit')),
          lim.max_keydown_s ? `The firmware unkeys at ${lim.max_keydown_s} s and logs it.` : 'None set (default).'))),
    h('div.card', {}, h('h3', {}, 'What will be written'),
      h('ul.diff', {}, fs.map(f => h('li.file', {}, h('span', {}, f.path), h('span.to', {}, f.why), h('span.mono', {}, `${(size(f) / 1024).toFixed(1)} kB`)))),
      changes.length ? h('details', { open: changes.length < 12, style: 'margin-top:10px' }, h('summary', { class: 'hint' }, `${changes.length} field${changes.length === 1 ? '' : 's'} differ from the drive's fox.json`), h('ul.diff', {}, changes.map(c => h('li', {}, h('span', {}, c.key), h('span.from', {}, c.from ?? '—'), h('span.to', {}, c.to ?? '—')))))
        : app.onBoard.cfg ? h('p.hint', {}, 'fox.json matches what is on the drive.') : h('p.hint', {}, app.connected && !app.onBoard.listening ? 'No fox.json on the drive yet.' : `Open the ${b.drive?.label || 'drive'} to see the difference.`)),
    h('div.card', {}, h('h3', {}, 'Deploy'),
      h('label.gate', {}, h('input', { type: 'checkbox', checked: gateOk, onchange: e => { gateOk = e.target.checked; rerender(); } }), h('span', {}, h('b', {}, 'An antenna or dummy load is on the fox.'), cfg.radio.tx_while_mounted === false ? ' It transmits once the drive is ejected.' : ' It transmits within seconds of the reload, with the drive still mounted.')),
      h('div.tools', {}, h('button.btn.primary', { disabled: !ready, onclick: e => write(e.currentTarget, rerender) }, busy ? 'Writing…' : `Write to the ${b.drive?.label || 'drive'}`),
        h('button.btn', { disabled: !!blocking.length || busy, title: 'The same two files, to copy onto the drive by hand', onclick: exportZip }, 'Export files (.zip)'),
        !app.connected || app.onBoard.listening ? h('span.hint', {}, `Open the ${b.drive?.label || 'drive'} to write (Listen only is the serial console, not the drive), or export the zip.`) : transportWhy ? h('span.hint.err', {}, transportWhy) : blocking.length ? h('span.hint.err', {}, 'Fix the blocking checks above.') : overrides.length ? h('span.hint.err', {}, `${overrides.length} out-of-band override${overrides.length === 1 ? '' : 's'} — you will be asked to confirm.`) : null),
      last ? resultBox(last) : null),
    h('div.card', {}, h('h3', {}, 'Save as profile'),
      h('p.hint', {}, 'Keep this whole configuration under a name (Profiles & fleet tab). Saving here writes nothing to the drive.'),
      (() => { const nameIn = h('input', { type: 'text', value: cfg.fleet?.profile || '', placeholder: 'PicoFox 1 — 146.565', style: 'flex:1;min-width:220px' });
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') app.saveProfile(nameIn.value); });
        return h('div.tools', {}, nameIn, h('button.btn', { onclick: () => app.saveProfile(nameIn.value) }, cfg.fleet?.profile ? 'Update profile' : 'Save profile'), cfg.fleet?.profile ? h('span.hint', {}, `current: "${cfg.fleet.profile}"`) : null); })()));
}

function resultBox(r) {
  if (r.error) return h('pre.out', {}, h('span.err', {}, 'deploy failed: ' + r.error));
  return h('div', {}, h('p', { style: 'margin:12px 0 4px' }, badge('files written and read back', 'ok'), ' ', r.files.map(f => `${f.path} ${f.size} B`).join(' · ')),
    h('ol.steps', {},
      h('li', {}, 'The fox reloads about a second after the last write (no eject needed) and prints ', h('code', {}, 'FOX template=… cfg=… radio=… id=set'), ' on its serial console.'),
      h('li', {}, 'To watch: disconnect the drive here, then ', h('b', {}, 'Listen only'), ' opens the console; the banner prints again when the port opens. ', h('code', {}, 'status'), ' and ', h('code', {}, 'key 2'), ' work from the console drawer.')));
}
