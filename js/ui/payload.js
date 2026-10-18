// payload.js — Payload tab: songs (built-ins, RTTTL, playlist), SSTV images, QRSS; full-transmission preview.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select, numInput, check, fill } from './dom.js';
import * as morse from '../audio/morse.js';
import * as melody from '../audio/melody.js';
import * as rtttl from '../audio/rtttl.js';
import * as sstv from '../audio/sstv.js';
import { Player, drawTrace, drawWaterfall } from '../audio/player.js';
import { fmtDuration } from '../model/airtime.js';
import * as spectrum from '../audio/spectrum.js';

let app, root; const player = new Player();
export function init(a, el) { app = a; root = el; app.listeners.add(render); render('boot'); }

const KINDS = { songs: 'Songs (Morse ID, then a tune)', sstv: 'SSTV image (Morse ID, then a Robot 36 picture)', none: 'Morse only / QRSS (slow Morse for waterfall copy)' };
const kindsForTemplate = () => { const s = app.template.sections; return s.includes('payload.*') ? Object.keys(KINDS) : Object.keys(KINDS).filter(k => s.includes('payload.' + k)); };

function setKind(kind) {
  const p = app.cfg.payload; if (p.kind === kind) return;
  app.cfg.payload = kind === 'songs' ? { kind, articulation: 0.875, skip_on_low_battery: true, playlist: [firstQuickSong()] }
    : kind === 'sstv' ? { kind, mode: 'robot36-gray', images_file: 'images.bin', skip_on_low_battery: true }
    : { kind, dit_s: 3.0, message: null };
  if (kind === 'sstv' && !app.images.length) app.images = [sstv.testCard()];
  app.changed('payload');
}

/** The whole transmission as events: ID, gap, payload item i. */
/** One transmission (rotation item i), or every item in order when i === 'all'. Also returns segment markers. */
export function transmissionEvents(i = 0) {
  const cfg = app.cfg, d = cfg.id, p = cfg.payload;
  const idText = d.callmessage + (d.telemetry.includes('batt') && cfg.pins.batt_sense ? ' BAT 3V7' : '');
  const evs = [], segs = [];
  const dur = e => e.reduce((a, [, ms]) => a + ms, 0);
  const push = (label, e) => { segs.push({ t: dur(evs), label }); evs.push(...e); };
  const n = p.kind === 'songs' ? p.playlist.length : p.kind === 'sstv' ? app.images.length : 1;
  const items = i === 'all' ? [...Array(Math.max(1, n)).keys()] : [i];
  items.forEach((k, idx) => {
    if (idx > 0) push('(wait)', [[0, 1500]]);                 // the schedule gap, compressed to 1.5 s for the trace
    evs.push([0, 750]);
    if (p.kind === 'none') { push('ID', morse.events(p.message || idText, { wpm: d.wpm, toneHz: d.tone_hz, ditMs: p.dit_s ? p.dit_s * 1000 : null })); return; }
    push('ID', morse.events(idText, { wpm: d.wpm, toneHz: d.tone_hz })); evs.push([0, 750]);
    if (p.kind === 'songs' && p.playlist[k]) push(p.playlist[k].name, melody.events(p.playlist[k], p.articulation));
    if (p.kind === 'sstv' && app.images[k]) push(app.images[k].name, sstv.events(app.images[k]));
    if (cfg.plan.frequencies_mhz.length > 1 && cfg.plan.announce_qsy) { const nf = cfg.plan.frequencies_mhz[(idx + 1) % cfg.plan.frequencies_mhz.length]; evs.push([0, 750]); push('QSY', morse.events(`QSY ${nf.toFixed(3)}`, { wpm: d.wpm, toneHz: d.tone_hz })); }
  });
  evs.segments = segs;
  return evs;
}

let previewBox;
let devOverride = (() => { try { return JSON.parse(localStorage.getItem('fox-bench.deviationHz')); } catch { return null; } })();
let freqIdx = 0, floorSel = 'auto';
const nominalDeviation = () => (app.cfg.radio.bandwidth_khz <= 18.75 ? 2500 : 5000);

