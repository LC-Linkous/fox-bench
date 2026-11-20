// behavior.js — Behavior tab: the firmware template (what the fox does), from the set this board can run.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge, field, select, check } from './dom.js';

let app, root;
/** What a hunter (or a tester) needs to see this fox at all; the first thing to know on a first session. */
function seenWith(kind) {
  return kind === 'wifi-ap' ? 'any phone or laptop: the network name in its Wi-Fi list, on and off with the duty cycle; a Wi-Fi analyser app shows the BSSID'
    : kind === 'wifi-probe' ? 'a sniffer only (tools/sniffer/code.py on a second board, or Wireshark in monitor mode): the fox asks for a network and answers to nobody, so it is in no Wi-Fi list and has no BLE side'
    : kind === 'ble' ? 'a BLE scanner app (nRF Connect, LightBlue): the name and the beacon frames. A phone\'s Bluetooth settings never list a beacon, and iOS hides iBeacon frames from apps'
    : '—';
}

export function init(a, el) { app = a; root = el; app.listeners.add(render); render(); }

function render() {
  const t = app.template;
  if (app.family === 'drive') {
  const tmplCard = h('div.card', {},
    h('h3', {}, 'Template'),
    field('Template', select(app.templatesFor('drive').map(x => [x.id, `${x.name}${x.status === 'experimental' ? ' (experimental)' : ''}`]), app.templateId, id => app.setTemplate(id)), t.description),
    h('dl.kv', {}, h('dt', {}, 'Status'), h('dd', {}, badge(t.status, t.status === 'stable' ? 'ok' : 'warn')), h('dt', {}, 'Tested on'), h('dd', {}, t.boards_tested.join(', ') || 'nothing yet'), h('dt', {}, 'Firmware'), h('dd', {}, 'the vendor\'s (unchanged)')));
    root.replaceChildren(tmplCard, h('div.card', {}, h('h3', {}, 'One behaviour'), h('p.hint', {}, 'The vendor firmware does one thing: play its audio file, send the ID, optionally pause. Everything that can be set about it is on the next tabs.')));
    return;
  }
  const tmplCard = h('div.card', {},
    h('h3', {}, 'Firmware template'),
    field('Template', select(app.templatesFor(app.family).map(x => [x.id, `${x.name}${x.status === 'experimental' ? ' (experimental)' : ''}`]), app.templateId, id => app.setTemplate(id)),
      (t.description || `Reads: ${t.sections.join(', ')}`) + (app.templatesFor(app.family).length < Object.keys(app.catalog.templates).length ? ` (templates for the ${app.board.name}; other boards have others)` : '')),
    h('dl.kv', {},
      h('dt', {}, 'Version'), h('dd', {}, `${t.version} · needs foxlib ${t.foxlib}`),
      ...(t.needs?.length ? [h('dt', {}, 'Needs'), h('dd', {}, h('ul.needs', { style: 'margin:0;padding-left:1.2em' }, t.needs.map(n => h('li', {}, n))))] : []),
      h('dt', {}, 'Status'), h('dd', {}, badge(t.status, t.status === 'stable' ? 'ok' : 'warn')),
      h('dt', {}, 'Tested on'), h('dd', {}, t.boards_tested.join(', ') || 'nothing yet'),
      h('dt', {}, 'Payload files'), h('dd', {}, t.payloads.map(p => p.file).join(', ') || 'none'),
      h('dt', {}, 'Bench'), h('dd', {}, t.capabilities.join(', ')),
      ...(app.isNet ? [h('dt', {}, 'Seen with'), h('dd', {}, seenWith(app.cfg.net?.kind))] : [])),
    t.status === 'experimental' ? h('p.hint.warn', {}, 'Experimental: any payload × schedule × plan. Combinations outside the six discrete templates have not been run on hardware yet.') : null);

  const others = app.templatesFor(app.family).filter(x => x.id !== t.id);
  const lim = app.cfg.limits;
  const recoveryCard = app.isNet || !lim ? null : h('div.card', {}, h('h3', {}, 'Recovery'),
    check('enable automatic recovery attempts', lim.recover !== false, v => { lim.recover = v; app.changed('limits'); },
      'foxlib 1.6: a brownout or a hung board resets itself back into a normal boot (safemode.py), and a cycle that fails is logged and skipped'),
    h('p.hint', {}, lim.recover !== false
      ? `On: the board resets out of safe mode after a brownout or a hard fault (with a 5 s pause for the supply; up to 50 times in a row), the watchdog${lim.watchdog_s ? ` (${lim.watchdog_s} s, set on Deploy)` : ' is off on Deploy, so a hang still stands'} resets a hung interpreter, and an error inside a cycle releases PTT and moves on. The boot log counts any resets since the last completed cycle.`
      : 'Off: the pre-1.6 behaviour, for finding out what a fox dies of. A brownout leaves the board in safe mode (dark, silent) until it is power-cycled; the watchdog is not armed; the first error inside a cycle stops the fox with a traceback on the console. The module is still re-tuned before every transmission either way.'));
  root.replaceChildren(...[tmplCard, recoveryCard].filter(Boolean),
    h('div.card', {}, h('h3', {}, 'What a template is'),
      h('p.hint', {}, 'A template is the behaviour: a short ', h('code', {}, 'code.py'), ' runner over the shared ', h('code', {}, 'foxlib'), '. It decides which payload kinds and schedules the next tabs offer; the frequency plan, callsign and radio settings apply to all of them. Switching keeps the sections the new template still reads.'),
      others.length ? h('p.hint', {}, 'Also available for this board: ', others.map(x => x.name).join(' · '), '.') : null));
}
