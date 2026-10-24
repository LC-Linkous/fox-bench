// net.js — the Radio, ID and Schedule tabs for network foxes (wifi-beacon, wifi-probe, ble-beacon): the SoC's own radio
// on a duty cycle. Contract: js/model/netschema.js (firmware twin foxlib/netcfg.py).
// SPDX-License-Identifier: GPL-2.0-only
import { h, field, select, numInput, check, badge } from './dom.js';
import { WIFI24_CHANNELS, WIFI5_CHANNELS, WIFI_POWER_DBM, BLE_POWER_DBM, MAX_NAME, randomMac, displayName, cycle } from '../model/netschema.js';

let app;
export function init(a) { app = a; }   // idempotent; every tab that renders a net form calls it from its own init

const text = (obj, key, { max = 64, upper = false, mono = false, placeholder = '' } = {}, on = 'radio') => {
  const el = h('input', { type: 'text', value: obj[key] ?? '', maxlength: max, spellcheck: 'false', placeholder, style: 'width:100%' + (upper ? ';text-transform:uppercase' : '') + (mono ? ';font-family:var(--mono)' : '') });
  el.addEventListener('change', () => { obj[key] = upper ? el.value.toUpperCase() : el.value; app.changed(on); });
  return el;
};
const issuesFor = prefix => (app.issues || []).filter(i => i.key === prefix || i.key.startsWith(prefix + '.')).concat((app.report || []).filter(r => r.key === prefix || r.key.startsWith(prefix + '.')).map(r => ({ level: 'err', key: r.key, msg: r.reason })));
const issueList = prefix => { const l = issuesFor(prefix); return l.length ? h('ul', { style: 'margin:6px 0 0;padding-left:1.2em' }, l.map(i => h('li', { class: i.level === 'err' ? 'hint err' : i.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, i.key), ' ', i.msg))) : null; };
const blen = s => new TextEncoder().encode(String(s)).length;

function macField(n) {
  const inp = text(n, 'mac', { max: 17, upper: true, mono: true, placeholder: 'F2:xx:xx:xx:xx:xx' });
  return field('MAC address (the fox\'s fingerprint)', h('div.row', {}, inp, h('button.btn.small', { onclick: () => { n.mac = randomMac(6); app.changed('radio'); } }, 'Random')),
    'Locally administered and unicast (first byte F2 as kitsune does). A hunter\'s scanner shows it as the BSSID / device address; keep one per fox and write it on the fleet sheet.');
}

