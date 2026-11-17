// issuetab.js — where a check's key is edited, so a message can offer the way there instead of naming a tab.
// SPDX-License-Identifier: GPL-2.0-only

export const TAB_NAMES = { board: 'Board', radio: 'Radio & pins', behavior: 'Behavior', plan: 'Frequency plan', id: 'Callsign & ID', payload: 'Payload', schedule: 'Schedule', deploy: 'Deploy' };

/** The tab a config key lives on. A network fox keeps its contest features (payload, checkpoint, sense, stealth) on
 *  the Payload tab and its radio (net.*) on Radio & pins; an FM fox has Behavior and Frequency plan as well. */
export function tabForKey(key, isNet = false) {
  const sec = String(key || '').split('.')[0];
  if (sec === 'fleet') return 'deploy';
  if (sec === 'id') return 'id';
  if (sec === 'schedule') return 'schedule';
  if (sec === 'pins' || sec === 'radio' || sec === 'net' || sec === 'led' || sec === 'battery') return 'radio';
  if (isNet) return ['payload', 'checkpoint', 'sense', 'stealth'].includes(sec) ? 'payload' : 'radio';
  if (sec === 'plan') return 'plan';
  if (sec === 'payload') return 'payload';
  if (sec === 'behavior' || sec === 'limits') return 'behavior';
  return 'radio';
}

/** What an issue offers beside its text: { fix } a one-click correction, { tab } the way to where it is settled.
 *  issue.fix / issue.tab come from the checks (netschema.js); without them the key decides. `here` is the tab the
 *  message is shown on: no link to where the reader already is. */
export function issueAction(issue, isNet, here) {
  if (issue.fix) return { fix: issue.fix };
  const tab = issue.tab || tabForKey(issue.key, isNet);
  return tab && tab !== here ? { tab } : {};
}
