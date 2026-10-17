// bench.js — Bench tab: key test, RSSI, battery, against the firmware on the board; event log.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, numInput } from './dom.js';
import { download } from '../model/profiles.js';

let app, root; const events = [];
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

function note(action, detail) { events.push({ t: new Date().toISOString(), uid: app.info?.uid || '', action, detail }); render(); }

async function run(action, args, btn, label) {
  btn.disabled = true; const prev = btn.textContent; btn.textContent = label || 'Running…'; btn.classList.add('running');
  note(action + ':start', JSON.stringify(args));
  try { const out = await app.device.bench(action, args); note(action, out); }
  catch (e) { note(action + ':error', String(e.message || e)); }
  btn.disabled = false; btn.textContent = prev; btn.classList.remove('running');
}

function render() {
  const caps = new Set(app.template.capabilities);
  const ready = app.connected && (app.device.kind === 'demo' || app.onBoard.foxlibVersion);
  let keySecs = 3;
  const last = a => [...events].reverse().find(e => e.action === a)?.detail;
  root.replaceChildren(
    !ready ? h('p.notice.warn', { style: 'border:1px solid var(--edge);border-radius:4px' }, app.connected ? 'The fox firmware is not on this board yet — deploy first.' : 'Connect a board (or the demo) to use the bench.') : null,
    h('div.cols', {},
      caps.has('keytest') ? h('div.card', {}, h('h3', {}, 'Key test'),
        h('p.hint', {}, 'Keys the transmitter, unmodulated, on the first plan frequency for a few seconds, then releases. Confirms the module accepts the frequency and keys. Dummy load or antenna required.'),
        field('Seconds', numInput(keySecs, { min: 1, max: 30, step: 1, width: '100px', onchange: v => { keySecs = v; } })),
        h('div.tools', {}, h('button.btn.danger', { disabled: !ready, onclick: e => run('key', { seconds: keySecs }, e.currentTarget, 'ON THE AIR') }, 'Key'), last('key') ? badge('last: ' + last('key'), last('key') === 'ok' ? 'ok' : 'warn') : null)) : null,
      caps.has('rssi') ? h('div.card', {}, h('h3', {}, 'Receive / RSSI'),
        h('p.hint', {}, 'Reads the module\'s receive signal strength on the fox frequency. Checks the channel is clear before a hunt, or uses this fox as a crude field-strength meter for another.'),
        h('div.tools', {}, h('button.btn', { disabled: !ready, onclick: e => run('rssi', {}, e.currentTarget) }, 'Read RSSI'), last('rssi') ? h('span.big', {}, last('rssi')) : null)) : null,
      caps.has('batt') ? h('div.card', {}, h('h3', {}, 'Battery'),
        app.cfg.pins.batt_sense ? h('p.hint', {}, `Averaged ADC read on ${app.cfg.pins.batt_sense} through the divider, with the calibration from fox.json.`) : h('p.hint.warn', {}, 'No batt_sense pin configured; the firmware has no battery monitor.'),
        h('div.tools', {}, h('button.btn', { disabled: !ready || !app.cfg.pins.batt_sense, onclick: e => run('batt', {}, e.currentTarget) }, 'Read voltage'), last('batt') ? h('span.big', {}, last('batt'), h('span.unit', {}, 'V')) : null)) : null),
    h('div.card', {}, h('h3', {}, 'Event log ', badge(events.length + ' events')),
      h('p.hint', {}, 'Every bench action with a timestamp and the board UID, so an external test procedure can be lined up against it later.'),
      events.length ? h('pre.out', {}, events.slice(-40).map(e => `${e.t}  ${e.uid.slice(-6)}  ${e.action.padEnd(12)} ${e.detail}`).join('\n')) : null,
      h('div.tools', { style: 'margin-top:8px' }, h('button.btn.small', { disabled: !events.length, onclick: () => download(`fox-bench-events-${Date.now()}.json`, JSON.stringify(events, null, 2), 'application/json') }, 'Download JSON'), h('button.btn.small', { disabled: !events.length, onclick: () => { events.length = 0; render(); } }, 'Clear'))));
}
