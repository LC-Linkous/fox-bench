// issues.js — one check as a list item: its key, its text, and the way to settle it (a one-click fix, or the tab
// where it is edited) so a message never leaves the reader hunting for another tab.
// SPDX-License-Identifier: GPL-2.0-only
import { h } from './dom.js';
import { issueAction, TAB_NAMES } from '../model/issuetab.js';

/** `here`: the tab this list is on (no "Open" button to where the reader already is). */
export function issueItem(app, i, here) {
  const act = issueAction(i, app.isNet, here);
  const btn = act.fix === 'clock'
    ? h('button.btn.small',
      {title: 'the same as ticking "Set the board clock" on the Deploy tab: every deploy sets the board to this browser\'s time',
        onclick: () => app.setDeployClock({ enabled: true })},
      'Set the board clock at deploy')
    : act.tab ? h('button.btn.small', { onclick: () => app.showTab(act.tab) }, `Open ${TAB_NAMES[act.tab]}`) : null;
  return h('li', { class: i.level === 'err' ? 'hint err' : i.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' },
    h('code', {}, i.key), ' ', i.msg, btn ? ' ' : null, btn);
}
