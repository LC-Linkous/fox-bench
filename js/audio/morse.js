// morse.js — table, encoder, text → events. Twin of foxlib/morse.py; CI compares the tables.
// SPDX-License-Identifier: GPL-2.0-only

export const TABLE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---',
  k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-',
  u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '@': '.--.-.',
};

export function encode(text) {
  const words = [];
  for (const word of text.toLowerCase().split(' ')) {
    const chars = [...word].filter(c => c in TABLE).map(c => TABLE[c]);
    if (chars.length) words.push(chars);
  }
  return words;
}

/** PARIS timing. Returns [[hz, ms], …]; hz 0 is silence. ditMs overrides the element length (QRSS). */
export function events(text, { wpm = 12, toneHz = 800, ditMs = null } = {}) {
  const unit = ditMs ?? 1200 / wpm;
  const out = [];
  const words = encode(text);
  words.forEach((word, wi) => {
    if (wi > 0) out.push([0, unit * 7]);           // word gap (no gap is sent after a word's last character)
    word.forEach((ch, ci) => {
      [...ch].forEach((m, mi) => {
        out.push([toneHz, m === '.' ? unit : unit * 3]);
        if (mi < ch.length - 1) out.push([0, unit]);
      });
      if (ci < word.length - 1) out.push([0, unit * 3]);
    });
    if (wi === words.length - 1) out.push([0, unit * 3]);
  });
  return out;
}

/** Characters in text that the table cannot send. */
export const unsendable = text => [...new Set([...text.toLowerCase()].filter(c => c !== ' ' && !(c in TABLE)))];
