// net.js — the Radio, ID and Schedule tabs for network foxes (wifi-beacon, wifi-probe, ble-beacon): the SoC's own radio
// on a duty cycle. Contract: js/model/netschema.js (firmware twin foxlib/netcfg.py).
// SPDX-License-Identifier: GPL-2.0-only
import { h, field, select, numInput, check, badge } from './dom.js';
import { WIFI24_CHANNELS, WIFI5_CHANNELS, WIFI_POWER_DBM, BLE_POWER_DBM, MAX_NAME, MAX_NAMES, MAX_DECOYS, MAX_BODY, MAX_URL, MAX_CODE, FEATURES, FEATURE_DEFAULTS, FEATURE_PHASE, randomMac, displayName, cycle, nameForCycle } from '../model/netschema.js';
import { TABLE as MORSE } from '../audio/morse.js';

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
    'Locally administered and unicast. A hunter\'s scanner shows it as the BSSID / device address; keep one per fox and write it on the fleet sheet.');
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
        check('Hidden SSID', n.hidden, v => { n.hidden = v; app.changed('radio'); }, 'not possible with this firmware (noted here and in the fox\'s banner)'),
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
    wiringCard(labels)));
}

const NET_ROLE_HELP = { led: 'status LED: blinks while the radio is up; "none" for a board without one (the bare XIAO C3)', batt_sense: 'battery divider on an ADC pin — reserved; no board in the catalog has one wired yet' };

/** Wiring card for a chip target: which physical board (when the chip's variants differ in pins), its radios and build,
 *  and the two pins a network fox may use — same shape as the FM family's wiring table. */
