// fleet.js — Profiles (named configs) and the fleet log.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field } from './dom.js';
import { profiles, fleet, download, FLEET_FIELDS } from '../model/profiles.js';
import { batchCard, onChange as onFlashChange } from './flash.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); onFlashChange(render); render(); }

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
          h('button.btn.small', { onclick: async () => { app.images = (p.images || []).map(im => ({ ...im, pixels: Uint8Array.from(im.pixels) })); await app.loadCfg(p.cfg, { source: 'profile' }); app.console.dim(`profile "${p.name}" loaded into the form`); } }, 'Load'),
          h('button', { title: 'delete', onclick: () => { if (confirm(`Delete profile "${p.name}"?`)) { profiles.remove(p.name); render(); } } }, '✕')))),
        h('div.tools', {}, h('button.btn.small', { disabled: !list.length, onclick: () => download('fox-bench-profiles.json', profiles.exportJson(), 'application/json') }, 'Export all'), h('button.btn.small', { onclick: () => fileIn.click() }, 'Import'), fileIn)),
      batchCard(app)),
    h('div.card', {}, h('h3', {}, 'Fleet log ', badge(log.length + ' rows')),
      h('p.hint', {}, 'Every deploy appends a row keyed on the chip UID, which survives reflashing. Same columns as the batch flasher\'s CSV so the two merge.'),
      log.length ? h('div.grid-wrap', {}, h('table.grid', {}, h('thead', {}, h('tr', {}, ['timestamp', '#', 'uid', 'action', 'template', 'profile', 'callsign', 'freq', 'power', 'chip_type', 'result', 'notes'].map(f => h('th', {}, f)))),
        h('tbody', {}, log.slice(-50).reverse().map(r => h('tr', {}, ['timestamp', 'board_number', 'uid', 'action', 'template', 'profile', 'callsign', 'freq', 'power', 'chip_type', 'result', 'notes'].map(f => h('td.mono', {}, f === 'timestamp' ? String(r[f]).slice(0, 19).replace('T', ' ') : f === 'uid' ? String(r[f] || '').slice(-8) : r[f] ?? ''))))))) : null,
      h('div.tools', { style: 'margin-top:8px' }, h('button.btn.small', { disabled: !log.length, onclick: () => download('flash_log.csv', fleet.toCsv(), 'text/csv') }, 'Download CSV'), h('button.btn.small', { disabled: !log.length, onclick: () => { if (confirm('Clear the fleet log in this browser?')) { fleet.clear(); render(); } } }, 'Clear'), h('span.hint', {}, FLEET_FIELDS.length + ' columns in the CSV'))));
}