function spectrumPanel(evs) {
  const r = app.cfg.radio, bw = r.bandwidth_khz, dev = devOverride ?? nominalDeviation();
  const freqs = app.cfg.plan.frequencies_mhz; if (freqIdx >= freqs.length) freqIdx = 0;
  const est = spectrum.estimate(evs, { deviationHz: dev });
  const outside = spectrum.outsideFraction(est, bw * 1000);
  const canvas = h('canvas.preview', { style: 'height:190px' });
  const devIn = numInput(dev / 1000, { min: 0.3, max: 10, step: 0.1, width: '90px', onchange: v => { devOverride = Math.round(v * 1000); try { localStorage.setItem('fox-bench.deviationHz', JSON.stringify(devOverride)); } catch {} renderPreview(lastItem); } });
  requestAnimationFrame(() => spectrum.drawSpectrum(canvas, est, { carrierMhz: freqs[freqIdx] || 0, bwKhz: bw, deviationHz: dev, floorDb: floorSel === 'auto' ? null : +floorSel }));
  return h('div', { style: 'margin-top:14px' },
    h('div.tools', { style: 'margin-bottom:6px' },
      h('b', {}, 'RF spectrum (estimate)'),
      freqs.length > 1 ? select(freqs.map((f, k) => [k, f.toFixed(4) + ' MHz']), freqIdx, v => { freqIdx = +v; renderPreview(lastItem); }) : null,
      h('span.suffix', {}, 'deviation ±'), devIn, h('span.suffix', {}, 'kHz'),
      devOverride != null ? h('button.btn.small', { onclick: () => { devOverride = null; try { localStorage.removeItem('fox-bench.deviationHz'); } catch {} renderPreview(lastItem); } }, 'nominal') : null,
      h('span.suffix', {}, 'floor'), select([['auto', 'auto'], ['-60', '−60 dB'], ['-90', '−90 dB'], ['-120', '−120 dB']], floorSel, v => { floorSel = v; renderPreview(lastItem); }),
      badge(`Carson ${(est.carsonHz / 1000).toFixed(1)} kHz`, est.carsonHz <= bw * 1000 ? 'ok' : 'warn'),
      badge(`${(outside * 100).toFixed(1)} % outside ${bw} kHz`, outside < 0.01 ? 'ok' : outside < 0.05 ? 'warn' : 'err')),
    h('div.screen', {}, canvas),
    h('p.hint', {}, 'Narrowband-FM sidebands (Bessel) for every tone in the transmission, weighted by airtime, with the square-wave 3rd/5th harmonics after a ~3 kHz mic low-pass. Amber band = intended channel; grey = adjacent channels; red lines = energy outside the channel. The module\'s real deviation depends on the PWM level into MIC — set the measured value here; it is remembered in this browser, not in fox.json.'));
}

