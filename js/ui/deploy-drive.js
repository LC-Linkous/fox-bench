// deploy-drive.js — Deploy tab for the drive family (PicoFox): the four files, written to
// the drive and read back; export as zip; what to do afterwards. No reboot, no banner.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge } from './dom.js';
import { fleet, download } from '../model/profiles.js';
import { makeZip } from '../model/zip.js';
import { fmtDuration } from '../model/airtime.js';

let app, gateOk = false, busy = false, last = null;
export function init(a) { app = a; }
const setLast = r => { last = r; app.lastDeploy = r ? { ...r, at: new Date().toISOString(), template: app.templateId } : null; };
const safe = s => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fox';

function powerText(cfg) {
  const v = app.vendor, a = cfg.radio.attenuation || 0;
  return cfg.radio.revision === 'r2' ? `~${v.MAX_DBM} dBm (rev 2: no attenuator)` : `${(v.MAX_DBM - a * v.DB_PER_STEP).toFixed(1)} dBm (attenuation ${a} × ${v.DB_PER_STEP} dB)`;
}

async function write(btn, render) {
  if (busy) return;
  const d = app.device, v = app.vendor, cfg = app.validCfg, log = app.console;
  { const why = app.deployBlocker(); if (why) { log.err(`deploy refused: ${why}`); return; } }
  busy = true; setLast(null); render();
  try {
    const files = v.files(cfg);
    for (const f of files) await d.writeBytes(f.path, typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data);
    const stale = Object.keys(await d.list('')).filter(n => !v.FILES || !Object.values(v.FILES).includes(n)).filter(n => !n.startsWith('.') && !app.board.drive.files.includes(n));
    setLast({ ok: true, files: files.map(f => ({ path: f.path, size: typeof f.data === 'string' ? f.data.length : f.data.length })), stale });
    await app.readDrive();
    app.setStatus(`${d.kind === 'demo' ? 'Demo · ' : ''}${app.board.name} · files written — eject, then power-cycle`, d.kind === 'demo' ? 'demo' : 'ok');
    fleet.append({ board_number: '', uid: '', board: app.boardId, action: 'deploy', template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage, freq: String(cfg.plan.frequencies_mhz[0]), power: powerText(cfg), seed: '', result: 'written', notes: [app.info?.driveName, d.kind === 'demo' ? 'demo' : ''].filter(Boolean).join(' · ') });
    log.line(`wrote ${files.length} files to ${app.info?.driveName || 'the drive'} — eject it, then switch the fox off and on`, 'ok');
  } catch (e) { setLast({ error: String(e.message || e) }); log.err('deploy failed: ' + last.error); }
  busy = false; gateOk = false; app.changed('deploy');
}

