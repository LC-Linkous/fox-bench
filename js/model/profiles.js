// profiles.js — saved configs and the fleet log, in localStorage, with import/export.
// SPDX-License-Identifier: GPL-2.0-only

const KEY_P = 'fox-bench.profiles', KEY_F = 'fox-bench.fleet';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const FLEET_FIELDS = ['board_number', 'timestamp', 'uid', 'mac', 'board', 'chip_type', 'revision', 'features', 'crystal', 'usb_mode', 'action', 'template', 'profile', 'callsign', 'freq', 'power', 'seed', 'result', 'notes'];

export const profiles = {
  all: () => read(KEY_P, []),
  save(p) { const all = this.all(); const i = all.findIndex(x => x.name === p.name); const rec = { ...p, saved: new Date().toISOString() }; if (i >= 0) all[i] = rec; else all.push(rec); write(KEY_P, all); return rec; },
  remove(name) { write(KEY_P, this.all().filter(x => x.name !== name)); },
  exportJson() { return JSON.stringify({ kind: 'fox-bench-profiles', version: 1, profiles: this.all() }, null, 2); },
  importJson(text) { const d = JSON.parse(text); const list = Array.isArray(d) ? d : d.profiles; if (!Array.isArray(list)) throw new Error('not a profiles file'); let n = 0; for (const p of list) if (p && p.name && p.cfg) { this.save(p); n++; } return n; },
};

export const fleet = {
  all: () => read(KEY_F, []),
  nextNumber() { return this.all().reduce((m, r) => Math.max(m, +r.board_number || 0), 0) + 1; },
  append(row) { const all = this.all(); all.push({ timestamp: new Date().toISOString(), ...row }); write(KEY_F, all); },
  clear() { write(KEY_F, []); },
  toCsv() {
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [FLEET_FIELDS.join(','), ...this.all().map(r => FLEET_FIELDS.map(f => esc(r[f])).join(','))].join('\n') + '\n';
  },
};

export function download(name, data, type = 'application/octet-stream') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
