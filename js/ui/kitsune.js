// kitsune.js — the tabs' content for the compiled family (RFHS kitsune foxes): challenge, radio section, channel,
// duty cycle. Each tab module calls the matching render when app.isCompiled; the model is js/model/vendor/kitsune.js.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select, numInput, check } from './dom.js';

let app;
export function init(a) { app = a; }   // idempotent; every tab that renders a kitsune form calls it from its own init

const sec = () => app.vendor.TEMPLATES[app.templateId]?.section;
const mode = () => app.vendor.TEMPLATES[app.templateId]?.mode;
const text = (obj, key, { max = 64, upper = false, mono = false, placeholder = '' } = {}, on = 'id') => {
  const el = h('input', { type: 'text', value: obj[key] ?? '', maxlength: max, spellcheck: 'false', placeholder, style: 'width:100%' + (upper ? ';text-transform:uppercase' : '') + (mono ? ';font-family:var(--mono)' : '') });
  el.addEventListener('change', () => { obj[key] = upper ? el.value.toUpperCase() : el.value; app.changed(on); });
  return el;
};
const issuesFor = prefix => (app.issues || []).filter(i => i.key === prefix || i.key.startsWith(prefix + '.')).concat((app.report || []).filter(r => r.key === prefix || r.key.startsWith(prefix + '.')).map(r => ({ level: 'err', key: r.key, msg: r.reason })));
const issueList = prefix => { const l = issuesFor(prefix); return l.length ? h('ul', { style: 'margin:6px 0 0;padding-left:1.2em' }, l.map(i => h('li', { class: i.level === 'err' ? 'hint err' : i.level === 'warn' ? 'hint warn' : 'hint', style: 'font-size:.9rem' }, h('code', {}, i.key), ' ', i.msg))) : null; };

function macField(obj, bytes) {
  const v = app.vendor;
  const input = text(obj, 'mac', { max: bytes * 3 - 1, upper: true, mono: true, placeholder: bytes === 8 ? 'F2:..:..:..:..:..:..:..' : 'F2:..:..:..:..:..' });
  return field(bytes === 8 ? 'EUI-64 (spoofed)' : 'MAC address (spoofed)',
    h('div.row', {}, input, h('button.btn.small', { onclick: () => { obj.mac = v.randomMac(bytes); app.changed('id'); } }, 'roll')),
    `Locally administered and unicast: kitsune uses F2 as the first byte so a fox is never mistaken for someone's real device. "roll" makes a fresh random one, like their make_conference does per event.`);
}