function wiringCard(labels) {
  const b = app.board, cfg = app.cfg, hw = app.hardware || {}, radios = hw.radios || [], pins = cfg.pins || (cfg.pins = { led: null, batt_sense: null });
  const probs = Object.fromEntries(app.report.filter(r => r.key.startsWith('pins.')).map(r => [r.key.slice(5), r.reason]));
  const defaults = app.netRolesOf(b);
  const variants = app.variants;
  const boardRow = variants.length > 1
    ? field('Board', Object.assign(select(variants.map(v => [v.hardware, v.variantName]), app.variantId, v => app.setVariant(v)), { style: 'width:100%;max-width:100%' }),
        app.variantsDifferInPins ? 'the physical board this chip is on: sets the LED / battery pins below and the CircuitPython build to flash' : 'these boards wire the same way; the choice records which one this is (fleet log, hardware log) and picks the CircuitPython build')
    : null;
  // the card shares the row with the radio form, so the table is three columns with the help under the pin, and the pin
  // notes are tooltips on the options rather than in their labels (a long label widens the select past the card)
  const rows = ['led', 'batt_sense'].map(role => {
    const opts = [['', '— none —'], ...(b.pins || []).map(p => [p.name, `${p.name} (GPIO${p.gpio}${p.aliases?.length ? ', ' + p.aliases.join('/') : ''})`])];
    const sel = select(opts, pins[role] || '', v => { pins[role] = v || null; app.changed('pins'); });
    sel.style.maxWidth = '100%';
    for (const o of sel.options) { const p = (b.pins || []).find(x => x.name === o.value); if (p?.note) o.title = p.note; }
    const def = defaults[role], cur = pins[role] || null, note = (b.pins || []).find(x => x.name === cur)?.note;
    return h('tr', { class: probs[role] ? 'bad' : '' },
      h('td.mono', {}, role, h('div.hint', {}, 'optional')),
      h('td', {}, sel, h('div.hint', {}, probs[role] ? h('span.err', {}, probs[role]) : NET_ROLE_HELP[role]), note ? h('div.hint', {}, note) : null),
      h('td.mono', {}, def || '—', def !== cur ? h('button.btn.small', { style: 'margin-left:8px', onclick: () => { pins[role] = def; app.changed('pins'); } }, 'reset') : null));
  });
  return h('div.card', {}, h('h3', {}, `Wiring: ${b.variantName || b.name} `, app.report.some(r => r.key.startsWith('pins.')) ? badge('check', 'err') : badge('ok', 'ok')),
    boardRow,
    h('dl.kv', {}, h('dt', {}, 'Radios'), h('dd', {}, radios.map(r => labels[r] || r).join(', ') || 'unknown'),
      h('dt', {}, 'Firmware'), h('dd', {}, `CircuitPython (${b.circuitpython?.board_id || '?'}) + foxlib ${app.catalog.foxlibVersion}: the SoC's own radio, no module`)),
    h('p.hint', {}, 'Defaults come from the board descriptor; change them if yours is wired differently. The firmware resolves each name with ', h('code', {}, 'getattr(board, name)'), ' at boot; a name the board does not have falls back to the default and is reported in the banner.'),
    h('div.grid-wrap', {}, h('table.grid.wiring', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Role'), h('th', {}, 'Pin'), h('th', {}, 'Default'))), h('tbody', {}, rows))),
    h('p.hint', {}, 'What the firmware cannot do, it says in its banner rather than ignoring: a hidden SSID, a radio the chip lacks. The page checks the same things here.'),
    hw.notes?.length ? h('ul', {}, hw.notes.map(x => h('li.hint', {}, x))) : null);
}

/** ID tab: the callsign, and whether it is the name on the air. */
export function renderId(root) {
  const d = app.cfg.id, name = displayName(app.cfg);
  const callInput = h('input', { type: 'text', value: d.callmessage, maxlength: 64, spellcheck: 'false', style: 'width:100%;text-transform:uppercase' });
  callInput.addEventListener('input', () => { d.callmessage = callInput.value.toUpperCase(); app.changed('id-live'); });
  root.replaceChildren(h('div.cols', {},
    h('div.card', {}, h('h3', {}, 'Callsign / operator'),
      field('callmessage', callInput, 'Who is responsible for this fox. A network fox sends no Morse; this is the fleet record and, if ticked below, the name on the air. With the placeholder the fox still runs under its own name (a Part 15 device need not identify); it is refused only when the placeholder would be the name on the air.'),
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
        'Deep sleep is what a battery wants; "radio off" is what a bench wants. With deep sleep the page\'s Listen only reconnects when the port returns, and the cycle count restarts at 0 each wake (the board reboots).'),
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


// ---- Payload tab: the contest features (docs/network-fox-payloads-plan.md). Four cards, one per section; a section is
// absent from fox.json until its card is switched on, and goes back to absent when switched off. The firmware that acts
// on each arrives in phases B-E; until then the card says so and the fox's banner names the section as accepted.
const FEATURE_TITLE = { payload: 'What the fox says', checkpoint: 'What the fox serves', sense: 'What the fox listens for', stealth: 'How hard it is to find' };
const FEATURE_BLURB = {
  payload: 'Names that change each cycle, a Morse string as the name, a code in the beacon, an Eddystone URL / telemetry frame, a clue split across Wi-Fi and BLE.',
  checkpoint: 'An open network with a sign-in page that shows a code and takes a callsign (logged on the fox), or a BLE service a hunter reads the code from. Puzzle delivery and a checkpoint log — not the scored find.',
  sense: 'The fox watches for hunter tags, for another fox on the air, or for phones probing nearby, and logs or reacts.',
  stealth: 'A new MAC each cycle, names drawn at random, jittered timing, a silent start until a time, decoy names, BLE only.',
};
const sect = (sec) => app.cfg[sec] ?? null;
const on = (sec, v) => { if (v) { app.cfg[sec] = structuredClone(FEATURE_DEFAULTS[sec]); app.cfg[sec].enabled = true; } else delete app.cfg[sec]; app.changed('payload'); };
const fld = (obj, key, label, opts, hint) => field(label, text(obj, key, opts, 'payload'), hint);
const num = (obj, key, label, { min, max, width = '110px' }, hint) => field(label, numInput(obj[key], { min, max, step: 1, width, onchange: v => { obj[key] = Math.round(v); app.changed('payload'); } }), hint);
const chk = (obj, key, label, hint) => check(label, obj[key], v => { obj[key] = v; app.changed('payload'); }, hint);
const sel = (obj, key, label, options, hint) => field(label, select(options, obj[key], v => { obj[key] = v; app.changed('payload'); }), hint);
const lines = (obj, key, label, max, each, hint) => {
  const ta = h('textarea', { rows: Math.min(6, Math.max(3, (obj[key] || []).length + 1)), style: 'width:100%;font-family:var(--mono)', spellcheck: 'false' }, (obj[key] || []).join('\n'));
  ta.addEventListener('change', () => { obj[key] = ta.value.split('\n').map(x => x.trim()).filter(Boolean); app.changed('payload'); });
  const over = (obj[key] || []).filter(x => blen(x) > each).length;
  return field(label, ta, `${hint} One per line, up to ${max}; each 1–${each} bytes.${over ? ` ${over} over ${each} bytes.` : ''}`);
};

function featureCard(sec, body) {
  const c = sect(sec), built = app.catalog.foxlibFeatures?.includes(sec);
  const head = h('div.row', { style: 'justify-content:space-between;align-items:center' },
    h('h3', { style: 'margin:0' }, FEATURE_TITLE[sec], ' ', h('code', {}, sec), ' ', c ? badge('on', 'ok') : badge('off', '')),
    check('Enable', !!c, v => on(sec, v)));
  return h('div.card', {}, head, h('p.hint', {}, FEATURE_BLURB[sec]),
    built ? null : h('p.hint.warn', {}, `Firmware for this section arrives in phase ${FEATURE_PHASE[sec]} (foxlib ${app.catalog.foxlibVersion} accepts the settings, names the section in its banner, and runs without it).`),
    c ? body(c) : null, c ? issueList(sec) : null);
}

export function renderPayload(root) {
  const hw = app.hardware || {}, radios = hw.radios || [], wifi = radios.includes('wifi24'), ble = radios.includes('ble'), kind = app.cfg.net?.kind;
  const preview = c => {
    const names = [0, 1, 2].map(n => nameForCycle(app.cfg, n, MORSE));
    const frames = kind === 'ble' ? ['iBeacon' + ((c.code.major || c.code.minor) ? ` ${c.code.major}/${c.code.minor}` : ''), c.eddystone.url ? 'Eddystone-URL' : null, c.eddystone.tlm ? 'Eddystone-TLM' : null].filter(Boolean) : [];
    return h('p.hint', {}, h('b', {}, 'On the air: '), `cycles 0, 1, 2 → ${names.map(n => '"' + n + '"').join(', ')}`,
      frames.length > 1 ? ` · BLE frames ${frames.join(' → ')} every ${c.interleave_ms} ms` : frames.length === 1 ? ` · ${frames[0]}` : '',
      c.split.wifi && c.split.ble ? ` · split clue: Wi-Fi "${c.split.wifi}" + BLE "${c.split.ble}"` : '');
  };
  const payloadBody = c => h('div', {},
    preview(c),
    h('div.two-col', {},
      sel(c, 'kind', 'Name on the air', [['static', 'static — the configured name / callsign'], ['rotate', 'rotate — one of the names below per cycle'], ['morse-name', 'morse-name — the Morse of a word, as the name']]),
      c.kind === 'morse-name' ? fld(c, 'morse_of', 'Word to send as Morse', { max: 16, upper: true }, 'becomes "-.- -.-- ...." on the air (≤ 32 bytes after encoding)') : null),
    c.kind === 'rotate' ? lines(c, 'names', 'Names, in order', MAX_NAMES, MAX_NAME, 'The SSID / BLE name this cycle is the next line.') : null,
    kind === 'ble' || ble ? h('div.two-col', {},
      field('Beacon code', h('div.row', {}, numInput(c.code.major, { min: 0, max: 65535, step: 1, width: '100px', onchange: v => { c.code.major = Math.round(v); app.changed('payload'); } }), h('span.hint', {}, 'major'),
        numInput(c.code.minor, { min: 0, max: 65535, step: 1, width: '100px', onchange: v => { c.code.minor = Math.round(v); app.changed('payload'); } }), h('span.hint', {}, 'minor')), 'iBeacon major/minor as a checkpoint number, a grid reference, a code'),
      num(c, 'interleave_ms', 'Frame interleave', { min: 100, max: 10000 }, 'ms between the iBeacon, URL and telemetry frames when more than one is on')) : null,
    kind === 'ble' || ble ? h('div.two-col', {},
      fld(c.eddystone, 'url', 'Eddystone URL', { max: MAX_URL, placeholder: 'https://…' }, 'the phone offers to open it (≤ 64 chars; only http/https)'),
      chk(c.eddystone, 'tlm', 'Eddystone telemetry', 'battery, temperature, uptime, frame count — a fox that says how long it has been out')) : null,
    wifi && ble ? h('div.two-col', {}, fld(c.split, 'wifi', 'Split clue — Wi-Fi half', { max: MAX_NAME }, 'an SSID a hunter needs together with…'), fld(c.split, 'ble', 'Split clue — BLE half', { max: 29 }, '…this BLE name')) : null);
  const checkpointBody = c => h('div', {},
    h('div.card', { style: 'margin-top:8px' }, chk(c.portal, 'enabled', 'Sign-in page (captive portal) on an open Wi-Fi network', wifi ? '' : 'needs a Wi-Fi radio'),
      c.portal.enabled ? h('div', {}, h('div.two-col', {}, fld(c.portal, 'title', 'Page title', { max: 40 }), fld(c.portal, 'code', 'Code shown', { max: MAX_CODE, mono: true })),
        field('Page text', (() => { const ta = h('textarea', { rows: 4, style: 'width:100%', maxlength: MAX_BODY }, c.portal.body); ta.addEventListener('change', () => { c.portal.body = ta.value; app.changed('payload'); }); return ta; })(), `plain text, ≤ ${MAX_BODY} bytes (${blen(c.portal.body)} used)`),
        h('div.two-col', {}, chk(c.portal, 'ask_callsign', 'Ask for a callsign', 'a one-field form; what is typed goes into the find log'), chk(c.portal, 'captive_dns', 'Captive DNS', 'the phone opens the page by itself on joining; off = hunters open http://192.168.4.1')),
        chk(c.portal, 'log', 'Keep a find log on the fox', 'finds.csv — fox uid, cycle, time since boot, callsign, client MAC; Collect finds on the Bench tab reads it into the fleet log')) : null),
    h('div.card', { style: 'margin-top:8px' }, chk(c.ble, 'enabled', 'BLE service with the code', ble ? 'a connectable service beside the beacon; a scanner app reads the code from a characteristic' : 'needs a BLE radio'),
      c.ble.enabled ? h('div.two-col', {}, fld(c.ble, 'service_uuid', 'Service UUID', { max: 36, upper: true, mono: true }), fld(c.ble, 'code', 'Code', { max: MAX_CODE, mono: true })) : null));
  const senseBody = c => h('div', {},
    num(c, 'slot_ms', 'Listening slot', { min: 200, max: 5000 }, 'ms of each second the radio listens instead of transmitting'),
    h('div.card', { style: 'margin-top:8px' }, chk(c.tags, 'enabled', 'Hunter tags', ble ? '' : 'needs a BLE radio'),
      c.tags.enabled ? h('div', {}, h('p.hint.warn', {}, h('b', {}, 'Needs: '), 'one BLE tag per team, named with the prefix below (e.g. HUNT-RED). Hand them out at registration; the fox logs each one it hears.'),
        h('div.two-col', {}, fld(c.tags, 'match', 'Tag name prefix', { max: 16, upper: true, mono: true }), num(c.tags, 'rssi_min', 'Log when stronger than', { min: -100, max: 0 }, 'dBm; −80 is "within a few metres"')),
        chk(c.tags, 'log', 'Keep a near log on the fox', 'near.csv, same columns as the find log plus kind=tag')) : null),
    h('div.card', { style: 'margin-top:8px' }, chk(c.relay, 'enabled', 'Relay / chain', 'this fox waits for another fox on the air'),
      c.relay.enabled ? h('div.two-col', {}, fld(c.relay, 'wait_for', 'Network to wait for', { max: MAX_NAME }, 'the other fox\'s SSID'), sel(c.relay, 'then', 'When heard', [['up', 'go on the air'], ['down', 'go quiet'], ['rotate', 'move to the next name']])) : null),
    h('div.card', { style: 'margin-top:8px' }, chk(c.probes, 'enabled', 'Count phones probing nearby', wifi ? 'wifi.Monitor on the ESP32 family; the banner reports near=<n>' : 'needs a Wi-Fi radio'),
      c.probes.enabled ? h('div.two-col', {}, num(c.probes, 'channel', 'Channel to listen on', { min: 1, max: 13 }), num(c.probes, 'window_s', 'Window', { min: 1, max: 10 }, 's per cycle')) : null));
  const stealthBody = c => h('div', {},
    h('div.two-col', {},
      sel(c, 'rotate_mac', 'MAC address', [[false, 'fixed (net.mac)'], ['per-cycle', 'new one each cycle'], ['per-boot', 'new one each boot']]),
      chk(c, 'rotate_name', 'Names at random', 'draw from the payload names in random order instead of in turn')),
    h('div.two-col', {},
      num(c, 'duty_jitter_s', 'Timing jitter', { min: 0, max: 300 }, '± s on each wake and sleep, at random'),
      chk(c, 'ble_only', 'BLE only', ble ? 'the Wi-Fi radio is never enabled' : 'needs a BLE radio')),
    h('div.two-col', {},
      num(c.start, 'after_s', 'Silent for', { min: 0, max: 86400 }, 's after power-on, then starts'),
      fld(c.start, 'at', 'Or silent until', { max: 32, mono: true, placeholder: '2026-08-08T09:00:00-04:00' }, 'needs the board clock set at deploy (Deploy tab)')),
    lines(c, 'decoys', 'Decoy names', MAX_DECOYS, MAX_NAME, 'Extra SSIDs the fox cycles through for a few seconds each, so the list shows several.'));
  root.replaceChildren(h('div', {},
    h('p.hint', {}, 'Each section is written into fox.json only while it is on. ', h('a', { href: 'docs/network-fox-payloads-plan.md', target: '_blank', rel: 'noopener' }, 'The plan'), ' says what each does and when its firmware lands.'),
    featureCard('payload', payloadBody), featureCard('checkpoint', checkpointBody), featureCard('sense', senseBody), featureCard('stealth', stealthBody)));
}