let lastItem = 0, previewBusy = false, previewPending = null, zoom = 'fit';   // 'fit' | px per second
function renderPreview(i = 0) {
  if (previewBusy) { previewPending = i; return; }          // a change event can fire mid-render; coalesce
  previewBusy = true;
  try { _renderPreview(i); } finally { previewBusy = false; }
  if (previewPending != null) { const k = previewPending; previewPending = null; renderPreview(k); }
}
function _renderPreview(i = 0) {
  lastItem = i;
  const p = app.cfg.payload, evs = transmissionEvents(i), total = evs.reduce((a, [, ms]) => a + ms, 0);
  const trace = h('canvas.preview', { style: 'height:110px' });
  const scroller = h('div.screen', { style: 'overflow-x:auto;overflow-y:hidden' }, trace);
  const zoomSel = select([['fit', 'fit'], ['20', '20 px/s'], ['50', '50 px/s'], ['200', '200 px/s'], ['1000', '1000 px/s']], zoom, v => { zoom = v; renderPreview(lastItem); });
  const prog = h('progress', { max: 1, value: 0, style: 'width:100%;height:6px;display:block;margin-top:6px' });
  const btn = h('button.btn.primary', { onclick: () => {
    if (player.playing) { player.stop(); btn.textContent = 'Preview transmission'; btn.classList.remove('running'); return; }
    const speed = p.kind === 'none' && p.dit_s > 0.3 ? 10 : 1;
    player.onProgress = (f) => { prog.value = f; }; player.onDone = () => { btn.textContent = 'Preview transmission'; btn.classList.remove('running'); prog.value = 0; };
    player.play(evs, { speed }); btn.textContent = speed > 1 ? `Stop (playing at ${speed}×)` : 'Stop'; btn.classList.add('running');
  } }, 'Preview transmission');
  const waveSel = select([['square', 'square (like the PWM)'], ['sine', 'sine (easier on the ears)']], player.wave, v => { player.wave = v; });
  const items = p.kind === 'songs' ? p.playlist.map((s, k) => [k, s.name]) : p.kind === 'sstv' ? app.images.map((im, k) => [k, im.name]) : [];
  if (items.length > 1) items.push(['all', `whole rotation (${items.length} transmissions)`]);
  const decodeImages = p.kind === 'sstv' ? (i === 'all' ? app.images : app.images[i] ? [app.images[i]] : []) : [];
  const decodes = decodeImages.map(() => h('canvas', { style: 'width:320px;height:240px;max-width:100%;image-rendering:pixelated;border:1px solid var(--edge);display:block' }));
  const decode = decodes.length ? h('div', { style: 'display:flex;gap:10px;overflow-x:auto;margin-top:8px' }, decodes.map((c, k) => h('div', {}, c, h('p.hint', { style: 'margin:2px 0 0' }, decodeImages[k].name)))) : null;
  fill(previewBox, 
    h('h3', {}, 'Preview ', badge(fmtDuration(total) + ' keydown', total > 60000 ? 'warn' : '')),
    items.length > 1 ? h('div.tools', {}, field('Item', select(items, i, v => renderPreview(v === 'all' ? 'all' : +v))), field('Trace zoom', zoomSel)) : field('Trace zoom', zoomSel),
    scroller, prog,
    h('div.tools', { style: 'margin-top:10px' }, btn, waveSel, h('span.hint', {}, p.kind === 'none' && p.dit_s > 0.3 ? 'QRSS plays sped up 10× in the preview; the trace shows real proportions.' : 'ID, payload' + (app.cfg.plan.announce_qsy && app.cfg.plan.frequencies_mhz.length > 1 ? ', QSY announcement' : '') + ' — exactly the event stream the fox plays.')),
    decode ? h('div', {}, h('p.hint', { style: 'margin-top:10px' }, 'What a hunter\'s SSTV app shows (time-sampled decode of the event stream above; the 40-pixel source is why it is chunky):'), decode) : null,
    spectrumPanel(evs));
  requestAnimationFrame(() => {
    const fitW = scroller.clientWidth || 600;
    const wantW = zoom === 'fit' ? fitW : Math.max(fitW, Math.round(total / 1000 * +zoom));
    trace.style.width = wantW + 'px';
    (p.kind === 'none' && p.dit_s > 0.3 ? drawWaterfall : drawTrace)(trace, evs, { segments: evs.segments });
    decodes.forEach((c, k) => sstv.decodeToCanvas(sstv.events(decodeImages[k]), c));
  });
}

// ---- song libraries: repo-provided (songs/index.json) plus any loaded from disk this session
const localLibs = [];
let libSel = null, libQuery = '', libBox = null;
const allLibs = () => [...(app.catalog.songLibraries || []), ...localLibs];
const quickSongs = () => { const q = allLibs().flatMap(l => l.songs.filter(s => s.quick)); return q.length ? q : melody.BUILTIN; };
export const firstQuickSong = () => structuredClone(quickSongs()[0] || melody.BUILTIN[0]);
const cleanSong = s => ({ name: s.name, tempo: s.tempo, notes: s.notes.map(n => [n[0], n[1]]) });

