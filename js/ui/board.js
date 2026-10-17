// board.js — Board & pins tab: board choice, role → pin table with validation.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select } from './dom.js';
import { REQUIRED_PINS, OPTIONAL_PINS, PIN_FLAGS, findPin } from '../model/schema.js';

const ROLE_HELP = {
  ptt: 'Push-to-talk. Low = transmit.', pd: 'Power-down. Held high keeps the module awake.', hl: 'High/low power select. Low = low power (default).',
  uart_tx: 'Serial to the module (AT commands).', uart_rx: 'Serial from the module.', audio: 'PWM tone into the module\'s MIC input.',
  led: 'Status LED, one blink per cycle. Optional.', batt_sense: 'ADC pin on a battery divider. Leave unset if no divider is fitted — a floating pin reads garbage.',
};
let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

function render() {
  const b = app.board, cfg = app.cfg, pins = cfg.pins;
  const probs = Object.fromEntries(app.report.filter(r => r.key.startsWith('pins.')).map(r => [r.key.slice(5), r.reason]));
  for (const i of app.issues) if (i.key.startsWith('pins.')) probs[i.key.slice(5)] = probs[i.key.slice(5)] || i.msg;
  const used = new Map(); for (const r of [...REQUIRED_PINS, ...OPTIONAL_PINS]) if (pins[r]) used.set(pins[r], r);
  const required = new Set(app.template.pins.required);

  const rows = [...REQUIRED_PINS, ...OPTIONAL_PINS].map(role => {
    const flag = PIN_FLAGS[role];
    const opts = [['', '— none —'], ...b.pins.filter(p => !flag || p[flag]).map(p => [p.name, `${p.name}  (GPIO${p.gpio}${p.aliases?.length ? ', ' + p.aliases.join('/') : ''})${used.has(p.name) && used.get(p.name) !== role ? '  · used by ' + used.get(p.name) : ''}${p.note ? '  · ' + p.note : ''}`])];
    const sel = select(opts, pins[role] || '', v => { cfg.pins[role] = v || null; app.changed('pins'); });
    if (required.has(role)) sel.querySelector('option[value=""]').disabled = true;
    const def = app.defaults.pins[role];
    return h('tr', { class: probs[role] ? 'bad' : '' },
      h('td.mono', {}, role, required.has(role) ? '' : h('span.hint', {}, ' optional')),
      h('td', {}, sel),
      h('td.mono', {}, def || '—', def !== (pins[role] || null) ? h('button.btn.small', { style: 'margin-left:8px', onclick: () => { cfg.pins[role] = def; app.changed('pins'); } }, 'reset') : null),
      h('td', {}, probs[role] ? h('span.hint.err', {}, probs[role]) : h('span.hint', {}, ROLE_HELP[role])));
  });

  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Board'),
        field('Microcontroller board', select(Object.values(app.catalog.boards).map(x => [x.id, x.name]), app.boardId, id => app.setBoard(id)), 'Changing the board resets the pin map to that board\'s defaults.'),
        h('dl.kv', {}, h('dt', {}, 'CircuitPython id'), h('dd', {}, b.circuitpython.board_id), h('dt', {}, 'Flash'), h('dd', {}, `${b.flash.method} · ${b.flash.chip} @ ${b.flash.offset}`), h('dt', {}, 'USB drive'), h('dd', {}, b.has_usb_drive ? 'yes (CIRCUITPY)' : 'none — files go through the REPL'), h('dt', {}, 'Battery'), h('dd', {}, b.battery?.divider_note || '—'))),
      h('div.card', {}, h('h3', {}, 'Bootloader'), h('p', {}, b.flash.bootloader_instructions), h('p.hint', {}, 'Only needed to flash CircuitPython itself (Deploy → Flash CircuitPython). Holding B also stops the fox from transmitting while it charges: nothing runs in bootloader mode.'))),
    h('div.card', {}, h('h3', {}, 'Pin map', app.report.some(r => r.key.startsWith('pins.')) ? badge('check', 'err') : badge('ok', 'ok')),
      h('p.hint', {}, 'Written into fox.json in full. The firmware resolves each name with ', h('code', {}, 'getattr(board, name)'), ' at boot; an invalid required pin makes the fox boot silent rather than key unknown pins.'),
      h('div.grid-wrap', {}, h('table.grid', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Role'), h('th', {}, 'Pin'), h('th', {}, 'Default'), h('th', {}, ''))), h('tbody', {}, rows)))));
}
