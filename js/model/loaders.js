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
  const [boardIds, moduleIds, bands, fw] = await Promise.all([get('boards/index.json'), get('modules/index.json'), get('bands.json'), get('firmware/index.json')]);
  const boards = Object.fromEntries(await Promise.all(boardIds.map(async id => [id, await get(`boards/${id}.json`)])));
  const modules = Object.fromEntries(await Promise.all(moduleIds.map(async id => [id, await get(`modules/${id}.json`)])));
  const templates = Object.fromEntries(await Promise.all(fw.templates.map(async id => [id, await get(`firmware/templates/${id}/template.json`)])));
  const foxlibVersion = (await get('firmware/foxlib/VERSION', 'text')).trim();
  delete bands._note;
  let songLibraries = [];
  try {
    const idx = await get('songs/index.json');
    songLibraries = await Promise.all(idx.libraries.map(async l => ({ ...l, ...(await get(l.file)) })));
  } catch (e) { console.warn('song libraries not loaded', e); }
  return { boards, modules, bands, templates, foxlibFiles: fw.foxlib, foxlibVersion, songLibraries };
}

export const loadDefaults = (templateId, boardId) => get(`firmware/templates/${templateId}/defaults/${boardId}.json`);
export const loadTemplateCode = templateId => get(`firmware/templates/${templateId}/code.py`, 'text');
export const loadFoxlibFile = name => get(`firmware/foxlib/${name}`, 'bytes');
