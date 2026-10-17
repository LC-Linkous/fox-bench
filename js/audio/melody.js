// melody.js — song dict → events. Twin of foxlib/melody.py.
// SPDX-License-Identifier: GPL-2.0-only
// song = { name, tempo (quarter notes/min), notes: [[midi, dur32], …] }; midi 0 = rest,
// dur32 in 32nds of a whole note. Each note sounds for `articulation` of its slot.

export const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);

export function events(song, articulation = 0.875) {
  const msPer32 = 7500 / song.tempo;
  const out = [];
  for (const [note, d] of song.notes) {
    const slot = d * msPer32;
    if (note === 0) out.push([0, slot]);
    else { const on = slot * articulation; out.push([midiHz(note), on]); if (slot - on > 0.01) out.push([0, slot - on]); }
  }
  return out;
}

export const durationMs = (song, articulation) => events(song, articulation).reduce((a, [, ms]) => a + ms, 0);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = n => n === 0 ? 'rest' : `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** Built-in public-domain songs. */
export const BUILTIN = [
  { name: 'Auld Lang Syne', tempo: 90, notes: [[55,8],[60,12],[60,4],[60,8],[64,8],[62,12],[60,4],[62,8],[64,4],[62,4],[60,12],[60,4],[64,8],[67,8],[69,16],[0,8],[69,8],[67,12],[64,4],[64,8],[60,8],[62,12],[60,4],[62,8],[64,4],[62,4],[60,12],[57,4],[57,8],[55,8],[60,16]] },
  { name: 'The Entertainer (Joplin, 1902)', tempo: 140, notes: [[74,4],[75,4],[76,4],[84,8],[76,4],[84,8],[76,4],[84,24],[84,4],[86,4],[87,4],[88,4],[84,4],[86,4],[88,8],[83,4],[86,8],[84,16],[0,8],[74,4],[75,4],[76,4],[84,8],[76,4],[84,8],[76,4],[84,24],[0,4],[81,4],[79,4],[78,4],[81,4],[84,4],[88,8],[86,4],[84,4],[81,4],[86,16]] },
  { name: 'Scale check (C major)', tempo: 120, notes: [[60,4],[62,4],[64,4],[65,4],[67,4],[69,4],[71,4],[72,8],[0,4],[72,4],[71,4],[69,4],[67,4],[65,4],[64,4],[62,4],[60,8]] },
];
