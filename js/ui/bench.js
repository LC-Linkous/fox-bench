// bench.js — Bench tab: key test, RSSI, battery, against the firmware on the board; event log.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, numInput } from './dom.js';
import { download } from '../model/profiles.js';

let app, root, busy = false; const events = [];
export function init(a, el) { app = a; root = el; app.benchEvents = events; app.listeners.add(render); render(); }

function note(action, detail) { events.push({ t: new Date().toISOString(), uid: app.info?.uid || '', action, detail }); render(); }

async function run(action, args, btn, label) {
  if (busy) return;
  busy = true; const prev = btn.textContent; btn.textContent = label || 'Running…'; btn.classList.add('running');
  root.querySelectorAll('button').forEach(b => { if (b !== btn) b.disabled = true; });
  note(action + ':start', JSON.stringify(args));
  try { const out = await app.device.bench(action, args); note(action, out); }
  catch (e) { note(action + ':error', String(e.message || e)); }
  busy = false; btn.textContent = prev; btn.classList.remove('running');
  render();
}

function render() {
  if (app.family === 'foxlib-c') return renderConsole();
  if (app.family === 'drive') { root.replaceChildren(h('div.card', {}, h('p.hint', {}, `${app.board.name}: no bench. The firmware has no command interface and does not transmit while the drive is mounted. Use a receiver after the power cycle; Listen only shows the boot messages.`))); return; }
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
    ready ? h('p.hint', {}, 'Bench actions stop the running fox and talk to the firmware directly; one at a time, and the first one after a reboot takes ~10 s longer while CircuitPython compiles foxlib. ', h('button.btn.small', { onclick: () => app.restartFox() }, 'Restart fox'), ' when you are done.') : null,
    h('div.card', {}, h('h3', {}, 'Event log ', badge(events.length + ' events')),
      h('p.hint', {}, 'Every bench action with a timestamp and the board UID, so an external test procedure can be lined up against it later.'),
      events.length ? h('pre.out', {}, events.slice(-40).map(e => `${e.t}  ${e.uid.slice(-6)}  ${e.action.padEnd(12)} ${e.detail}`).join('\n')) : null,
      h('div.tools', { style: 'margin-top:8px' }, h('button.btn.small', { disabled: !events.length, onclick: () => download(`fox-bench-events-${Date.now()}.json`, JSON.stringify(events, null, 2), 'application/json') }, 'Download JSON'), h('button.btn.small', { disabled: !events.length, onclick: () => { events.length = 0; render(); } }, 'Clear'))));
}

