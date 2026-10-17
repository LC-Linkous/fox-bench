// rtttl.js — RTTTL ringtone text ⇄ song dict.
// SPDX-License-Identifier: GPL-2.0-only
// "name:d=4,o=5,b=140:8c,8d,8e,4f,p,2g." → { name, tempo, notes: [[midi, dur32], …] }

const SEMI = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11, h: 11 };

export function parse(text) {
  const parts = text.trim().split(':');
  if (parts.length < 3) throw new Error('RTTTL needs name:defaults:notes');
  const name = parts[0].trim() || 'untitled';
  const defs = { d: 4, o: 5, b: 63 };
  for (const kv of parts[1].split(',')) { const [k, v] = kv.split('=').map(s => s.trim().toLowerCase()); if (k in defs && v) defs[k] = parseInt(v, 10); }
  const notes = [];
  for (const raw of parts.slice(2).join(':').split(',')) {
    const tok = raw.trim().toLowerCase(); if (!tok) continue;
    const m = tok.match(/^(\d+)?([a-hp]#?)(\.)?(\d)?(\.)?$/);
    if (!m) throw new Error(`bad note "${raw.trim()}"`);
    const dur = parseInt(m[1] || defs.d, 10), pitch = m[2], dotted = !!(m[3] || m[5]), oct = parseInt(m[4] || defs.o, 10);
    let d32 = Math.round(32 / dur); if (dotted) d32 = Math.round(d32 * 1.5);
    if (pitch === 'p') notes.push([0, d32]);
    else notes.push([12 * (oct + 1) + SEMI[pitch], d32]);
  }
  if (!notes.length) throw new Error('no notes');
  return { name, tempo: defs.b, notes };
}

export function format(song) {
  const dur = d32 => { for (const [d, v] of [[1, 32], [2, 16], [4, 8], [8, 4], [16, 2], [32, 1]]) { if (d32 === v) return String(d); if (d32 === Math.round(v * 1.5)) return d + '.'; } return '8'; };
  const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const body = song.notes.map(([n, d]) => { const s = dur(d); const dot = s.endsWith('.'); const num = s.replace('.', ''); return n === 0 ? `${num}p${dot ? '.' : ''}` : `${num}${names[n % 12]}${Math.floor(n / 12) - 1}${dot ? '.' : ''}`; });
  return `${song.name.replace(/[:,]/g, ' ')}:d=4,o=5,b=${song.tempo}:${body.join(',')}`;
}