function exportZip() {
  const v = app.vendor, cfg = app.validCfg, files = v.files(cfg);
  const readme = [
    `fox-bench deploy set for the ${app.board.name} — ${cfg.id.callmessage} · ${cfg.plan.frequencies_mhz[0]} MHz · exported ${new Date().toISOString()}`,
    '', 'Copy all four files to the root of the PicoFox drive (replace what is there), eject, then switch the fox off and on:',
    '  ' + files.map(f => f.path).join('  '),
    '', 'The two dot-files are hidden on most systems; make sure they are copied too. Without .settings_crc.bin the firmware',
    'regenerates its own 12-character ID audio instead of playing the one in this zip.',
  ].join('\n');
  download(`picofox-${safe(cfg.id.callmessage.split(' ')[0])}.zip`, makeZip([...files, { path: 'README.txt', data: readme }]));
  fleet.append({ board_number: '', uid: '', board: app.boardId, action: 'export-zip', template: `${app.templateId}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: cfg.id.callmessage, freq: String(cfg.plan.frequencies_mhz[0]), power: powerText(cfg), seed: '', result: 'zip', notes: '' });
  app.console.dim('exported the four PicoFox files as a zip');
}

export function render(root, rerender) {
  const v = app.vendor, cfg = app.validCfg || app.cfg, b = app.board;
  const errs = [...app.report.map(r => ({ level: 'err', key: r.key, msg: r.reason })), ...app.issues];
  const blocking = errs.filter(e => e.level === 'err');
  const transportWhy = app.deployBlocker();
  const ready = !transportWhy && !blocking.length && gateOk && !busy;
  const files = v.files(cfg), cyc = v.cycle(cfg, 3600000);
  const sizes = files.map(f => typeof f.data === 'string' ? f.data.length : f.data.length);
  const ob = app.onBoard, cur = ob.settings, next = v.parseSettings(files[0].data);
  const changes = cur ? Object.keys(next).filter(k => (cur[k] ?? '') !== String(next[k])).map(k => ({ key: k, from: cur[k], to: next[k] })) : [];
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Checks ', blocking.length ? badge(`${blocking.length} blocking`, 'err') : badge('all pass', 'ok')),
        errs.length ? h('ul', { style: 'margin:0;padding-left:1.2em' }, errs.map(e => h('li', { class: e.level === 'err' ? 'hint err' : e.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, e.key), ' ', e.msg))) : h('p.hint', {}, 'Frequency inside what the firmware allows for the zone, callsign set, duty cycle above zero.'),
        h('p.hint', { style: 'margin-top:8px' }, 'The firmware reports nothing back; these checks are the only validation. Anything it dislikes makes the fox silent rather than complaining.')),
      h('div.card', {}, h('h3', {}, 'One cycle'),
        h('dl.kv', {}, h('dt', {}, 'Audio'), h('dd', {}, fmtDuration(cyc.audioMs)), h('dt', {}, 'Morse ID'), h('dd', {}, fmtDuration(cyc.idMs)), h('dt', {}, 'Off'), h('dd', {}, cyc.offMs ? fmtDuration(cyc.offMs) : 'none (100 % duty)'), h('dt', {}, 'Period'), h('dd', {}, fmtDuration(cyc.periodMs)), h('dt', {}, 'Power'), h('dd', {}, powerText(cfg)), h('dt', {}, 'Deviation'), h('dd', {}, `audio ±${cfg.radio.audio_deviation_hz} Hz · ID ±${cfg.radio.id_deviation_hz} Hz`)),
        h('p.hint', {}, 'The firmware moves the carrier ±5 kHz segment by segment and, below 100 % duty, steps the power each cycle; the Schedule tab draws it.'))),
    h('div.card', {}, h('h3', {}, 'What will be written'),
      h('ul.diff', {}, files.map((f, i) => h('li.file', {}, h('span', {}, f.path), h('span.to', {}, f.why), h('span.mono', {}, `${(sizes[i] / 1024).toFixed(sizes[i] > 10240 ? 0 : 1)} kB`)))),
      changes.length ? h('details', { open: true, style: 'margin-top:10px' }, h('summary', { class: 'hint' }, `${changes.length} setting${changes.length === 1 ? '' : 's'} differ from the drive's ${v.FILES.settings}`), h('ul.diff', {}, changes.map(c => h('li', {}, h('span', {}, c.key), h('span.from', {}, c.from ?? '—'), h('span.to', {}, String(c.to))))))
        : cur ? h('p.hint', {}, `${v.FILES.settings} matches the drive. The audio files are rewritten regardless.`) : h('p.hint', {}, app.connected ? `No ${v.FILES.settings} on the drive yet.` : 'Open the drive to see the difference.')),
    h('div.card', {}, h('h3', {}, 'Deploy'),
      h('label.gate', {}, h('input', { type: 'checkbox', checked: gateOk, onchange: e => { gateOk = e.target.checked; rerender(); } }), h('span', {}, h('b', {}, 'An antenna or dummy load will be on the fox when it is switched back on.'), ' It transmits within seconds of booting with the drive unmounted.')),
      h('div.tools', {}, h('button.btn.primary', { disabled: !ready, onclick: e => write(e.currentTarget, rerender) }, busy ? 'Writing…' : `Write files to the ${b.drive?.label || 'drive'}`),
        h('button.btn', { disabled: !!blocking.length || busy, title: 'The same four files, to copy onto the drive by hand', onclick: exportZip }, 'Export files (.zip)'),
        !app.connected ? h('span.hint', {}, `Open the ${b.drive?.label || 'drive'} to write, or export the zip and copy by hand.`) : transportWhy ? h('span.hint.err', {}, transportWhy) : blocking.length ? h('span.hint.err', {}, 'Fix the blocking checks above.') : null),
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
    h('ol.steps', {}, h('li', {}, 'Eject the drive in your operating system (the firmware will not play while it is mounted).'), h('li', {}, 'Switch the fox off, then on. It boots, keeps our ID audio because the marker matches, and starts transmitting.'), h('li', {}, 'Optional: ', h('b', {}, 'Listen only'), ' before the power cycle shows the boot messages; a receiver on ', h('code', {}, `${app.cfg.plan.frequencies_mhz[0]} MHz`), ' is the real test.')),
    r.stale?.length ? h('p.hint', {}, `Other files on the drive (${r.stale.join(', ')}) are not used by the firmware; it leaves them alone.`) : null);
}