/** ID tab: the challenge card and the section the hunters meet (SSID / device name / beacon). */
export function renderId(root) {
  const cfg = app.cfg, c = cfg.challenge, s = sec(), r = cfg[s] || {};
  const challenge = h('div.card', {}, h('h3', {}, 'Challenge ', issuesFor('challenge').some(i => i.level === 'err') ? badge('incomplete', 'err') : badge('set', 'ok')),
    field('Name on the scoreboard', text(c, 'name', { max: 64 }), 'RFHS_CHALLENGE_NAME in the header; what the kit sheet and the scoreboard call this fox.'),
    field('Key phrase', text(c, 'keyphrase', { max: 120 }), `What a hunter must say to the fox holder to claim the kit (FOX_KEYWORDS). The sheet prints "Hunter should ask '…'".`),
    field('Tier', select(app.vendor.TIERS.map(t => [t, t]), c.tier, t => { c.tier = t; app.changed('id'); }), 'A label: kitsune picks a block of values by tier at build time (-D EASY / -D HARD); this page writes one explicit block and the export guards it with that tier.'),
    issueList('challenge'));
  let radio;
  if (s === 'wifi') {
    radio = h('div.card', {}, h('h3', {}, mode() === 'AP' ? 'Access point' : 'Client'),
      field('SSID', text(r, 'ssid', { max: 32 }), mode() === 'AP' ? 'The network name the fox raises (≤ 32 bytes).' : 'The network the client probes for.'),
      field('Passphrase', text(r, 'psk', { max: 63, mono: true }), 'WPA2, 8–63 characters; empty = open.'),
      macField(r, 6),
      mode() === 'AP' ? h('div.two-col', {},
        h('div.field', {}, h('label', {}, 'Visibility'), check('Hidden SSID (beacons without the name)', !!r.hidden, val => { r.hidden = val; app.changed('id'); })),
        field('Max clients', numInput(r.max_clients, { min: 1, max: 4, step: 1, onchange: v => { r.max_clients = v; app.changed('id'); } }))) : null,
      issueList('wifi'));
  } else if (s === 'ble') {
    radio = h('div.card', {}, h('h3', {}, 'iBeacon'),
      field('Device name', text(r, 'device_name', { max: 29 }), 'Shown by scanners that read the scan response (kitsune advertises ADV_TYPE_SCAN_IND, so the name is visible).'),
      field('Beacon UUID', h('div.row', {}, text(r, 'uuid', { max: 36, mono: true }), h('button.btn.small', { onclick: () => { r.uuid = crypto.randomUUID(); app.changed('id'); } }, 'new')), '8-4-4-4-12 hex; the proximity UUID in the iBeacon frame (manufacturer 0x004C).'),
      h('div.two-col', {}, field('Major', numInput(r.major, { min: 0, max: 65535, step: 1, onchange: v => { r.major = v; app.changed('id'); } })), field('Minor', numInput(r.minor, { min: 0, max: 65535, step: 1, onchange: v => { r.minor = v; app.changed('id'); } }))),
      field('Measured power at 1 m (dBm)', numInput(r.signal_power_dbm, { min: -127, max: 0, step: 1, onchange: v => { r.signal_power_dbm = v; app.changed('id'); } }), 'The calibration byte in the frame (SIGNAL_POWER; −59 = 0xC5), what a phone uses to estimate distance.'),
      macField(r, 6),
      issueList('ble'));
  } else if (s === 'bt') {
    radio = h('div.card', {}, h('h3', {}, 'Bluetooth Classic'),
      field('Device name', text(r, 'name', { max: 64 }), 'What a classic inquiry scan shows.'),
      macField(r, 6),
      issueList('bt'));
  } else if (s === 'zigbee') {
    radio = h('div.card', {}, h('h3', {}, 'Zigbee coordinator'),
      macField(r, 8),
      h('p.hint', {}, 'The PAN ID is chosen by the stack when the network forms; the channel is on the Plan tab.'),
      issueList('zigbee'));
  }
  root.replaceChildren(h('div.cols', {}, challenge, radio),
    h('div.card', {}, h('h3', {}, 'Kit sheet lines'), h('pre.mono', { style: 'white-space:pre-wrap;font-size:.85rem' }, app.vendor.sheetLines(app.validCfg || cfg).join('\n')), h('p.hint', {}, 'What kitsune\'s make_conference_full prints for this fox; the three-word flag is rolled by their script.')));
}