/** Parse a library file: our JSON shape, a bare array of songs, or a text file of RTTTL lines. */
function parseLibrary(text, filename) {
  try {
    const j = JSON.parse(text);
    const songs = Array.isArray(j) ? j : j.songs;
    if (!Array.isArray(songs)) throw new Error('no songs array');
    return { id: 'local:' + filename, name: j.name || filename, notes: j.notes || '', songs: songs.filter(x => x && x.name && x.tempo && Array.isArray(x.notes)) };
  } catch (e) {
    const songs = [], errs = [];
    for (const line of text.split(/\r?\n/)) { const l = line.trim(); if (!l || l.startsWith('#')) continue; try { songs.push(rtttl.parse(l)); } catch (x) { errs.push(x.message); } }
    if (!songs.length) throw new Error('not a song library (JSON) or RTTTL text' + (errs.length ? ': ' + errs[0] : ''));
    return { id: 'local:' + filename, name: filename, notes: `${songs.length} RTTTL lines${errs.length ? `, ${errs.length} skipped` : ''}`, songs };
  }
}

function libraryCard() {
  const p = app.cfg.payload, libs = allLibs();
  if (libSel == null || !libs.find(l => l.id === libSel)) libSel = libs[0]?.id ?? null;
  const lib = libs.find(l => l.id === libSel);
  const q = libQuery.toLowerCase();
  const rows = (lib?.songs || []).filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 60);
  const search = h('input', { type: 'text', value: libQuery, placeholder: 'filter…', style: 'width:140px' });
  search.addEventListener('input', () => { libQuery = search.value; render('library'); });
  const fileIn = h('input', { type: 'file', accept: '.json,.txt,.rtttl,application/json,text/plain', hidden: true, multiple: true });
  fileIn.addEventListener('change', async () => { for (const f of fileIn.files) { try { const l = parseLibrary(await f.text(), f.name.replace(/\.[^.]+$/, '')); localLibs.push(l); libSel = l.id; app.console.dim(`library "${l.name}": ${l.songs.length} songs`); } catch (e) { app.console.err(`${f.name}: ${e.message}`); } } fileIn.value = ''; render('library'); });
  const exportPlaylist = () => { const data = { name: 'My fox songs', notes: 'exported from fox-bench', songs: p.playlist.map(cleanSong) }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = 'songs.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); };
  return h('div.card', {}, h('h3', {}, 'Song library'),
    h('div.tools', { style: 'margin-bottom:8px' }, h('span.hint', {}, 'Quick add:'), quickSongs().map(s => h('button.btn.small', { onclick: () => { p.playlist.push(cleanSong(s)); app.changed('payload'); } }, s.name))),
    libs.length ? h('div.tools', { style: 'margin:10px 0 6px' },
      select(libs.map(l => [l.id, `${l.name} (${l.songs.length})`]), libSel, v => { libSel = v; libQuery = ''; render('library'); }), search,
      h('button.btn.small', { onclick: () => fileIn.click() }, 'Load library file…'), fileIn) : h('p.hint', {}, 'No song libraries found in songs/.'),
    lib?.notes ? h('p.hint', {}, lib.notes) : null,
    rows.length ? h('ul.list', { style: 'max-height:260px;overflow:auto' }, rows.map(s => h('li', {},
      h('span.name', {}, s.name), h('span.meta', {}, `${s.tempo} bpm · ${fmtDuration(melody.durationMs(s, p.articulation))}`),
      h('button', { title: 'play', onclick: () => player.play(melody.events(s, p.articulation)) }, '▶'),
      h('button.btn.small', { onclick: () => { p.playlist.push(cleanSong(s)); app.changed('payload'); } }, '+ add')))) : h('p.hint', {}, 'No songs match.'),
    h('p.hint', { style: 'margin-top:8px' }, 'A library is a JSON file ({ name, songs: [{ name, tempo, notes }] }) or a text file with one RTTTL per line. Loaded files stay in this browser session only; to make one permanent, drop it in ', h('code', {}, 'songs/'), ' and list it in ', h('code', {}, 'songs/index.json'), '. ', h('button.btn.small', { onclick: exportPlaylist }, 'Export playlist as a library')));
}