/** foxlib-c family: the same bench, as text commands on the firmware's console (Listen only, or the demo's). */
let keySecsC = 3, toneHzC = 800, toneSecsC = 2;
async function runC(action, args, btn, label) {
  const con = app.consoleDevice(); if (!con || busy) return;
  busy = true; const prev = btn.textContent; btn.textContent = label || 'Running…'; btn.classList.add('running');
  root.querySelectorAll('button').forEach(b => { if (b !== btn) b.disabled = true; });
  note(action + ':start', JSON.stringify(args));
  try { const out = await con.bench(action, args); note(action, out); }
  catch (e) { note(action + ':error', String(e.message || e)); }
  busy = false; btn.textContent = prev; btn.classList.remove('running');
  render();
}
function renderConsole() {
  const con = app.consoleDevice(), ready = !!con && !busy;
  const last = a => [...events].reverse().find(e => e.action === a)?.detail;
  root.replaceChildren(
    !con ? h('p.notice.warn', { style: 'border:1px solid var(--edge);border-radius:4px' }, app.connected && !app.onBoard.listening ? `The ${app.board.drive?.label || 'drive'} is open; the bench talks to the serial console instead. Disconnect, then Listen only.` : 'Listen only on the board\'s serial port (or start the demo) to use the bench.') : null,
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Key test'),
        h('p.hint', {}, 'Keys the transmitter, unmodulated, on the current carrier for a few seconds, then releases; the fox\'s cycle pauses and resumes. Dummy load or antenna required. With a power meter this is the amplifier-enable check.'),
        field('Seconds', numInput(keySecsC, { min: 1, max: 60, step: 1, width: '100px', onchange: v => { keySecsC = v; } })),
        h('div.tools', {}, h('button.btn.danger', { disabled: !ready, onclick: e => runC('key', { seconds: keySecsC }, e.currentTarget, 'ON THE AIR') }, 'Key'), last('key') ? badge('last: ' + last('key'), last('key') === 'ok' ? 'ok' : 'warn') : null)),
      h('div.card', {}, h('h3', {}, 'Tone'),
        h('p.hint', {}, 'Carrier with one tone, FM-modulated by the firmware exactly as the ID will be: what a receiver hears is the deviation and tone shape from the Radio tab.'),
        h('div.two-col', {}, field('Hz', numInput(toneHzC, { min: 50, max: 4000, step: 50, width: '100px', onchange: v => { toneHzC = v; } })), field('Seconds', numInput(toneSecsC, { min: 1, max: 60, step: 1, width: '100px', onchange: v => { toneSecsC = v; } }))),
        h('div.tools', {}, h('button.btn.danger', { disabled: !ready, onclick: e => runC('tone', { hz: toneHzC, seconds: toneSecsC }, e.currentTarget, 'ON THE AIR') }, 'Tone'), h('button.btn.danger', { disabled: !ready, onclick: e => runC('id', {}, e.currentTarget, 'ON THE AIR') }, 'Send ID now'))),
      h('div.card', {}, h('h3', {}, 'Battery / status'),
        h('p.hint', {}, 'This board has no battery voltage sense: the firmware only sees the charger\'s /CHG line — "charging" while current flows, "charger idle" when the battery is full or there is no USB power; it cannot tell those two apart. Status prints the banner, the detected revision, the measured I²C write time (must stay under 125 µs at 8 000 samples/s) and the drive state.'),
        h('div.tools', {}, h('button.btn', { disabled: !ready, onclick: e => runC('batt', {}, e.currentTarget) }, 'Charging?'), last('batt') ? h('span.big', {}, last('batt')) : null, h('button.btn', { disabled: !ready, onclick: e => runC('status', {}, e.currentTarget) }, 'Status')),
        last('status') ? h('pre.out', {}, last('status')) : null)),
    con ? h('p.hint', {}, 'Each action is a console command (', h('code', {}, 'key 3'), ', ', h('code', {}, 'tone 800 2'), ', ', h('code', {}, 'id'), ', ', h('code', {}, 'batt'), ', ', h('code', {}, 'status'), ') and the reply scrolls in the console drawer; anything else — ', h('code', {}, 'freq 146.580'), ', ', h('code', {}, 'atten 40'), ', ', h('code', {}, 'reload'), ' — can be typed there. ', h('button.btn.small', { disabled: !ready, onclick: e => runC('stop', {}, e.currentTarget) }, 'Stop'), ' ends a running action.') : null,
    h('div.card', {}, h('h3', {}, 'Event log ', badge(events.length + ' events')),
      h('p.hint', {}, 'Every bench action with a timestamp and the board UID, so an external test procedure can be lined up against it later.'),
      events.length ? h('pre.out', {}, events.slice(-40).map(e => `${e.t}  ${e.uid.slice(-6)}  ${e.action.padEnd(12)} ${e.detail}`).join('\n')) : null,
      h('div.tools', { style: 'margin-top:8px' }, h('button.btn.small', { disabled: !events.length, onclick: () => download(`fox-bench-events-${Date.now()}.json`, JSON.stringify(events, null, 2), 'application/json') }, 'Download JSON'), h('button.btn.small', { disabled: !events.length, onclick: () => { events.length = 0; render(); } }, 'Clear'))));
}
