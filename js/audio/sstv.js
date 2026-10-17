// sstv.js — Robot 36 (grayscale) as an event stream; images.bin packing;
// image → 40×240 grayscale; and a time-sampled decoder for the preview.
// Twin of foxlib/sstv.py.
// SPDX-License-Identifier: GPL-2.0-only

export const MODE = { name: 'Robot 36 (grayscale)', vis: 8, lines: 240, sync_ms: 9.0, sync_porch_ms: 3.0, y_ms: 88.0, sep_ms: 4.5, porch_ms: 1.5, chroma_ms: 44.0 };
export const W = 40, H = 240;
const F_SYNC = 1200, F_BLACK = 1500, F_WHITE = 2300, F_LEADER = 1900, F_BIT0 = 1300, F_BIT1 = 1100;
const pixelHz = v => F_BLACK + (F_WHITE - F_BLACK) * v / 255;

function* visEvents(vis = MODE.vis) {
  yield [F_LEADER, 300]; yield [F_SYNC, 10]; yield [F_LEADER, 300]; yield [F_SYNC, 30];
  let ones = 0;
  for (let b = 0; b < 7; b++) { if ((vis >> b) & 1) { ones++; yield [F_BIT1, 30]; } else yield [F_BIT0, 30]; }
  yield [ones % 2 ? F_BIT1 : F_BIT0, 30]; yield [F_SYNC, 30];
}
function* lineEvents(row, n) {
  yield [F_SYNC, MODE.sync_ms]; yield [1500, MODE.sync_porch_ms];
  const px = MODE.y_ms / row.length;
  let v = row[0], run = 1;
  for (let i = 1; i < row.length; i++) { if (row[i] === v) run++; else { yield [pixelHz(v), px * run]; v = row[i]; run = 1; } }
  yield [pixelHz(v), px * run];
  yield [n % 2 === 0 ? 1500 : 2300, MODE.sep_ms]; yield [F_LEADER, MODE.porch_ms]; yield [F_LEADER, MODE.chroma_ms];
}
/** image = { name, width, height, pixels: Uint8Array } */
export function events(image) {
  const out = [...visEvents()];
  for (let line = 0; line < MODE.lines; line++) {
    const row = line < image.height ? image.pixels.subarray(line * image.width, (line + 1) * image.width) : new Uint8Array(image.width);
    out.push(...lineEvents(row, line));
  }
  return out;
}
export const LINE_MS = MODE.sync_ms + MODE.sync_porch_ms + MODE.y_ms + MODE.sep_ms + MODE.porch_ms + MODE.chroma_ms;
export const HEADER_MS = 300 + 10 + 300 + 30 + 7 * 30 + 30 + 30;
export const durationMs = () => HEADER_MS + MODE.lines * LINE_MS;

export function testCard(w = W, h = H) {
  const px = new Uint8Array(w * h), band = Math.floor(h / 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v;
    if (y < band) v = Math.floor(255 * x / (w - 1));
    else if (y < 2 * band) v = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? 255 : 0;
    else { const yy = y - 2 * band, span = h - 2 * band; const d1 = Math.abs(x * span - yy * w), d2 = Math.abs(x * span - (span - yy) * w); v = Math.min(d1, d2) < 2 * span ? 255 : 0; }
    px[y * w + x] = v;
  }
  return { name: 'test_card', width: w, height: h, pixels: px };
}

/** Draw any CanvasImageSource (or text) to a w×h grayscale image. */
export function fromCanvasSource(src, name, { w = W, h = H, invert = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) { const v = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]); px[i] = invert ? 255 - v : v; }
  return { name, width: w, height: h, pixels: px };
}
/** A hint card: lines of text, large, white on black, rendered at 320×240 then downsampled. */
export function textCard(text, name = 'card') {
  const c = document.createElement('canvas'); c.width = 320; c.height = 240;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 320, 240);
  const lines = text.split('\n').filter(l => l.trim()).slice(0, 6);
  const size = Math.min(72, Math.floor(200 / Math.max(1, lines.length)));
  g.fillStyle = '#fff'; g.font = `bold ${size}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l.trim().toUpperCase(), 160, 120 + (i - (lines.length - 1) / 2) * size * 1.15, 300));
  return fromCanvasSource(c, name);
}

export function packImages(images) {
  const name = new TextEncoder();
  const parts = [new Uint8Array([images.length])];
  for (const im of images) { const n = name.encode(im.name.slice(0, 32)); parts.push(new Uint8Array([im.width, im.height, n.length]), n, im.pixels); }
  const len = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function unpackImages(bytes) {
  const dec = new TextDecoder(), out = []; let o = 0; const count = bytes[o++];
  for (let i = 0; i < count; i++) { const w = bytes[o++], h = bytes[o++], nl = bytes[o++]; const nm = dec.decode(bytes.subarray(o, o + nl)); o += nl; out.push({ name: nm, width: w, height: h, pixels: bytes.slice(o, o + w * h) }); o += w * h; }
  return out;
}

/**
 * Time-sampled decode: what a hunter's app shows. Flattens the event stream
 * into frequency-vs-time, then samples each line at 320 points across the
 * luminance scan. Renders at the mode's geometry (chunky 40-px source).
 */
export function decodeToCanvas(evs, canvas, { cols = 320 } = {}) {
  const t = [], f = []; let acc = 0;
  for (const [hz, ms] of evs) { t.push(acc); f.push(hz); acc += ms; }
  const freqAt = ms => { let lo = 0, hi = t.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= ms) lo = mid; else hi = mid - 1; } return f[lo]; };
  canvas.width = cols; canvas.height = MODE.lines;
  const g = canvas.getContext('2d'), img = g.createImageData(cols, MODE.lines);
  for (let line = 0; line < MODE.lines; line++) {
    const start = HEADER_MS + line * LINE_MS + MODE.sync_ms + MODE.sync_porch_ms;
    for (let x = 0; x < cols; x++) {
      const hz = freqAt(start + (x + 0.5) * MODE.y_ms / cols);
      const v = Math.max(0, Math.min(255, Math.round((hz - F_BLACK) / (F_WHITE - F_BLACK) * 255)));
      const i = (line * cols + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