function songsCard() {
  const p = app.cfg.payload;
  const rt = h('textarea', { rows: 3, placeholder: 'Paste RTTTL here, e.g.  Scale:d=4,o=5,b=120:8c,8d,8e,8f,8g,8a,8b,c6', spellcheck: 'false' });
  const rtErr = h('p.hint');
  const addRt = () => { try { p.playlist.push(rtttl.parse(rt.value)); rt.value = ''; rtErr.textContent = ''; app.changed('payload'); } catch (e) { rtErr.className = 'hint err'; rtErr.textContent = e.message; } };
  return h('div', {}, h('div.card', {}, h('h3', {}, 'Playlist ', badge(`${p.playlist.length} song${p.playlist.length === 1 ? '' : 's'}`)),
    h('ul.list', {}, p.playlist.map((s, i) => h('li', {},
      h('span.name', {}, s.name), h('span.meta', {}, `${s.notes.length} notes · ${s.tempo} bpm · ${fmtDuration(melody.durationMs(s, p.articulation))}`),
      h('button', { title: 'play', onclick: () => player.play(melody.events(s, p.articulation)) }, '▶'),
      h('button', { title: 'copy as RTTTL', onclick: () => navigator.clipboard?.writeText(rtttl.format(s)) }, '⎘'),
      i > 0 ? h('button', { title: 'move up', onclick: () => { [p.playlist[i - 1], p.playlist[i]] = [p.playlist[i], p.playlist[i - 1]]; app.changed('payload'); } }, '↑') : null,
      p.playlist.length > 1 ? h('button', { title: 'remove', onclick: () => { p.playlist.splice(i, 1); app.changed('payload'); } }, '✕') : null))),
    h('p.hint', {}, 'One song per transmission, in order, wrapping. Songs are stored in fox.json as (MIDI note, 32nds) pairs with a tempo; keep them public-domain if you publish the config.'),
    field('Add from RTTTL', rt), h('div.tools', {}, h('button.btn.small', { onclick: addRt }, 'Add song'), rtErr),
    h('div.two-col', { style: 'margin-top:10px' },
      field('Articulation', numInput(p.articulation, { min: 0.5, max: 1, step: 0.025, onchange: v => { p.articulation = v; app.changed('payload'); } }), 'fraction of each note that sounds; lower = more staccato'),
      h('div.field', {}, h('label', {}, 'Low battery'), check('Skip the song, send the ID only', p.skip_on_low_battery, v => { p.skip_on_low_battery = v; app.changed('payload'); })))),
    (libBox = h('div', {}, libraryCard())));
}

