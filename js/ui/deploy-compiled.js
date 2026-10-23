// deploy-compiled.js — Deploy tab for the compiled family (RFHS kitsune): no deploy transport (Phase 2). Export the conference
// header block kitsune's build reads, import one, record the fox in the fleet log, save as a profile.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, select, field } from './dom.js';
import { fleet, download } from '../model/profiles.js';

let app, last = null;
export function init(a) { app = a; }
const safe = s => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fox';

function fleetRow(cfg, action, result, notes = '') {
  const v = app.vendor, t = v.TEMPLATES[cfg.template], sec = cfg[t.section] || {};
  const ident = t.section === 'wifi' ? sec.ssid : t.section === 'ble' ? sec.device_name : t.section === 'bt' ? sec.name : 'zigbee';
  const chan = t.section === 'wifi' && t.mode === 'AP' ? `${sec.band === '5' ? '5 GHz' : '2.4 GHz'} ch ${sec.channel || 'random'}` : t.section === 'zigbee' ? `ch ${sec.channel || 'random'}` : '';
  const power = sec.tx_power_dbm != null ? `${sec.tx_power_dbm} dBm` : '';
  return { board_number: '', uid: '', mac: sec.mac || '', board: app.boardId, action, template: `${cfg.template}/${app.template.version}`, profile: cfg.fleet?.profile || '', callsign: ident, freq: chan, power, seed: '', result, challenge: cfg.challenge?.name || '', keyphrase: cfg.challenge?.keyphrase || '', notes };
}

function exportHeader() {
  const cfg = app.validCfg, v = app.vendor;
  const text = v.exportHeader(cfg);
  const name = `${safe(cfg.fleet?.event || 'conference')}-${cfg.template}-${cfg.challenge.tier}.h`;
  download(name, text, 'text/plain');
  fleet.append(fleetRow(cfg, 'export-header', 'header', name));
  last = { ok: true, text: `exported ${name} (${text.length} B)`, header: text };
  app.console.line(`kitsune header block exported: ${name}`, 'ok'); app.changed('deploy');
}

async function importHeader(file, render) {
  const text = await file.text(), v = app.vendor;
  const blocks = v.parseHeader(text);
  if (!blocks.length) { last = { ok: false, text: `${file.name}: no tier block found (expected #if defined(EASY) … #endif as kitsune's headers have)` }; render(); return; }
  const t = v.TEMPLATES[app.templateId];
  // the block for this template's mode, preferring the form's tier; else the first block that fits the mode
  const fits = blocks.filter(b => (t.mode ? b.mode === t.mode : !b.mode));
  if (!fits.length) { last = { ok: false, text: `${file.name}: ${blocks.length} block(s) found, none for ${app.templateId} (${t.mode ? '-D ' + t.mode : 'no mode'}); blocks: ${blocks.map(b => `${b.mode || '-'}/${b.tier}${b.five ? '/5GHz' : ''}`).join(', ')}` }; render(); return; }
  const pick = fits.find(b => b.tier === app.cfg.challenge.tier && (t.section !== 'wifi' || t.mode !== 'AP' || b.five === (app.cfg.wifi.band === '5'))) || fits[0];
  const partial = v.cfgFromBlock(pick, app.templateId);
  const merged = structuredClone(app.cfg);
  for (const [k, val] of Object.entries(partial)) merged[k] = { ...(merged[k] || {}), ...val };
  await app.loadCfg(merged, { source: 'import' });
  last = { ok: true, text: `imported ${file.name}: ${pick.mode || ''}${pick.mode ? ' ' : ''}${pick.tier}${pick.five ? ' 5 GHz' : ''} block — ${Object.keys(pick.values).length} defines${fits.length > 1 ? ` (${fits.length} blocks fit this challenge; the ${pick.tier} one was taken — set the tier first to pick another)` : ''}` };
  app.console.line(last.text, 'ok'); render();
}

