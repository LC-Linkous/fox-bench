// bench.js — Bench tab: key test, RSSI, battery, against the firmware on the board; event log.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, numInput } from './dom.js';
import { download, fleet } from '../model/profiles.js';
import { name as nameOnAir } from '../model/sheet.js';
import { bleMac } from '../model/netschema.js';

let app, root, busy = false; const events = [];
export function init(a, el) { app = a; root = el; app.benchEvents = events; app.listeners.add(render); render(); }

function note(action, detail) { events.push({ t: new Date().toISOString(), uid: app.info?.uid || '', action, detail }); render(); }

/** finds.csv from the fox (the checkpoint section's find log) into the fleet log: one row per find, action 'find',
 *  deduplicated on fox uid + ms_since_boot + callsign so collecting twice adds nothing. Returns a summary line. */
let lastFinds = null;
async function collectFinds(btn) {
  if (busy) return;
  busy = true; const prev = btn.textContent; btn.textContent = 'Reading…'; btn.classList.add('running');
  note('finds:start', '');
  try {
    await app.device.interrupt();
    const text = await app.device.readText('finds.csv');
    if (text == null) { lastFinds = { rows: [], text: '', added: 0, present: 0 }; note('finds', 'no finds.csv on the fox yet'); }
    else {
      const rows = parseFinds(text), have = fleet.all();
      const key = r => `${r.fox_uid}|${r.ms_since_boot}|${r.callsign}`;
      const seen = new Set(have.filter(x => x.action === 'find').map(x => `${x.uid}|${(x.notes || '').match(/\+(\d+) ms/)?.[1] || ''}|${x.callsign}`));
      let added = 0, present = 0;
      for (const r of rows) {
        if (seen.has(key(r))) { present++; continue; }
        seen.add(key(r)); added++;
        fleet.append({board_number: '', uid: r.fox_uid, board: app.info?.boardId || '', action: 'find', template: r.template,
          profile: app.cfg.fleet?.profile || '', callsign: r.callsign, freq: '', result: 'find',
          notes: `cycle ${r.cycle}, +${r.ms_since_boot} ms after boot, via ${r.via || '?'}${app.cfg.net ? ', ' + app.cfg.net.kind : ''}`});
      }
      lastFinds = { rows, text, added, present };
      note('finds', `${rows.length} find${rows.length === 1 ? '' : 's'} on the fox: ${added} new in the fleet log, ${present} already there`);
    }
  } catch (e) { note('finds:error', String(e.message || e)); }
  busy = false; btn.textContent = prev; btn.classList.remove('running');
  render();
}
function parseFinds(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map(l => { const c = l.split(','); const r = {}; head.forEach((k, i) => { r[k.trim()] = (c[i] || '').trim(); }); return r; }).filter(r => r.callsign);
}
async function clearFinds(btn) {
  if (busy || !confirm('Delete finds.csv on the fox? Collect first; the fleet log keeps what was collected.')) return;
  busy = true;
  try { await app.device.interrupt(); await app.device.remove('finds.csv'); lastFinds = null; note('finds:clear', 'finds.csv removed'); }
  catch (e) { note('finds:error', String(e.message || e)); }
  busy = false; render();
}

/** near.csv from the fox (the sense section's log): shown and downloadable, not merged into the fleet log — it is
 *  about the people near the fox, not about the fox. */
let lastNear = null;
async function whoIsNear(btn) {
  if (busy) return;
  busy = true; const prev = btn.textContent; btn.textContent = 'Reading…'; btn.classList.add('running');
  note('near:start', '');
  try {
    await app.device.interrupt();
    const text = await app.device.readText('near.csv');
    const lines = (text || '').split(/\r?\n/).filter(l => l.trim());
    const head = lines.length ? lines[0].split(',') : [];
    const all = lines.slice(1).map(l => { const c = l.split(','); const r = {}; head.forEach((k, i) => { r[k.trim()] = (c[i] || '').trim(); }); return r; });
    const by = {}; for (const r of all) (by[r.kind] ||= []).push(r);    // rows carry no address (foxlib 1.11): counted, not distinguished
    lastNear = { text: text || '', rows: all, by };
    note('near',
      text == null ? 'no near.csv on the fox yet' : `${all.length} line${all.length === 1 ? '' : 's'}: ` + (Object.entries(by).map(([k, v]) => `${v.length} ${k}${v.length === 1 ? '' : 's'}`).join(', ') || 'nothing'));
  } catch (e) { note('near:error', String(e.message || e)); }
  busy = false; btn.textContent = prev; btn.classList.remove('running');
  render();
}
async function clearNear(btn) {
  if (busy || !confirm('Delete near.csv on the fox? Download it first if you want it.')) return;
  busy = true;
  try { await app.device.interrupt(); await app.device.remove('near.csv'); lastNear = null; note('near:clear', 'near.csv removed'); }
  catch (e) { note('near:error', String(e.message || e)); }
  busy = false; render();
}

