// fleet.js — Profiles (named configs) and the fleet log.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field } from './dom.js';
import { profiles, fleet, download, FLEET_FIELDS, unpackProfileImages } from '../model/profiles.js';
import { batchCard, onChange as onFlashChange } from './flash.js';
import { observe, match, auditRow } from '../model/audit.js';

let app, root, lastAudit = null;
export function init(a, el) { app = a; root = el; app.listeners.add(render); onFlashChange(render); render(); }

/** Audit: read what the connected fox is, match it with the log's last deploy for it, record the verdict. */
function audit(noteIn) {
  const obs = observe(app); if (!obs) return;
  const m = match(obs, fleet.all());
  const row = auditRow(obs, m, (noteIn?.value || '').trim());
  fleet.append(row);
  lastAudit = { obs, m, row, at: new Date().toISOString() };
  app.console.line(`audit: ${m.result}${m.row ? ` — board #${m.row.board_number || '?'}${m.row.profile ? ' · ' + m.row.profile : ''}` : ''}`, m.result === 'match' ? 'ok' : m.result === 'mismatch' ? 'err' : 'dim');
  render();
}

function auditCard() {
  const connected = !!app.device, obs = connected ? observe(app) : null;
  const noteIn = h('input', { type: 'text', placeholder: 'note (hider, box label, battery…)', style: 'flex:1;min-width:160px' });
  const how = !connected ? 'Connect (REPL), Listen only (console) or Open the drive first.'
    : obs?.uid ? `Identity: chip UID …${obs.uid.slice(-8)}${obs.source === 'console' ? ' from the banner' : ''}.`
    : app.family === 'drive' ? 'This board exposes no UID: matched by board and what was last deployed on it.'
    : 'No UID this way (drive only): matched by board. Listen only gives the UID.';
  const la = lastAudit;
  return h('div.card', {}, h('h3', {}, 'Audit the connected fox'),
    h('p.hint', {}, 'Is this fox what the log says it is? Reads its identity and configuration and compares them with the last deploy recorded for it (template, callsign, frequencies, and the banner\'s cfg/radio/id when there is one), then appends an ', h('code', {}, 'audit'), ' row. ', how),
    h('div.tools', {}, h('button.btn.primary', { disabled: !connected, onclick: () => audit(noteIn) }, 'Audit'), noteIn),
    la ? h('div', { style: 'margin-top:10px' },
      h('p', {}, la.m.result === 'match' ? badge('match', 'ok') : la.m.result === 'mismatch' ? badge('mismatch', 'err') : badge(la.m.result, 'warn'), ' ',
        la.m.row ? `board #${la.m.row.board_number || '?'}${la.m.row.profile ? ` · profile "${la.m.row.profile}"` : ''} · deployed ${String(la.m.row.timestamp).slice(0, 16).replace('T', ' ')} (matched by ${la.m.by})` : 'no deploy on record for this fox in this browser\'s log'),
      la.m.checks.length ? h('ul.diff', {}, la.m.checks.map(c => h('li', {}, h('span', {}, c.key), h('span.from', {}, String(c.expected)), h('span' + (c.ok ? '.to' : '.err'), {}, String(c.actual) + (c.ok ? ' ✓' : ' ✗'))))) : null) : null);
}

function render() {
  const list = profiles.all(), log = fleet.all();
  const nameIn = h('input', { type: 'text', value: app.cfg.fleet?.profile || '', placeholder: 'Fox 3 — 146.565 — W1ABC/3', style: 'width:100%' });
  const save = () => app.saveProfile(nameIn.value);
  const fileIn = h('input', { type: 'file', accept: 'application/json', hidden: true });
  fileIn.addEventListener('change', async () => { try { const n = profiles.importJson(await fileIn.files[0].text()); app.console.dim(`imported ${n} profile(s)`); render(); } catch (e) { app.console.err('import failed: ' + e.message); } fileIn.value = ''; });
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Profiles ', badge(list.length + ' saved')),
        h('p.hint', {}, 'A profile is the whole form (and any SSTV images) under a name. Programming ten foxes the night before: connect → pick profile → deploy → next.'),
        field('Save current form as', h('div.row', {}, nameIn, h('button.btn', { onclick: save }, 'Save'))),
        h('ul.list', {}, list.map(p => h('li', {},
          h('span.name', {}, p.name), h('span.meta', {}, `${p.template} · ${p.cfg?.id?.callmessage} · ${(p.cfg?.plan?.frequencies_mhz || []).join('/')}`),
          h('button.btn.small', { onclick: async () => { try { app.images = unpackProfileImages(p.images); await app.loadCfg(p.cfg, { source: 'profile' }); app.console.dim(`profile "${p.name}" loaded into the form`); } catch (e) { app.console.err(`profile "${p.name}" could not be loaded: ${e.message || e}`); } } }, 'Load'),
          h('button', { title: 'delete', onclick: () => { if (confirm(`Delete profile "${p.name}"?`)) { profiles.remove(p.name); render(); } } }, '✕')))),
        h('div.tools', {}, h('button.btn.small', { disabled: !list.length, onclick: () => download('fox-bench-profiles.json', profiles.exportJson(), 'application/json') }, 'Export all'), h('button.btn.small', { onclick: () => fileIn.click() }, 'Import'), fileIn)),
      batchCard(app)),
    auditCard(),
    h('div.card', {}, h('h3', {}, 'Fleet log ', badge(log.length + ' rows')),
      h('p.hint', {}, 'Every deploy, flash, export and audit appends a row keyed on the chip UID, which survives reflashing. Same columns as the batch flasher\'s CSV so the two merge.'),
      log.length ? h('div.grid-wrap', {}, h('table.grid', {}, h('thead', {}, h('tr', {}, ['timestamp', '#', 'uid', 'action', 'template', 'profile', 'callsign', 'freq', 'power', 'chip_type', 'result', 'notes'].map(f => h('th', {}, f)))),
        h('tbody', {}, log.slice(-50).reverse().map(r => h('tr', {}, ['timestamp', 'board_number', 'uid', 'action', 'template', 'profile', 'callsign', 'freq', 'power', 'chip_type', 'result', 'notes'].map(f => h('td.mono', {}, f === 'timestamp' ? String(r[f]).slice(0, 19).replace('T', ' ') : f === 'uid' ? String(r[f] || '').slice(-8) : r[f] ?? ''))))))) : null,
      h('div.tools', { style: 'margin-top:8px' }, h('button.btn.small', { disabled: !log.length, onclick: () => download('flash_log.csv', fleet.toCsv(), 'text/csv') }, 'Download CSV'), h('button.btn.small', { disabled: !log.length, onclick: () => { if (confirm('Clear the fleet log in this browser?')) { fleet.clear(); render(); } } }, 'Clear'), h('span.hint', {}, FLEET_FIELDS.length + ' columns in the CSV'))));
}