function sstvCard() {
  const p = app.cfg.payload;
  const drop = h('div.drop', {}, 'Drop a PNG/JPG here or click to choose. It becomes a 40×240 grayscale image (~37 s on air).');
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const addImage = f => { const img = new Image(); img.onload = () => { app.images.push(sstv.fromCanvasSource(img, f.name.replace(/\.[^.]+$/, '').slice(0, 24))); URL.revokeObjectURL(img.src); app.changed('payload'); }; img.src = URL.createObjectURL(f); };
  drop.addEventListener('click', () => file.click()); file.addEventListener('change', () => { for (const f of file.files) addImage(f); file.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); for (const f of e.dataTransfer.files) if (f.type.startsWith('image/')) addImage(f); });
  const card = h('textarea', { rows: 3, placeholder: 'HINT CARD\nLOOK UP\nNEAR TREE', spellcheck: 'false' });
  return h('div.card', {}, h('h3', {}, 'Images ', badge(`${app.images.length} image${app.images.length === 1 ? '' : 's'}`)),
    h('ul.list', {}, app.images.map((im, i) => { const c = h('canvas', { width: im.width, height: im.height, style: 'width:40px;height:60px;image-rendering:pixelated;border:1px solid var(--edge)' }); const g = c.getContext('2d'), id = g.createImageData(im.width, im.height); for (let k = 0; k < im.pixels.length; k++) { id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = im.pixels[k]; id.data[k * 4 + 3] = 255; } g.putImageData(id, 0, 0);
      return h('li', {}, c, h('span.name', {}, im.name), h('span.meta', {}, `${im.width}×${im.height}`), i > 0 ? h('button', { onclick: () => { [app.images[i - 1], app.images[i]] = [app.images[i], app.images[i - 1]]; app.changed('payload'); } }, '↑') : null, h('button', { title: app.images.length > 1 ? 'remove' : 'remove (the test card takes its place)', onclick: () => { app.images.splice(i, 1); app.changed('payload'); } }, '✕')); })),
    drop, file,
    field('Or a text card', card), h('div.tools', {}, h('button.btn.small', { onclick: () => { if (card.value.trim()) { app.images.push(sstv.textCard(card.value, card.value.split('\n')[0].slice(0, 24) || 'card')); card.value = ''; app.changed('payload'); } } }, 'Add card'), h('button.btn.small', { onclick: () => { app.images.push(sstv.testCard()); app.changed('payload'); } }, 'Add test card')),
    h('p.hint', { style: 'margin-top:10px' }, 'Images travel as ', h('code', {}, 'images.bin'), ' next to fox.json (count, then width/height/name/pixels per image). Robot 36 grayscale at 40 px per line: airtime is fixed by the mode, not the picture.'),
    check('Skip the image on low battery, send the ID only', p.skip_on_low_battery, v => { p.skip_on_low_battery = v; app.changed('payload'); }));
}

function qrssCard() {
  const p = app.cfg.payload;
  const msg = h('input', { type: 'text', value: p.message || '', placeholder: '(empty = the normal ID)', style: 'width:100%;text-transform:uppercase' });
  msg.addEventListener('change', () => { p.message = msg.value.trim().toUpperCase() || null; app.changed('payload'); });
  return h('div.card', {}, h('h3', {}, 'Slow Morse'),
    field('Dit length (seconds)', numInput(p.dit_s ?? 0.1, { min: 0.05, max: 30, step: 0.5, onchange: v => { p.dit_s = v; app.changed('payload'); } }), 'Multi-second dits are read on a waterfall over minutes, not by ear. At 3 s the full ID keys for about 18 minutes. Leave at the WPM-derived value (0.1 s at 12 WPM) for a plain Morse-only fox.'),
    field('Message override', msg, 'Must still carry your callsign.'),
    h('p.hint', {}, 'No upper bound here by design; use Deploy → keydown limit if you want one.'));
}

function render(source) {
  if (app.cfg.payload.kind === 'sstv' && !app.images.length) app.images = [sstv.testCard()];   // never an empty rotation
  if (source === 'theme') { renderPreview(); return; }
  if (source === 'library') { if (libBox) { fill(libBox, libraryCard()); const i = libBox.querySelector('input[type=text]'); if (i && libQuery) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } return; }
  const p = app.cfg.payload, kinds = kindsForTemplate();
  previewBox = h('div.card');
  fill(root, 
    h('div.card', {}, field('Payload kind', select(kinds.map(k => [k, KINDS[k]]), p.kind, setKind), kinds.length === 1 ? `The ${app.template.name} template reads only this kind. Switch template on the Connect tab for others, or use composite.` : 'Composite template: any kind.')),
    h('div.cols', {}, p.kind === 'songs' ? songsCard() : p.kind === 'sstv' ? sstvCard() : qrssCard(), previewBox));
  renderPreview(0);
}
export function shown() { renderPreview(0); }