export function render(root, render_) {
  const cfg = app.validCfg || app.cfg, v = app.vendor, t = v.TEMPLATES[app.templateId] || {};
  const errs = [...app.report.map(r => ({ level: 'err', key: r.key, msg: r.reason })), ...app.issues];
  const blocking = errs.filter(e => e.level === 'err');
  const fileIn = h('input', { type: 'file', accept: '.h,.txt', hidden: true });
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) importHeader(f, render_); });
  const preview = (() => { try { return v.exportHeader(cfg); } catch (e) { return `// ${e.message}`; } })();
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Checks ', blocking.length ? badge(`${blocking.length} blocking`, 'err') : badge('all pass', 'ok')),
        errs.length ? h('ul', { style: 'margin:0;padding-left:1.2em' }, errs.map(e => h('li', { class: e.level === 'err' ? 'hint err' : e.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, e.key), ' ', e.msg))) : h('p.hint', {}, 'Address rolled, names set, channel and power within what the radio does, a wake long enough for the self-check.'),
        h('p.hint', { style: 'margin-top:8px' }, 'These are the checks kitsune runs at boot (address, channel, SSID read back from the radio) plus what its headers only say in comments. A failed boot check is a red/yellow blinking fox that never transmits.')),
      h('div.card', {}, h('h3', {}, 'Header block'),
        h('p.hint', {}, 'What kitsune\'s build reads: the ', h('code', {}, `${t.mode ? '#if defined(' + t.mode + ') ' : ''}#if defined(${cfg.challenge.tier.toUpperCase()})`), ' block of ', h('code', {}, `${t.project || '?'}/src/conferences/<year><name>.h`), ', with the RFHS_CHALLENGE_NAME / FOX_KEYWORDS lines their report script picks up. Paste it into that file (or replace the tier block there), then build and flash with PlatformIO as kitsune documents.'),
        h('pre.mono', { style: 'white-space:pre-wrap;font-size:.8rem;max-height:320px;overflow:auto' }, preview))),
    h('div.card', {}, h('h3', {}, 'Export / import'),
      h('div.tools', {},
        h('button.btn.primary', { disabled: !!blocking.length, onclick: exportHeader }, 'Export header block (.h)'),
        h('button.btn', { onclick: () => fileIn.click() }, 'Import a kitsune header…'), fileIn,
        blocking.length ? h('span.hint.err', {}, 'Fix the blocking checks above to export.') : h('span.hint', {}, 'Export records an export-header row in the fleet log (address, SSID/name, challenge, key phrase).')),
      last ? h('p.hint' + (last.ok ? '.ok' : '.err'), {}, last.text) : null,
      h('p.hint', {}, h('b', {}, 'Not from this page: '), 'building — the header goes into a kitsune checkout and PlatformIO builds it. Flashing the result is the Board tab\'s firmware card (chip checked first; not yet tried on a real kitsune board). Phase 2 (docs/kitsune-integration-plan.md) writes a per-fox configuration partition so one image serves every fox. kitsune belongs to its authors: ', h('a', { href: v.SOURCE, target: '_blank', rel: 'noopener' }, v.SOURCE), '.')),
    h('div.card', {}, h('h3', {}, 'Save as profile'),
      h('p.hint', {}, 'Keep this fox under a name (Profiles & fleet tab): one profile per fox makes a conference. Saving writes nothing anywhere.'),
      (() => { const nameIn = h('input', { type: 'text', value: cfg.fleet?.profile || '', placeholder: `${cfg.challenge?.name || 'fox'}`, style: 'flex:1;min-width:220px' });
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') app.saveProfile(nameIn.value); });
        const evIn = h('input', { type: 'text', value: cfg.fleet?.event || '', placeholder: 'event, e.g. 2026DEFCON', style: 'min-width:160px' });
        evIn.addEventListener('change', () => { app.cfg.fleet = { ...app.cfg.fleet, event: evIn.value }; app.changed('deploy'); });
        return h('div.tools', {}, nameIn, evIn, h('button.btn', { onclick: () => app.saveProfile(nameIn.value) }, cfg.fleet?.profile ? 'Update profile' : 'Save profile'), cfg.fleet?.profile ? h('span.hint', {}, `current: "${cfg.fleet.profile}"`) : null); })()));
}