async function run(action, args, btn, label) {
  if (busy) return;
  busy = true; const prev = btn.textContent; btn.textContent = label || 'Running…'; btn.classList.add('running');
  root.querySelectorAll('button').forEach(b => { if (b !== btn) b.disabled = true; });
  note(action + ':start', JSON.stringify(args));
  try { const out = await app.device.bench(action, args); note(action, out); if (action === 'key' && args.net) keyVerdict(out); }
  catch (e) { note(action + ':error', String(e.message || e)); }
  busy = false; btn.textContent = prev; btn.classList.remove('running');
  render();
}

/** What Radio up says beyond "ok": the address the radio was on the air with against fox.json's, and the radio's notes
 *  (foxlib 1.11.3 appends "; note: …" to the key line: a refused channel or power, a hidden SSID it cannot hide). */
let lastKey = null;
function keyVerdict(out) {
  const [line, ...notes] = String(out).split('; note: ');
  const got = line.match(/\(([0-9A-Fa-f:?]+)\) for [0-9.]+ s/)?.[1]?.toUpperCase() || null;
  const want = app.cfg.net?.mac ? (app.cfg.net.kind === 'ble' ? bleMac(app.cfg.net.mac) : app.cfg.net.mac).toUpperCase() : null;
  lastKey = { ok: line.startsWith('ok'), got, want, macOk: !want || !got || got === want, notes };
  if (want && got && got !== want) note('key:mac', `on the air as ${got}, fox.json asked for ${want} (bench-runbook Q12)`);
  for (const n of notes) note('key:note', n);
}

/** Board health: the numbers hw_smoke puts in every hardware-log row, read the same way. */
let lastHealth = null;
async function health(btn) {
  if (busy) return;
  busy = true; const prev = btn.textContent; btn.textContent = 'Reading…'; btn.classList.add('running');
  note('health:start', '');
  try {
    const h = JSON.parse(await app.device.bench('health', { net: app.isNet }));
    lastHealth = h;
    note('health', `free ${h.free} → ${h.after_import} after import (${h.import_s} s) → ${h.with_fox} B with the fox · foxlib ${h.foxlib}${h.fatal ? ' · fox not usable: ' + h.fatal : ''}`);
  } catch (e) { note('health:error', String(e.message || e)); }
  busy = false; btn.textContent = prev; btn.classList.remove('running');
  render();
}
const kB = n => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB');