/** Plan tab: the channel (Wi-Fi AP, Zigbee); nothing to plan for the others. */
export function renderPlan(root) {
  const cfg = app.cfg, s = sec(), r = cfg[s] || {}, hw = app.hardware || {}, v = app.vendor;
  if (s === 'wifi' && mode() === 'AP') {
    const five = r.band === '5';
    const chans = five ? v.WIFI5_CHANNELS : [...v.WIFI24_CHANNELS, ...v.WIFI24_CHANNELS_13];
    root.replaceChildren(h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Channel'),
        hw.radios?.includes('wifi5') ? field('Band', select([['2.4', '2.4 GHz'], ['5', '5 GHz']], r.band, b => { r.band = b; if (r.channel && !(b === '5' ? v.WIFI5_CHANNELS : v.WIFI24_CHANNELS).includes(r.channel)) r.channel = 0; app.changed('plan'); }), 'This board has both radios; kitsune builds the 5 GHz variants with -D FIVEEASY / FIVEHARD.') : null,
        field('Channel', select([[0, 'random at every wake'], ...chans.map(c => [c, `${c}${!five && c > 11 ? ' (not in every domain)' : ''}`])], r.channel, c => { r.channel = Number(c); app.changed('plan'); }), five ? 'kitsune\'s 5 GHz list: UNII-1 and UNII-3, no DFS channels.' : 'kitsune\'s random pick is 1–11 ("worldwide"); it sets the regulatory domain to US.'),
        issueList('wifi.channel'), issueList('wifi.band')),
      h('div.card', {}, h('h3', {}, 'Why a random channel'), h('p.hint', {}, 'A fixed channel lets a hunter park a receiver there; random at every wake (the hard tiers) makes them scan. Either way the SSID and BSSID stay the same, so the fox is still the same fox on the scoreboard.'))));
    return;
  }
  if (s === 'zigbee') {
    root.replaceChildren(h('div.card', {}, h('h3', {}, 'Channel'),
      field('802.15.4 channel', select([[0, 'random at every wake'], ...v.ZIGBEE_CHANNELS.map(c => [c, String(c)])], r.channel, c => { r.channel = Number(c); app.changed('plan'); }), 'Channels 11–26 in the 2.4 GHz band (kitsune\'s random pick is the same range).'),
      issueList('zigbee.channel')));
    return;
  }
  root.replaceChildren(h('div.card', {}, h('p.hint', {}, s === 'wifi' ? 'A Wi-Fi client follows the network it joins; there is no channel to plan.' : 'This challenge has no channel plan: BLE advertising hops over its three advertising channels by itself.')));
}

/** Radio tab: transmit power and what the board has. */
export function renderRadio(root) {
  const cfg = app.cfg, s = sec(), r = cfg[s] || {}, hw = app.hardware || {}, v = app.vendor;
  const radios = { wifi24: 'Wi-Fi 2.4 GHz', wifi5: 'Wi-Fi 5 GHz', ble: 'BLE', btclassic: 'Bluetooth Classic', ieee802154: '802.15.4 (Zigbee)' };
  let power = null;
  if (s === 'wifi') power = field('Transmit power', select(v.WIFI_POWER_DBM.map(p => [p, `${p} dBm`]), r.tx_power_dbm, p => { r.tx_power_dbm = Number(p); app.changed('radio'); }), 'WiFi.setTxPower() levels; kitsune uses 17 dBm for easy and 7 dBm for hard.');
  else if (s === 'ble') power = h('div', {}, field('Advertising power', select(v.BLE_POWER_DBM.map(p => [p, `${p} dBm`]), r.tx_power_dbm, p => { r.tx_power_dbm = Number(p); app.changed('radio'); }), 'ESP_PWR_LVL_N12 … P9; kitsune: +9 easy, 0 medium, −12 hard.'),
    h('div.two-col', {}, field('Advertising interval, min', numInput(r.adv_min, { min: 32, max: 16384, step: 1, onchange: x => { r.adv_min = x; app.changed('radio'); } }), `${(r.adv_min * 0.625).toFixed(0)} ms`), field('max', numInput(r.adv_max, { min: 32, max: 16384, step: 1, onchange: x => { r.adv_max = x; app.changed('radio'); } }), `${(r.adv_max * 0.625).toFixed(0)} ms`)),
    h('p.hint', {}, 'Units of 0.625 ms. 32/64 ≈ 43 ms (easy to see in nRF Connect); 400/500 ≈ 315 ms; 5000/6000 ≈ 4–7 s.'));
  else if (s === 'zigbee') power = field('Transmit power (dBm)', numInput(r.tx_power_dbm, { min: v.ZIGBEE_POWER_RANGE[0], max: v.ZIGBEE_POWER_RANGE[1], step: 1, onchange: p => { r.tx_power_dbm = p; app.changed('radio'); } }), `${v.ZIGBEE_POWER_RANGE[0]} to ${v.ZIGBEE_POWER_RANGE[1]} dBm on the ESP32-C5; kitsune: 20 easy, −12 hard.`);
  else power = h('p.hint', {}, 'Bluetooth Classic in kitsune uses the stack\'s default power.');
  root.replaceChildren(h('div.cols', {},
    h('div.card', {}, h('h3', {}, 'Power'), power, issueList(s + '.tx_power_dbm')),
    h('div.card', {}, h('h3', {}, 'This board'),
      h('dl.kv', {}, h('dt', {}, 'Radios'), h('dd', {}, (hw.radios || []).map(x => radios[x] || x).join(', ')), h('dt', {}, 'This challenge'), h('dd', {}, radios[app.vendor.TEMPLATES[app.templateId]?.radio] || '—'), h('dt', {}, 'LED'), h('dd', {}, hw.led?.note || '—')),
      h('div.field', {}, h('label', {}, 'Status LED'), check('kitsune drives the LED (violet at init, green/orange/blue/cyan awake, red asleep, red/yellow blink = failed)', cfg.led?.enabled !== false, val => { cfg.led = { ...cfg.led, enabled: val }; app.changed('radio'); }, 'Informational for now: kitsune has no switch for it; a later build may read this.')),
      issueList('board'))));
}

