// foxlibc-limits.js — what the C firmware can hold, checked on the page before fox.json is written.
// SPDX-License-Identifier: GPL-2.0-only
//
// firmware/foxlib-c has fixed pools (core/json.h, core/cfg.h, core/melody.h, picofox/fox.c): a fox.json beyond
// them is truncated quietly (`partial(...)`) or fails to parse and the fox runs defaults.json — a silent fox or
// the wrong playlist, while this page's validator was happy. These checks mirror the constants; keep them in
// step with the headers (firmware/foxlib-c/tests/parity.py reads them back and compares).

export const LIMITS = {
  JSON_MAX_NODES: 4096,       // every value (object, array, string, number, bool, null) is one node
  JSON_MAX_DOUBLES: 256,      // numbers with a fractional part
  FILE_MAX_BYTES: 24575,      // picofox/fox.c filebuf, minus the terminator
  PLAYLIST_MAX: 16,
  SONG_MAX_NOTES: 256,
  SONG_NAME_MAX: 31,          // bytes of UTF-8, char name[32]
  CFG_MAX_FREQS: 16,
  CFG_MAX_RANGES: 4,
  CALLMESSAGE_MAX: 64,        // bytes of UTF-8, char callmessage[65]
};

const utf8len = s => new TextEncoder().encode(String(s)).length;

/** Count JSON values and fractional numbers the way the firmware's parser allocates them. */
export function countNodes(v) {
  let nodes = 0, doubles = 0;
  const walk = x => {
    nodes++;
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    else if (typeof x === 'number' && !Number.isInteger(x)) doubles++;
  };
  walk(v);
  return { nodes, doubles };
}

/**
 * fox.json as the page writes it for this family: indented one space per level (a hand edit is still possible),
 * with arrays of scalars on one line (a note is `[60, 4]`, not five lines) — a third of the indented size.
 */
export function stringifyFoxJson(cfg) {
  const scalar = '(?:-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|"(?:[^"\\\\]|\\\\.)*"|true|false|null)';
  const re = new RegExp(`\\[\\s*(${scalar}(?:\\s*,\\s*${scalar})*)\\s*\\]`, 'g');
  return JSON.stringify(cfg, null, 1).replace(re, (m, inner) => '[' + inner.split(/\s*,\s*/).join(', ') + ']') + '\n';
}

/** Issues (same shape as pageChecks) for a validated config bound for the C firmware. */
export function foxlibcLimitIssues(cfg) {
  const issues = [], err = (key, msg) => issues.push({ level: 'err', key, msg });
  if (cfg.plan.frequencies_mhz.length > LIMITS.CFG_MAX_FREQS) err('plan.frequencies_mhz', `${cfg.plan.frequencies_mhz.length} frequencies; the firmware keeps the first ${LIMITS.CFG_MAX_FREQS}`);
  if ((cfg.radio.ranges_mhz || []).length > LIMITS.CFG_MAX_RANGES) err('radio.ranges_mhz', `${cfg.radio.ranges_mhz.length} ranges; the firmware keeps ${LIMITS.CFG_MAX_RANGES}`);
  if (utf8len(cfg.id.callmessage) > LIMITS.CALLMESSAGE_MAX) err('id.callmessage', `${utf8len(cfg.id.callmessage)} bytes; the firmware holds ${LIMITS.CALLMESSAGE_MAX} (non-ASCII letters take 2–4 bytes each)`);
  if (cfg.payload?.kind === 'songs') {
    const pl = cfg.payload.playlist || [];
    if (pl.length > LIMITS.PLAYLIST_MAX) err('payload.playlist', `${pl.length} songs; the firmware plays the first ${LIMITS.PLAYLIST_MAX} and reports partial(payload.playlist)`);
    pl.forEach((s, i) => {
      if (s.notes.length > LIMITS.SONG_MAX_NOTES) err(`payload.playlist[${i}]`, `"${s.name}" has ${s.notes.length} notes; the firmware drops a song over ${LIMITS.SONG_MAX_NOTES}`);
      if (utf8len(s.name) > LIMITS.SONG_NAME_MAX) issues.push({ level: 'warn', key: `payload.playlist[${i}]`, msg: `"${s.name}" is ${utf8len(s.name)} bytes; the firmware's log shows the first ${LIMITS.SONG_NAME_MAX}` });
    });
  }
  const { nodes, doubles } = countNodes(cfg);
  if (nodes > LIMITS.JSON_MAX_NODES) err('fox.json', `${nodes} JSON values; the firmware's parser holds ${LIMITS.JSON_MAX_NODES} — it would fall back to defaults.json (cfg=default(too_large)). Shorter playlist, fewer songs.`);
  else if (nodes > LIMITS.JSON_MAX_NODES * 0.9) issues.push({ level: 'warn', key: 'fox.json', msg: `${nodes} JSON values of the firmware's ${LIMITS.JSON_MAX_NODES}` });
  if (doubles > LIMITS.JSON_MAX_DOUBLES) err('fox.json', `${doubles} fractional numbers; the firmware's parser holds ${LIMITS.JSON_MAX_DOUBLES}`);
  const bytes = utf8len(stringifyFoxJson(cfg));
  if (bytes > LIMITS.FILE_MAX_BYTES) err('fox.json', `${bytes} bytes; the firmware reads at most ${LIMITS.FILE_MAX_BYTES} (cfg=default(too_large))`);
  return issues;
}