function render() {
  if (app.family === 'foxlib-c') return renderConsole();
  if (app.family === 'drive') { root.replaceChildren(h('div.card', {},
    h('p.hint', {},
      `${app.board.name}: no bench. The firmware has no command interface and does not transmit while the drive is mounted. Use a receiver after the power cycle; Listen only shows the boot messages.`))); return; }
  const caps = new Set(app.template.capabilities);
  if (app.isNet && app.cfg.checkpoint?.enabled) caps.add('finds');
  if (app.isNet && app.cfg.sense?.enabled) caps.add('near');      // any net fox with the checkpoint section on keeps a find log
  const ready = app.connected && (app.device.kind === 'demo' || app.onBoard.foxlibVersion);
  let keySecs = 3;
  const last = a => [...events].reverse().find(e => e.action === a)?.detail;
  root.replaceChildren(
    !ready ? h('p.notice.warn', { style: 'border:1px solid var(--edge);border-radius:4px' },
      app.connected ? 'The fox firmware is not on this board yet — deploy first.' : 'Connect a board (or the demo) to use the bench.') : null,
    h('div.cols', {},
      caps.has('keytest') && app.isNet ? h('div.card', {}, h('h3', {}, 'Radio up'),
        h('p.hint', {},
          `Brings the ${app.cfg.net.kind === 'ble' ? 'beacon' : 'network'} up for a few seconds, then down: "${nameOnAir(app.cfg)}" should appear on a phone and go away. No antenna question: the SoC's own radio at Part 15 power.`),
        field('Seconds', numInput(keySecs, { min: 1, max: 30, step: 1, width: '100px', onchange: v => { keySecs = v; } })),
        h('div.tools', {},
          h('button.btn.primary',
            { disabled: !ready, onclick: e => run('key', { seconds: keySecs, net: true }, e.currentTarget, 'ON THE AIR') }, 'Radio up'),
          last('key') ? badge('last: ' + String(last('key')).split('; note: ')[0], lastKey?.ok === false ? 'err' : 'info') : null),
        lastKey ? h('div', { style: 'margin-top:8px' },
          lastKey.want && lastKey.got ? h('p.hint' + (lastKey.macOk ? '' : '.warn'), {},
            lastKey.macOk ? `on the air as ${lastKey.got}, as fox.json asks` : `on the air as ${lastKey.got} — fox.json asked for ${lastKey.want} (the chip refused the address; bench-runbook Q12)`) : null,
          ...lastKey.notes.map(n => h('p.hint.warn', {}, 'radio: ' + n))) : null) :
      caps.has('keytest') ? h('div.card', {}, h('h3', {}, 'Key test'),
        h('p.hint', {},
          'Keys the transmitter, unmodulated, on the first plan frequency for a few seconds, then releases. Confirms the module accepts the frequency and keys. Dummy load or antenna required.'),
        field('Seconds', numInput(keySecs, { min: 1, max: 30, step: 1, width: '100px', onchange: v => { keySecs = v; } })),
        h('div.tools', {},
          h('button.btn.danger', { disabled: !ready, onclick: e => run('key', { seconds: keySecs }, e.currentTarget, 'ON THE AIR') }, 'Key'),
          last('key') ? badge('last: ' + last('key'), last('key') === 'ok' ? 'ok' : 'warn') : null)) : null,
      caps.has('rssi') && app.isNet ? h('div.card', {}, h('h3', {}, 'Scan'),
        h('p.hint', {},
          'What this radio hears nearby, strongest first — a sanity check that it is alive, and a crude way to find another fox with this one. Wi-Fi entries carry the channel (ch 36 and up: 5 GHz, which only the C5 hears).'),
        h('div.tools', {}, h('button.btn', { disabled: !ready, onclick: e => run('rssi', { net: true }, e.currentTarget) }, 'Scan'),
          last('rssi') ? h('span.mono', { style: 'font-size:.85rem' }, last('rssi')) : null)) :
      caps.has('rssi') ? h('div.card', {}, h('h3', {}, 'Receive / RSSI'),
        h('p.hint', {},
          'Reads the module\'s receive signal strength on the fox frequency. Checks the channel is clear before a hunt, or uses this fox as a crude field-strength meter for another.'),
        h('div.tools', {}, h('button.btn', { disabled: !ready, onclick: e => run('rssi', {}, e.currentTarget) }, 'Read RSSI'),
          last('rssi') ? h('span.big', {}, last('rssi')) : null)) : null,
      caps.has('finds') ? h('div.card', {}, h('h3', {}, 'Collect finds'),
        h('p.hint', {}, 'Reads ', h('code', {}, 'finds.csv'),
          ' from the fox — every callsign handed in on the sign-in page or over BLE — and merges each as a ', h('code', {}, 'find'),
          ' row into the fleet log (Fleet tab), keyed by this fox\'s uid. Collecting twice adds nothing. The checkpoint desk reads the fleet log; this is not the scored find.'),
        h('div.tools', {}, h('button.btn.primary', { disabled: !ready, onclick: e => collectFinds(e.currentTarget) }, 'Collect finds'),
          lastFinds?.rows.length ? h('button.btn.small',
            { onclick: () => download(`finds-${(app.info?.uid || 'fox').slice(-6)}-${Date.now()}.csv`, lastFinds.text, 'text/csv') },
            'Download this fox\'s CSV') : null,
          lastFinds?.rows.length ? h('button.btn.small', { disabled: !ready, onclick: e => clearFinds(e.currentTarget) }, 'Clear on fox') : null,
          last('finds') ? badge(last('finds'), 'info') : null),
        lastFinds?.rows.length ? h('pre.out', { style: 'margin-top:8px;max-height:160px;overflow:auto' },
          lastFinds.rows.slice(-12).map(r => `${r.callsign.padEnd(12)} cycle ${r.cycle}  +${(r.ms_since_boot / 1000).toFixed(0)} s  ${r.via || ''}`).join('\n')) : null) : null,
      caps.has('near') ? h('div.card', {}, h('h3', {}, 'Who is near'),
        h('p.hint', {}, 'Reads ', h('code', {}, 'near.csv'),
          ' from the fox — hunter tags heard, stations that joined, probe requests for its names: a kind, a signal level and a name per line, no addresses (foxlib 1.11.1 stopped logging them). Shown here and downloadable; it is about the people near the fox, so it is not merged into the fleet log.'),
        h('div.tools', {}, h('button.btn.primary', { disabled: !ready, onclick: e => whoIsNear(e.currentTarget) }, 'Who is near'),
          lastNear?.rows.length ? h('button.btn.small',
            { onclick: () => download(`near-${(app.info?.uid || 'fox').slice(-6)}-${Date.now()}.csv`, lastNear.text, 'text/csv') },
            'Download CSV') : null,
          lastNear?.rows.length ? h('button.btn.small', { disabled: !ready, onclick: e => clearNear(e.currentTarget) }, 'Clear on fox') : null,
          last('near') ? badge(last('near'), 'info') : null),
        lastNear?.rows.length ? h('pre.out', { style: 'margin-top:8px;max-height:160px;overflow:auto' },
          lastNear.rows.slice(-14).map(r => `${(r.kind || '').padEnd(6)} ${String(r.rssi || '').padStart(4)} dBm  ${(r.name || '').padEnd(24)}  cycle ${r.cycle}  +${Math.round((+r.ms_since_boot || 0) / 1000)} s`).join('\n')) : null) : null,
      h('div.card', {}, h('h3', {}, 'Board health'),
        h('p.hint', {},
          'What the board says about itself, read the way the bench script reads it for the hardware log: free heap on a fresh VM, after importing foxlib (an import in hundredths of a second is the precompiled set; whole seconds is source), and with the fox built — the ',
          h('code', {}, 'mem='), ' of the banner. The C3 lives at ~30 KB with a BLE fox; the C6 above 100 KB; the S3 and C5 in the megabytes.'),
        h('div.tools', {}, h('button.btn', { disabled: !ready, onclick: e => health(e.currentTarget) }, 'Read'),
          lastHealth ? h('span.mono', { style: 'font-size:.85rem' },
            `${kB(lastHealth.free)} → ${kB(lastHealth.after_import)} after import (${lastHealth.import_s} s) → ${kB(lastHealth.with_fox)} with the fox · foxlib ${lastHealth.foxlib}`) : null),
        lastHealth?.fatal ? h('p.hint.warn', {}, 'the fox is not usable on this board: ' + lastHealth.fatal) : null),
      caps.has('batt') ? h('div.card', {}, h('h3', {}, 'Battery'),
        app.cfg.pins?.batt_sense ? h('p.hint', {},
          `Averaged ADC read on ${app.cfg.pins.batt_sense} through the divider, with the calibration from fox.json.`) : h('p.hint.warn', {}, 'No batt_sense pin configured; the firmware has no battery monitor.'),
        h('div.tools', {},
          h('button.btn', { disabled: !ready || !app.cfg.pins?.batt_sense, onclick: e => run('batt', {}, e.currentTarget) }, 'Read voltage'),
          last('batt') ? h('span.big', {}, last('batt'), h('span.unit', {}, 'V')) : null)) : null),
    ready ? h('div.tools', { style: 'margin:4px 0 14px' },
      h('button.btn.primary', { onclick: () => app.restartFox() }, 'Restart fox'),
      h('span.hint', {}, 'Bench actions stop the running fox and talk to the firmware directly, one at a time; restart it when you are done. With foxlib deployed as source (not .mpy) the first action after a reboot takes several seconds longer while CircuitPython compiles it.')) : null,
    h('div.card', {}, h('h3', {}, 'Event log ', badge(events.length + ' events')),
      h('p.hint', {},
        'Every bench action with a timestamp and the board UID, so an external test procedure can be lined up against it later.'),
      events.length ? h('pre.out', {},
        events.slice(-40).map(e => `${e.t}  ${e.uid.slice(-6)}  ${e.action.padEnd(12)} ${e.detail}`).join('\n')) : null,
      h('div.tools', { style: 'margin-top:8px' },
        h('button.btn.small',
          {disabled: !events.length,
            onclick: () => download(`fox-bench-events-${Date.now()}.json`, JSON.stringify(events, null, 2), 'application/json')},
          'Download JSON'),
        h('button.btn.small', { disabled: !events.length, onclick: () => { events.length = 0; render(); } }, 'Clear'))));
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
    !con ? h('p.notice.warn', { style: 'border:1px solid var(--edge);border-radius:4px' },
      app.connected && !app.onBoard.listening ? `The ${app.board.drive?.label || 'drive'} is open; the bench talks to the serial console instead. Disconnect, then Listen only.` : 'Listen only on the board\'s serial port (or start the demo) to use the bench.') : null,
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Key test'),
        h('p.hint', {},
          'Keys the transmitter, unmodulated, on the current carrier for a few seconds, then releases; the fox\'s cycle pauses and resumes. Dummy load or antenna required. With a power meter this is the amplifier-enable check.'),
        field('Seconds', numInput(keySecsC, { min: 1, max: 60, step: 1, width: '100px', onchange: v => { keySecsC = v; } })),
        h('div.tools', {},
          h('button.btn.danger', { disabled: !ready, onclick: e => runC('key', { seconds: keySecsC }, e.currentTarget, 'ON THE AIR') },
            'Key'),
          last('key') ? badge('last: ' + last('key'), last('key') === 'ok' ? 'ok' : 'warn') : null)),
      h('div.card', {}, h('h3', {}, 'Tone'),
        h('p.hint', {},
          'Carrier with one tone, FM-modulated by the firmware exactly as the ID will be: what a receiver hears is the deviation and tone shape from the Radio tab.'),
        h('div.two-col', {},
          field('Hz', numInput(toneHzC, { min: 50, max: 4000, step: 50, width: '100px', onchange: v => { toneHzC = v; } })),
          field('Seconds', numInput(toneSecsC, { min: 1, max: 60, step: 1, width: '100px', onchange: v => { toneSecsC = v; } }))),
        h('div.tools', {},
          h('button.btn.danger',
            { disabled: !ready, onclick: e => runC('tone', { hz: toneHzC, seconds: toneSecsC }, e.currentTarget, 'ON THE AIR') }, 'Tone'),
          h('button.btn.danger', { disabled: !ready, onclick: e => runC('id', {}, e.currentTarget, 'ON THE AIR') }, 'Send ID now'))),
      h('div.card', {}, h('h3', {}, 'Battery / status'),
        h('p.hint', {},
          'This board has no battery voltage sense: the firmware only sees the charger\'s /CHG line — "charging" while current flows, "charger idle" when the battery is full or there is no USB power; it cannot tell those two apart. Status prints the banner, the detected revision, the measured I²C write time (must stay under 125 µs at 8 000 samples/s) and the drive state.'),
        h('div.tools', {}, h('button.btn', { disabled: !ready, onclick: e => runC('batt', {}, e.currentTarget) }, 'Charging?'),
          last('batt') ? h('span.big', {}, last('batt')) : null,
          h('button.btn', { disabled: !ready, onclick: e => runC('status', {}, e.currentTarget) }, 'Status')),
        last('status') ? h('pre.out', {}, last('status')) : null)),
    con ? h('p.hint', {}, 'Each action is a console command (', h('code', {}, 'key 3'), ', ', h('code', {}, 'tone 800 2'), ', ',
      h('code', {}, 'id'), ', ', h('code', {}, 'batt'), ', ', h('code', {}, 'status'),
      ') and the reply scrolls in the console drawer; anything else — ', h('code', {}, 'freq 146.580'), ', ', h('code', {}, 'atten 40'),
      ', ', h('code', {}, 'reload'), ' — can be typed there. ',
      h('button.btn.small', { disabled: !ready, onclick: e => runC('stop', {}, e.currentTarget) }, 'Stop'), ' ends a running action.') : null,
    h('div.card', {}, h('h3', {}, 'Event log ', badge(events.length + ' events')),
      h('p.hint', {},
        'Every bench action with a timestamp and the board UID, so an external test procedure can be lined up against it later.'),
      events.length ? h('pre.out', {},
        events.slice(-40).map(e => `${e.t}  ${e.uid.slice(-6)}  ${e.action.padEnd(12)} ${e.detail}`).join('\n')) : null,
      h('div.tools', { style: 'margin-top:8px' },
        h('button.btn.small',
          {disabled: !events.length,
            onclick: () => download(`fox-bench-events-${Date.now()}.json`, JSON.stringify(events, null, 2), 'application/json')},
          'Download JSON'),
        h('button.btn.small', { disabled: !events.length, onclick: () => { events.length = 0; render(); } }, 'Clear'))));
}