/** Radio tab: the network section. */
export function renderRadio(root) {
  const cfg = app.cfg, n = cfg.net, hw = app.hardware || {}, radios = hw.radios || [];
  const labels = { wifi24: 'Wi-Fi 2.4 GHz', wifi5: 'Wi-Fi 5 GHz', ble: 'BLE', btclassic: 'Bluetooth Classic', ieee802154: '802.15.4' };
  const name = displayName(cfg);
  let main;
  if (n.kind === 'wifi-ap') {
    const chans = [...WIFI24_CHANNELS.map(c => [c, `${c} (2.4 GHz)`]), ...(radios.includes('wifi5') ? WIFI5_CHANNELS.map(c => [c, `${c} (5 GHz)`]) : [])];
    main = h('div', {},
      field('SSID', cfg.id.use_callsign_as_name ? h('input', { type: 'text', value: name, disabled: true, style: 'width:100%' }) : text(n, 'ssid', { max: MAX_NAME }), cfg.id.use_callsign_as_name ? 'the callsign (ID tab) is the name on the air' : `what a phone's Wi-Fi list shows; up to 32 bytes (${blen(n.ssid)} used)`),
      field('Password (PSK)', text(n, 'psk', { max: 63, mono: true, placeholder: 'empty = open network' }), 'empty for an open network, or 8–63 characters for WPA2. Hunters only need to see it, not join it.'),
      h('div.two-col', {},
        field('Channel', select(chans, n.channel, v => { n.channel = Number(v); app.changed('radio'); }), radios.includes('wifi5') ? 'this board has 5 GHz; 5 GHz AP support in CircuitPython on this chip is unverified' : '1–13; 1, 6 and 11 do not overlap'),
        field('Transmit power', select(WIFI_POWER_DBM.map(p => [p, `${p} dBm`]), n.tx_power_dbm, p => { n.tx_power_dbm = Number(p); app.changed('radio'); }), 'the chip\'s power steps; lower is harder to find')),
      h('div.two-col', {},
        check('Hidden SSID', n.hidden, v => { n.hidden = v; app.changed('radio'); }, 'not possible with this firmware (noted here and in the fox\'s banner); kept so an imported kitsune "hard" fox keeps its intent'),
        field('Max clients', numInput(n.max_clients, { min: 1, max: 8, step: 1, onchange: v => { n.max_clients = v; app.changed('radio'); } }), 'how many may join at once')),
      macField(n));
  } else if (n.kind === 'wifi-probe') {
    main = h('div', {},
      field('Network it looks for (SSID)', cfg.id.use_callsign_as_name ? h('input', { type: 'text', value: name, disabled: true, style: 'width:100%' }) : text(n, 'ssid', { max: MAX_NAME }), 'the fox keeps trying to join this network, which does not exist: its probe requests carry the name and the MAC, which a sniffer sees. It never connects to anything.'),
      field('Transmit power', select(WIFI_POWER_DBM.map(p => [p, `${p} dBm`]), n.tx_power_dbm, p => { n.tx_power_dbm = Number(p); app.changed('radio'); })),
      macField(n));
  } else {
    main = h('div', {},
      field('Name', cfg.id.use_callsign_as_name ? h('input', { type: 'text', value: name, disabled: true, style: 'width:100%' }) : text(n, 'name', { max: MAX_NAME }), 'the complete local name in the scan response; a BLE scanner app shows it'),
      field('iBeacon UUID', text(n, 'uuid', { max: 36, upper: true, mono: true, placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' }), 'one per event; hunters filter on it'),
      h('div.two-col', {},
        field('Major', numInput(n.major, { min: 0, max: 65535, step: 1, onchange: v => { n.major = v; app.changed('radio'); } }), 'e.g. the course'),
        field('Minor', numInput(n.minor, { min: 0, max: 65535, step: 1, onchange: v => { n.minor = v; app.changed('radio'); } }), 'e.g. the fox number')),
      h('div.two-col', {},
        field('Measured power at 1 m (dBm)', numInput(n.signal_power_dbm, { min: -128, max: 0, step: 1, onchange: v => { n.signal_power_dbm = v; app.changed('radio'); } }), 'what the frame claims; −59 is the usual figure'),
        field('Advertising power', select(BLE_POWER_DBM.map(p => [p, `${p} dBm`]), n.tx_power_dbm, p => { n.tx_power_dbm = Number(p); app.changed('radio'); }), 'what the radio actually sends')),
      h('div.two-col', {},
        field('Advertising interval, min (ms)', numInput(n.adv_min, { min: 20, max: 10240, step: 1, onchange: v => { n.adv_min = v; app.changed('radio'); } })),
        field('max (ms)', numInput(n.adv_max, { min: 20, max: 10240, step: 1, onchange: v => { n.adv_max = v; app.changed('radio'); } }), '100 ms is easy to see in a scanner; seconds make it harder')),
      macField(n));
  }
  root.replaceChildren(h('div.cols', {},
    h('div.card', {}, h('h3', {}, { 'wifi-ap': 'Wi-Fi access point', 'wifi-probe': 'Wi-Fi probe', ble: 'BLE beacon' }[n.kind] || n.kind, ' ', badge(name || 'no name', 'info')), main, issueList('net')),
    h('div.card', {}, h('h3', {}, 'This board'),
      h('dl.kv', {}, h('dt', {}, 'Radios'), h('dd', {}, radios.map(r => labels[r] || r).join(', ') || 'unknown'), h('dt', {}, 'Firmware'), h('dd', {}, `CircuitPython + foxlib ${app.catalog.foxlibVersion}: the SoC's own radio, no module, no pins`)),
      h('p.hint', {}, 'What the firmware cannot do, it says in its banner rather than ignoring: a hidden SSID, a radio the chip lacks. The page checks the same things here.'),
      hw.notes?.length ? h('ul', {}, hw.notes.map(x => h('li.hint', {}, x))) : null)));
}

/** ID tab: the callsign, and whether it is the name on the air. */
export function renderId(root) {
  const d = app.cfg.id, name = displayName(app.cfg);
  const callInput = h('input', { type: 'text', value: d.callmessage, maxlength: 64, spellcheck: 'false', style: 'width:100%;text-transform:uppercase' });
  callInput.addEventListener('input', () => { d.callmessage = callInput.value.toUpperCase(); app.changed('id-live'); });
  root.replaceChildren(h('div.cols', {},
    h('div.card', {}, h('h3', {}, 'Callsign / operator'),
      field('callmessage', callInput, 'Who is responsible for this fox. A network fox sends no Morse; this is the fleet record and, if ticked below, the name on the air. The N0CALL placeholder keeps the fox silent, as for the FM foxes.'),
      check('Use the callsign as the SSID / BLE name', d.use_callsign_as_name, v => { d.use_callsign_as_name = v; app.changed('id'); }, `on the air as "${name}". Untick to use the name on the Radio tab (a contest will usually want its own name).`),
      issueList('id')),
    h('div.card', {}, h('h3', {}, 'On the air'),
      h('dl.kv', {}, h('dt', {}, 'Name'), h('dd.mono', {}, name || '—'), h('dt', {}, 'MAC'), h('dd.mono', {}, app.cfg.net.mac || '—'), h('dt', {}, 'Cycle'), h('dd', {}, `${app.cfg.schedule.wake_s} s on, ${app.cfg.schedule.sleep_s} s ${app.cfg.schedule.sleep === 'deep' ? 'deep sleep' : 'off'}`)),
      h('p.hint', {}, 'Part 15 devices do not identify in Morse; amateur-radio hunt organisers still like a callsign in the name. Both are one tick away.'))));
}

/** Schedule tab: the duty cycle and how the fox spends the off time. */
export function renderSchedule(root) {
  const s = app.cfg.schedule;
  const canvas = h('canvas.preview', { style: 'height:70px' });
  const items = cycle(app.cfg), horizon = Math.max(60000, (s.wake_s + s.sleep_s) * 1000 * 6);
  root.replaceChildren(h('div.cols', {},
    h('div.card', {}, h('h3', {}, 'Duty cycle'),
      h('div.two-col', {},
        field('On the air (s)', numInput(s.wake_s, { min: 1, max: 3600, step: 1, onchange: v => { s.wake_s = v; app.changed('schedule'); } }), 'radio up, LED on'),
        field('Off (s)', numInput(s.sleep_s, { min: 0, max: 86400, step: 1, onchange: v => { s.sleep_s = v; app.changed('schedule'); } }), '0 = always on')),
      field('Off time', select([['off', 'radio off, board awake (USB and Listen only stay up)'], ['deep', 'deep sleep (battery; the USB port disappears until it wakes)']], s.sleep, v => { s.sleep = v; app.changed('schedule'); }),
        'Deep sleep is what kitsune does and what a battery wants; "radio off" is what a bench wants. With deep sleep the page\'s Listen only reconnects when the port returns, and the cycle count restarts at 0 each wake (the board reboots).'),
      issueList('schedule')),
    h('div.card', {}, h('h3', {}, 'Preview'),
      h('div.screen', {}, canvas),
      h('p.hint', {}, `${items.filter(i => i.kind === 'tx').length} wakes in the next ${Math.round(horizon / 60000)} min; on the air ${Math.round(items.filter(i => i.kind === 'tx').reduce((a, i) => a + i.dur, 0) / horizon * 100)}% of the time.`))));
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = canvas.clientHeight || 70; canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    for (const it of items) { if (it.t > horizon) break; ctx.fillStyle = it.kind === 'tx' ? (css.getPropertyValue('--tx').trim() || '#2a9d8f') : it.kind === 'sleep' ? (css.getPropertyValue('--line').trim() || '#444') : (css.getPropertyValue('--ink-3').trim() || '#888'); ctx.fillRect(it.t / horizon * W, it.kind === 'tx' ? 12 : 44, Math.max(1, it.dur / horizon * W), it.kind === 'tx' ? 36 : 6); }
  });
}
