// about.js — About tab: what fox-bench does, what it supports, what is next.
// Mostly generated from the catalog so it stays true as descriptors are added.
// SPDX-License-Identifier: GPL-2.0-only
import { h, badge } from './dom.js';

let app, root;
export function init(a, el) { app = a; root = el; app.listeners.add(src => { if (src === 'boot' || src === 'theme') render(); }); render(); }

const li = (...c) => h('li', {}, ...c);

function render() {
  const cat = app.catalog;
  const templates = Object.values(cat.templates);
  root.replaceChildren(
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'What it is'),
        h('p', {}, 'A workbench for small amateur-radio fox transmitters: a CircuitPython board driving a NiceRF SA8x8 module. You configure a fox in the form, the page writes the firmware and a ', h('code', {}, 'fox.json'), ' to the board over USB, reboots it, and reads back a one-line banner that says whether it came up. Nothing to install; Chrome or Edge for the USB link.'),
        h('p', {}, 'Before anything goes on the air you can hear the Morse ID and song, see the SSTV picture a hunter would decode, watch a QRSS trace, and look at a seeded schedule drawn out across the day. The firmware plays the same event stream the page previews, byte for byte.'),
        h('p', {}, 'For a batch of foxes there are named profiles and a fleet log keyed on each chip\'s unique ID.')),
      h('div.card', {}, h('h3', {}, 'The flow'),
        h('ol.steps', {},
          li(h('b', {}, 'Board'), ': pick which fox is on the bench, flash CircuitPython onto a bare ESP32 if needed, and connect (REPL for the foxlib family, the USB drive for the PicoFox). ', h('b', {}, 'Behavior'), ' picks the firmware template that board can run.'),
          li(h('b', {}, 'Board'), ', ', h('b', {}, 'Radio & pins'), ', ', h('b', {}, 'Behavior'), ', ', h('b', {}, 'Frequency plan'), ', ', h('b', {}, 'Callsign & ID'), ', ', h('b', {}, 'Payload'), ', ', h('b', {}, 'Schedule'), ' — together these are the whole fox.json. Every field is validated here and again by the firmware at boot; a bad field falls back to a known-good default and is named in the banner.'),
          li(h('b', {}, 'Deploy'), ' shows what will change, asks you to confirm a load is on the RF connector, writes the files, reboots, and shows the verdict.'),
          li(h('b', {}, 'Bench'), ' keys the transmitter for a few seconds, reads RSSI and battery voltage, and logs every action with a timestamp.'),
          li(h('b', {}, 'Profiles & fleet'), ' saves configurations by name and keeps the log of every board.')))),
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Firmware templates ', badge(`${templates.length}`)),
        h('p.hint', {}, 'Each is a few lines of behaviour on a shared library (foxlib). Payload, schedule and frequency plan are independent axes; the composite template reads all three.'),
        h('table.grid', {}, h('tbody', {}, templates.map(t => h('tr', {}, h('td', {}, t.name, ' ', badge(t.status, t.status === 'stable' ? 'ok' : 'warn')), h('td.mono', { style: 'font-size:.8rem;color:var(--ink-3)' }, t.sections.filter(s => s.startsWith('payload') || s.startsWith('schedule')).map(s => s.split('.')[1]).join(' · '))))))),
      h('div.card', {}, h('h3', {}, 'Supported hardware'),
        h('dl.kv', {},
          h('dt', {}, 'Boards'), h('dd', {}, Object.values(cat.boards).map(b => b.name).join(', ')),
          h('dt', {}, 'Radio modules'), h('dd', {}, Object.values(cat.modules).map(m => m.name.replace('NiceRF ', '')).join(', ')),
          h('dt', {}, 'Transport'), h('dd', {}, 'Web Serial → CircuitPython raw REPL (boards without a USB drive)'),
          h('dt', {}, 'foxlib'), h('dd', {}, cat.foxlibVersion)),
        h('p.hint', {}, 'Boards, modules, band plans, templates and song libraries are JSON descriptors in the repo; adding one is adding a file. Radio drivers are selected by control protocol, so any module speaking the NiceRF AT dialect works with the ', h('code', {}, 'dmo'), ' driver.'),
        h('p.hint', {}, 'Tested: every template passes the simulator (mocked hardware, virtual clock) and has run on a XIAO ESP32-C3 + SA868 on 2 m and 70 cm.'),
        h('p.hint', {}, h('b', {}, 'Three device families.'), ' The ', h('b', {}, 'foxlib'), ' family is a CircuitPython board with our firmware, deployed and bench-tested over the REPL. The ', h('b', {}, 'drive'), ' family keeps the vendor\'s firmware and is configured by files on its USB drive: for the AI6YM PicoFox the page writes settings.txt, renders audio.wav from the payload and its own Morse-ID audio, and sets the marker the firmware checks (the vendor firmware, CC BY-NC-SA 4.0, is not included here; ', h('code', {}, 'docs/picofox-notes.md'), '). The ', h('b', {}, 'foxlib-c'), ' family is fox-bench\'s own firmware in C for boards that cannot run CircuitPython — on the PicoFox it brings fox.json, the same templates, FM at 8 kHz with pre-emphasis, and bench commands on the serial console; flashed as a UF2 from the Board tab, the vendor firmware restorable the same way (', h('code', {}, 'firmware/foxlib-c/'), ', GPL-3.0-or-later, written from the published schematic: ', h('code', {}, 'docs/picofox-hardware.md'), ').'))),
    h('div.cols', {},
      h('div.card', {}, h('h3', {}, 'Honest limits'),
        h('ul', { style: 'margin:0;padding-left:1.2em' },
          li('Firefox and Safari can run the demo but cannot open serial ports.'),
          li('Flashing CircuitPython is a separate component (', h('code', {}, 'flasher/'), ', Apache-2.0) built on Espressif\'s esptool-js, which it bundles. From a terminal, ', h('code', {}, 'tools/batch_flash.py'), ' does the same job.'),
          li('The frequency check is module range ∩ a coarse band table. Your licence privileges and local band plan are yours to confirm.'),
          li('A fox whose callsign is unset stays silent by design; the page will not deploy one.'))),
      h('div.card', {}, h('h3', {}, 'Next'),
        h('ul', { style: 'margin:0;padding-left:1.2em' },
          li('foxlib-c: the attenuator and amplifier-enable verified on a board, then a battery-charge indication in the ID; more boards of the drive and foxlib-c families.'),
          li('Boards that mount a CIRCUITPY drive (ESP32-S3, SAMD) via the File System Access API.'),
          li('Wi-Fi beacon payload on ESP32 (2.4 GHz, no radio module).'),
          li('A testing procedure for the bench, independent of this page.')))),
    h('p.hint', {}, 'fox-bench ', h('span.mono', {}, 'v' + app.version), ' · page GPL-2.0, firmware GPL-3.0-or-later · ', h('a', { href: 'DESIGN.md' }, 'design'), ' · ', h('a', { href: 'CONFIG.md' }, 'fox.json contract'), ' · ', h('a', { href: 'PROTOCOL.md' }, 'REPL protocol'), ' · ', h('a', { href: 'https://github.com/LC-Linkous/fox-bench' }, 'source'), ' · ', h('a', { href: 'https://lc-linkous.github.io/tools' }, 'other tools')));
}
