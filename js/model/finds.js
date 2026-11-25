// finds.js — the checkpoint desk's rollup: who found which foxes, from the fleet log alone.
// SPDX-License-Identifier: GPL-2.0-only
//
// `find` rows come from the Bench tab's Collect finds (one per callsign handed in on a fox's sign-in page or over BLE,
// keyed by the fox's uid). The foxes of the day are the event sheet's rows (the latest deploy per uid). Pure: a
// function of the log, so the desk can re-run it after every collection.
import { sheetRows } from './sheet.js';

/** Finds per hunter against the foxes on the sheet (an event filters both). Returns
 *  { foxes: [{ uid, label, finds }], hunters: [{ callsign, found: [label…], missing: [label…], first, last, n }] },
 *  hunters most-found first, then earliest last find (the tie-break a desk wants). A find on a uid the sheet does not
 *  list (a fox that was never deployed under this event, or a demo) is counted under the hunter as "other". */
export function rollup(log, { event = '' } = {}) {
  const foxes = sheetRows(log, { event }).filter(r => r.uid).map(r => ({ uid: r.uid, label: foxLabel(r), finds: 0 }));
  const byUid = new Map(foxes.map(f => [f.uid, f]));
  const hunters = new Map();
  for (const r of log) {
    if (r.action !== 'find' || !r.callsign) continue;
    const call = String(r.callsign).trim().toUpperCase();
    const h = hunters.get(call) || { callsign: call, found: new Set(), other: 0, first: null, last: null, n: 0 };
    const fox = byUid.get(r.uid);
    if (fox) { if (!h.found.has(fox.uid)) fox.finds++; h.found.add(fox.uid); } else h.other++;
    h.n++;
    const t = String(r.timestamp || '');
    if (!h.first || t < h.first) h.first = t;
    if (!h.last || t > h.last) h.last = t;
    hunters.set(call, h);
  }
  const out = [...hunters.values()].map(h => ({
    callsign: h.callsign, n: h.n, other: h.other, first: h.first, last: h.last,
    found: foxes.filter(f => h.found.has(f.uid)).map(f => f.label),
    missing: foxes.filter(f => !h.found.has(f.uid)).map(f => f.label),
  }));
  out.sort((a, b) => b.found.length - a.found.length || String(a.last).localeCompare(String(b.last)) || a.callsign.localeCompare(b.callsign));
  return { foxes, hunters: out };
}

/** How a fox is named on the desk: its number, else its profile, else the template and the uid's tail. */
export function foxLabel(r) {
  if (r.board_number !== '' && r.board_number != null) return `#${r.board_number}`;
  if (r.profile) return r.profile;
  return `${String(r.template || '').split('/')[0] || 'fox'} …${String(r.uid || '').slice(-4)}`;
}

export function rollupCsv({ foxes, hunters }) {
  const q = s => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const head = ['callsign', 'found', 'of', 'foxes_found', 'missing', 'first', 'last'];
  return [head.join(','), ...hunters.map(h => [h.callsign, h.found.length, foxes.length, h.found.join(' '), h.missing.join(' '), h.first || '', h.last || ''].map(q).join(','))].join('\n') + '\n';
}
