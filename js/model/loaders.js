// loaders.js — fetch the repo's descriptors: boards, modules, bands, templates, foxlib.
// SPDX-License-Identifier: GPL-2.0-only
// The page is static, so each directory has an index.json listing its entries.

const base = new URL('../../', import.meta.url);
const get = async (path, type = 'json') => {
  const r = await fetch(new URL(path, base), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return type === 'json' ? r.json() : type === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : r.text();
};

export async function loadCatalog() {
  const [boardIds, hwIds, moduleIds, bands, fw] = await Promise.all([get('boards/index.json'), get('hardware/index.json'), get('modules/index.json'), get('bands.json'), get('firmware/index.json')]);
  const hardware = Object.fromEntries(await Promise.all(hwIds.map(async id => [id, await get(`hardware/${id}.json`)])));
  // A board entry is a *target*: hardware + firmware + family. Merge the physical facts in so the rest of the page
  // reads one object (board.pins, board.flash, board.notes …); target keys win where both have one.
  const boards = Object.fromEntries(await Promise.all(boardIds.map(async id => {
    const t = await get(`boards/${id}.json`), hw = hardware[t.hardware];
    if (!hw) throw new Error(`boards/${id}.json: unknown hardware ${t.hardware}`);
    return [id, { ...hw, ...t, flash: { ...hw.flash, ...(t.flash || {}) }, hw }];
  })));
  const modules = Object.fromEntries(await Promise.all(moduleIds.map(async id => [id, await get(`modules/${id}.json`)])));
  const templates = Object.fromEntries(await Promise.all(fw.templates.map(async id => [id, await get(`firmware/templates/${id}/template.json`)])));
  const foxlibVersion = (await get('firmware/foxlib/VERSION', 'text')).trim();
  // foxlib-c: the version this site builds (the Board tab compares a connected fox against it); a site without the file has no C targets
  const foxlibcVersion = await get('firmware/foxlib-c/VERSION', 'text').then(t => t.trim()).catch(() => '');
  delete bands._note;
  let songLibraries = [];
  try {
    const idx = await get('songs/index.json');
    songLibraries = await Promise.all(idx.libraries.map(async l => ({ ...l, ...(await get(l.file)) })));
  } catch (e) { console.warn('song libraries not loaded', e); }
  // vendor models for drive-configured boards (js/model/vendor/<id>.js), loaded once
  const vendors = {};
  for (const b of Object.values(boards)) if (b.vendor && !vendors[b.vendor]) vendors[b.vendor] = await import(new URL(`./vendor/${b.vendor}.js`, import.meta.url));
  return { boards, hardware, modules, bands, templates, foxlibFiles: fw.foxlib, foxlibVersion, foxlibcVersion, songLibraries, vendors };
}

export const loadDefaults = (templateId, boardId) => get(`firmware/templates/${templateId}/defaults/${boardId}.json`);
export const loadTemplateCode = templateId => get(`firmware/templates/${templateId}/code.py`, 'text');
export const loadFoxlibFile = name => get(`firmware/foxlib/${name}`, 'bytes');
