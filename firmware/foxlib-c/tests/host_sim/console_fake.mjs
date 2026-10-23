// console_fake.mjs — the page's FakeConsoleLink answering the console corpus, for console_test.py to compare with console.c.
// SPDX-License-Identifier: GPL-3.0-or-later
//   node host_sim/console_fake.mjs <corpus.json>    → JSON [{cmd, out}] like build/console_sim prints
import { readFileSync } from 'node:fs';
import { FakeConsoleLink } from '../../../../js/device/console-device.js';
const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dec = new TextDecoder(), sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [];
for (const c of corpus.cases.filter(c => !c.then)) {   // sequences are firmware-only
  // a fresh fake per command, as console_test.py runs one console_sim per command: a bench action's late `ok`
  // (real time in the fake) must not land in the next command's output
  const link = new FakeConsoleLink({ callsign: corpus.drive.callsign, latency: 1 }); let out = '';
  link.onData = b => { out += dec.decode(b); }; link.onDrop = () => {};
  await link.open(); await sleep(20); out = '';
  await link.write(c.cmd + '\r\n');
  await sleep(Math.min(c.advance_ms || 100, 150));   // the late `ok` of a bench action is c_only
  await link.close();
  res.push({ cmd: c.cmd, out });
}
console.log(JSON.stringify(res));
