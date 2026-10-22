// loaders.js — fetch the repo's descriptors: boards, modules, bands, templates, foxlib — and merge catalog packs.
// SPDX-License-Identifier: GPL-2.0-only
// The page is static, so each directory has an index.json listing its entries.
//
// Catalog packs: another site can own descriptors for its own hardware, targets and templates (a pack is a directory
// with pack.json naming its entries, laid out like this repository: hardware/<id>.json, boards/<id>.json,
// firmware/templates/<id>/{template.json,defaults/<target>.json[,code.py]}, modules/<id>.json). Packs are *data only*:
// a pack's target may name a vendor model, but the model itself must be one of this page's (js/model/vendor/) — the
// page never loads code from a pack. Packs come from ?pack=<url> (one or more, comma-separated) or the saved list
// (localStorage fox-bench.packs); a pack entry with the id of a built-in one replaces it, and every entry remembers
// which pack it came from (_pack) so the page can say so.

const base = new URL('../../', import.meta.url);
const fetchFrom = async (root, path, type = 'json') => {
  const r = await fetch(new URL(path, root), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return type === 'json' ? r.json() : type === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : r.text();
};
const get = (path, type) => fetchFrom(base, path, type);

/** Where each template's files live (its pack's base, or this site), by template id — for defaults and code.py. */
const templateBase = {};
/** Where each target came from (its pack's base), by target id: a pack supplies defaults for its own targets under
 *  firmware/templates/<any template id>/defaults/<target>.json, including for templates it does not re-publish. */
const boardBase = {};

/** Pack URLs in effect: ?pack= first, then the saved list. Each is normalised to end in /. */
export function packUrls() {
  const out = [];
  try { for (const u of new URLSearchParams(location.search).getAll('pack').flatMap(x => x.split(','))) if (u.trim()) out.push(u.trim()); } catch {}
  try { for (const u of JSON.parse(localStorage.getItem('fox-bench.packs') || '[]')) if (typeof u === 'string' && u.trim() && !out.includes(u.trim())) out.push(u.trim()); } catch {}
  return out.map(u => u.endsWith('/') ? u : u + '/');
}
export function savePacks(urls) { try { localStorage.setItem('fox-bench.packs', JSON.stringify(urls)); } catch {} }

export async function loadCatalog() {
  const [boardIds, hwIds, moduleIds, bands, fw] = await Promise.all([get('boards/index.json'), get('hardware/index.json'), get('modules/index.json'), get('bands.json'), get('firmware/index.json')]);
  const hardware = Object.fromEntries(await Promise.all(hwIds.map(async id => [id, await get(`hardware/${id}.json`)])));
  const targets = Object.fromEntries(await Promise.all(boardIds.map(async id => [id, await get(`boards/${id}.json`)])));
  const modules = Object.fromEntries(await Promise.all(moduleIds.map(async id => [id, await get(`modules/${id}.json`)])));
  const templates = Object.fromEntries(await Promise.all(fw.templates.map(async id => { templateBase[id] = base; return [id, await get(`firmware/templates/${id}/template.json`)]; })));
  // packs, in order; later packs win over earlier ones and over the built-ins
  const packs = [];
  for (const url of packUrls()) {
    let root;
    try { root = new URL(url, location.href); } catch { packs.push({ url, error: 'not a URL' }); continue; }
    try {
      const pk = await fetchFrom(root, 'pack.json');
      const name = pk.name || root.host + root.pathname;
      const stamp = o => Object.assign(o, { _pack: name });
      for (const id of pk.hardware || []) hardware[id] = stamp(await fetchFrom(root, `hardware/${id}.json`));
      for (const id of pk.boards || []) {
        const t = stamp(await fetchFrom(root, `boards/${id}.json`));
        // image paths in a pack's target are relative to the pack
        if (t.firmware?.image && !/^https?:/.test(t.firmware.image)) t.firmware.image = new URL(t.firmware.image, root).href;
        if (t.firmware?.build_info && !/^https?:/.test(t.firmware.build_info)) t.firmware.build_info = new URL(t.firmware.build_info, root).href;
        targets[id] = t; boardBase[id] = root;
      }
      for (const id of pk.modules || []) modules[id] = stamp(await fetchFrom(root, `modules/${id}.json`));
      for (const id of pk.templates || []) { templateBase[id] = root; templates[id] = stamp(await fetchFrom(root, `firmware/templates/${id}/template.json`)); }
      packs.push({ url: root.href, name, version: pk.version || '', counts: { hardware: (pk.hardware || []).length, boards: (pk.boards || []).length, templates: (pk.templates || []).length, modules: (pk.modules || []).length } });
    } catch (e) { packs.push({ url: root.href, error: String(e.message || e) }); console.warn('catalog pack not loaded', url, e); }
  }
  // A board entry is a *target*: hardware + firmware + family. Merge the physical facts in so the rest of the page
  // reads one object (board.pins, board.flash, board.notes …); target keys win where both have one.
  const boards = {};
  for (const [id, t] of Object.entries(targets)) {
    const hw = hardware[t.hardware];
    if (!hw) { console.warn(`boards/${id}.json: unknown hardware ${t.hardware} — target skipped`); continue; }
    boards[id] = { ...hw, ...t, flash: { ...hw.flash, ...(t.flash || {}) }, hw };
  }
  const foxlibVersion = (await get('firmware/foxlib/VERSION', 'text')).trim();
  // foxlib-c: the version this site builds (the Board tab compares a connected fox against it); a site without the file has no C targets
  const foxlibcVersion = await get('firmware/foxlib-c/VERSION', 'text').then(t => t.trim()).catch(() => '');
  delete bands._note;
  let songLibraries = [];
  try {
    const idx = await get('songs/index.json');
    songLibraries = await Promise.all(idx.libraries.map(async l => ({ ...l, ...(await get(l.file)) })));
  } catch (e) { console.warn('song libraries not loaded', e); }
  // vendor models (js/model/vendor/<id>.js), loaded once — always this page's own, never a pack's
  const vendors = {};
  for (const b of Object.values(boards)) if (b.vendor && !vendors[b.vendor]) {
    if (!/^[a-z0-9_-]+$/.test(b.vendor)) { console.warn(`board ${b.id}: vendor id ${b.vendor} refused`); continue; }
    try { vendors[b.vendor] = await import(new URL(`./vendor/${b.vendor}.js`, import.meta.url)); } catch (e) { console.warn(`board ${b.id}: no vendor model ${b.vendor} on this page — target skipped`, e); delete boards[b.id]; }
  }
  return { boards, hardware, modules, bands, templates, foxlibFiles: fw.foxlib, foxlibVersion, foxlibcVersion, songLibraries, vendors, packs };
}

export async function loadDefaults(templateId, boardId) {
  const rel = `firmware/templates/${templateId}/defaults/${boardId}.json`;
  const roots = [...new Set([boardBase[boardId], templateBase[templateId], base].filter(Boolean))];
  let err;
  for (const r of roots) { try { return await fetchFrom(r, rel); } catch (e) { err = e; } }
  throw err;
}
export const loadTemplateCode = templateId => fetchFrom(templateBase[templateId] || base, `firmware/templates/${templateId}/code.py`, 'text');
export const loadFoxlibFile = name => get(`firmware/foxlib/${name}`, 'bytes');