/** Schedule tab: the duty cycle, drawn. */
let horizonMin = 10;
export function renderSchedule(root) {
  const s = app.cfg.schedule, v = app.vendor, cfg = app.validCfg || app.cfg;
  const horizon = horizonMin * 60000, items = v.cycle(cfg, horizon);
  const onAir = items.filter(i => i.kind === 'tx').reduce((a, i) => a + i.dur, 0), wakes = items.filter(i => i.kind === 'tx').length;
  const canvas = h('canvas.preview', { style: 'height:70px' });
  root.replaceChildren(h('div.cols', {},
    h('div.card', {}, h('h3', {}, 'Duty cycle'),
      h('div.two-col', {},
        field('Awake (s)', numInput(s.wake_s, { min: 1, max: 86400, step: 1, onchange: x => { s.wake_s = x; app.changed('schedule'); } }), 'TIME_TO_WAKE: radio on, transmitting, LED showing state.'),
        field('Deep sleep (s)', numInput(s.sleep_s, { min: 0, max: 86400, step: 1, onchange: x => { s.sleep_s = x; app.changed('schedule'); } }), 'TIME_TO_SLEEP: radio off, LED red; 0 = never sleeps (restarts after each wake so the self-checks run again).')),
      issueList('schedule'), issueList('battery')),
    h('div.card', {}, h('h3', {}, 'Timeline ', badge(`${wakes} wakes in ${horizonMin} min · ${Math.round(onAir / 60000 * 10) / 10} min on the air`)),
      h('div.tools', { style: 'margin-bottom:8px' }, h('span.hint', {}, 'Horizon:'), [5, 10, 30, 60].map(m => h('button.btn.small', { 'aria-pressed': m === horizonMin ? 'true' : 'false', onclick: () => { horizonMin = m; renderSchedule(root); } }, m + ' min'))),
      h('div.screen', {}, canvas),
      h('p.hint', {}, 'Deterministic from power-on: awake, asleep, awake… kitsune subtracts its fixed delays from the sleep so the period stays as set. Hunters see a fox that appears and vanishes on this rhythm.'))));
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = canvas.clientHeight || 70; canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    for (const it of items) { ctx.fillStyle = it.kind === 'tx' ? (css.getPropertyValue('--tx').trim() || '#2a9d8f') : (css.getPropertyValue('--line').trim() || '#444'); ctx.fillRect(it.t / horizon * W, it.kind === 'tx' ? 12 : 40, Math.max(1, it.dur / horizon * W), it.kind === 'tx' ? 36 : 8); }
  });
}
