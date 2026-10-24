// profiles.js — saved configs and the fleet log, in localStorage, with import/export.
// SPDX-License-Identifier: GPL-2.0-only

const KEY_P = 'fox-bench.profiles', KEY_F = 'fox-bench.fleet';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
/** Storage failures (quota, private mode, blocked site data) throw a readable error: a silent catch here turned into
 *  "profile saved" and fleet rows that never existed. Callers surface it. */
export class StorageError extends Error {}
const write = (k, v) => {
  let text; try { text = JSON.stringify(v); } catch (e) { throw new StorageError(`could not serialise ${k}: ${e.message || e}`); }
  try { localStorage.setItem(k, text); }
  catch (e) { throw new StorageError(`browser storage refused ${k} (${(text.length / 1024).toFixed(0)} kB): ${e.name === 'QuotaExceededError' || /quota/i.test(String(e)) ? 'storage is full — delete old profiles (SSTV images are the big ones) or export and clear the fleet log' : (e.message || e)}`); }
};
/** Pixel arrays as base64 in storage (a third of the JSON number list); read back either form. */
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const packProfileImages = images => (images || []).map(im => ({ ...im, pixels: im.pixels instanceof Uint8Array ? b64(im.pixels) : Array.isArray(im.pixels) ? b64(Uint8Array.from(im.pixels)) : im.pixels }));
export const unpackProfileImages = images => (images || []).map(im => ({ ...im, pixels: typeof im.pixels === 'string' ? unb64(im.pixels) : Uint8Array.from(im.pixels || []) }));

export const FLEET_FIELDS = ['board_number', 'timestamp', 'uid', 'mac', 'board', 'chip_type', 'revision', 'features', 'crystal', 'usb_mode', 'action', 'template', 'profile', 'callsign', 'freq', 'power', 'seed', 'result', 'challenge', 'keyphrase', 'notes'];   // challenge/keyphrase: the compiled family's (kitsune) sheet fields

export const profiles = {
  all: () => read(KEY_P, []),
  save(p) { const all = this.all(); const i = all.findIndex(x => x.name === p.name); const rec = { ...p, images: packProfileImages(p.images), saved: new Date().toISOString() }; if (i >= 0) all[i] = rec; else all.push(rec); write(KEY_P, all); return rec; },
  remove(name) { write(KEY_P, this.all().filter(x => x.name !== name)); },
  exportJson() { return JSON.stringify({ kind: 'fox-bench-profiles', version: 1, profiles: this.all() }, null, 2); },
  importJson(text) { const d = JSON.parse(text); const list = Array.isArray(d) ? d : d.profiles; if (!Array.isArray(list)) throw new Error('not a profiles file'); let n = 0; for (const p of list) if (p && p.name && p.cfg) { this.save(p); n++; } return n; },
};

export const fleet = {
  all: () => read(KEY_F, []),
  nextNumber() { return this.all().reduce((m, r) => Math.max(m, +r.board_number || 0), 0) + 1; },
  /** onError: set by the page to a console reporter; without one the error propagates. */
  onError: null,
  append(row) { const all = this.all(); all.push({ timestamp: new Date().toISOString(), ...row }); try { write(KEY_F, all); } catch (e) { if (this.onError) this.onError(`fleet row NOT recorded (${row.action}): ${e.message || e}`); else throw e; } },
  clear() { write(KEY_F, []); },
  toCsv() {
    // a cell beginning with = + - @ (or a tab/CR) is a formula to Excel/Sheets — banner text and notes reach this file —
    // so it is prefixed with an apostrophe unless it is a plain number
    const esc = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [FLEET_FIELDS.join(','), ...this.all().map(r => FLEET_FIELDS.map(f => esc(r[f])).join(','))].join('\n') + '\n';
  },
};

export function download(name, data, type = 'application/octet-stream') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
