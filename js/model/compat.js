// compat.js — the fox's firmware against the page: can the firmware on the board take what this page writes?
// SPDX-License-Identifier: GPL-2.0-only
//
// For the CircuitPython family this is self-healing: Deploy reinstalls foxlib when versions differ. For foxlib-c the
// firmware is baked into the UF2, so the page compares the version the fox reports (board.json over the drive, the
// banner over the console) with the version this site builds, and knows which fox.json features arrived when.

/** Compare dotted versions: negative when a < b. Non-numeric parts compare as strings. */
export function cmpVersion(a, b) {
  const pa = String(a || '').replace(/^c-/, '').split('.'), pb = String(b || '').replace(/^c-/, '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    const nx = Number(x), ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : String(x).localeCompare(String(y));
    if (c) return c;
  }
  return 0;
}

/** fox.json features and the foxlib-c version that first understood them (an older fox ignores or rejects them). */
export const FOXLIBC_SINCE = [
  { since: '0.1.3', key: 'id.telemetry', what: '"chg" telemetry (the word CHG while charging)', test: cfg => (cfg.id?.telemetry || []).includes('chg') },
];

/**
 * Issues (pageChecks shape) for a config bound for a foxlib-c fox.
 * foxVersion: what the board reports ('c-0.1.5', '' when unknown); hostedVersion: firmware/foxlib-c/VERSION on this site.
 */
export function foxlibcCompat(cfg, { foxVersion = '', hostedVersion = '' } = {}) {
  const issues = [];
  const fox = String(foxVersion || '').replace(/^c-/, ''), hosted = String(hostedVersion || '').replace(/^c-/, '');
  if (!fox) return issues;                                 // nothing connected, or an older firmware without board.json: nothing to compare
  if (fox === 'host' || fox === 'demo') return issues;     // the host simulation / the demo board are this tree
  for (const f of FOXLIBC_SINCE) if (f.test(cfg) && cmpVersion(fox, f.since) < 0) issues.push({ level: 'err', key: f.key, msg: `${f.what} needs firmware ${f.since}+; this fox runs ${fox}. Flash the hosted firmware from the Board tab, or turn the feature off.` });
  if (hosted && cmpVersion(fox, hosted) < 0) issues.push({ level: 'warn', key: 'firmware', msg: `this fox runs foxlib-c ${fox}; this site builds ${hosted}. The Board tab's firmware card updates it (Reboot into bootloader → Copy); the files written now stay valid for both.` });
  else if (hosted && cmpVersion(fox, hosted) > 0) issues.push({ level: 'info', key: 'firmware', msg: `this fox runs foxlib-c ${fox}, newer than the ${hosted} this page knows; settings it added after ${hosted} are not on this page and are written at their defaults.` });
  return issues;
}
