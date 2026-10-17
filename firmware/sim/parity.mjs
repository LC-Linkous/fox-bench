// SPDX-License-Identifier: GPL-2.0-only
// sim/parity.mjs -- same corpus through js/audio; compare with parity.py output.
//   node firmware/sim/parity.mjs > js.json && python3 firmware/sim/parity.py > py.json && node firmware/sim/parity.mjs --compare py.json js.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const morse = await import(join(here, '../../js/audio/morse.js'));
const melody = await import(join(here, '../../js/audio/melody.js'));
const sstv = await import(join(here, '../../js/audio/sstv.js'));
const sched = await import(join(here, '../../js/audio/schedule.js'));
const r6 = x => Math.round(x * 1e6) / 1e6;
if (process.argv[2] === '--compare') {
  const a = JSON.parse(readFileSync(process.argv[3])), b = JSON.parse(readFileSync(process.argv[4]));
  let bad = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if (x !== y) { bad++; console.log('MISMATCH', k, (x || '').slice(0, 80), '|', (y || '').slice(0, 80)); }
  }
  console.log(bad ? `${bad} mismatches` : `parity ok: ${Object.keys(a).length} streams identical`);
  process.exit(bad ? 1 : 0);
}
const corpus = JSON.parse(readFileSync(join(here, 'parity_corpus.json')));
const out = {};
for (const c of corpus.morse) out[`morse:${c.text}:${c.wpm ?? 12}`] = morse.events(c.text, { wpm: c.wpm ?? 12, toneHz: c.tone_hz ?? 800, ditMs: c.dit_ms ?? null }).map(([h, ms]) => [r6(h), r6(ms)]);
for (const s of corpus.songs) out[`song:${s.name}`] = melody.events(s, s.articulation ?? 0.875).map(([h, ms]) => [r6(h), r6(ms)]);
out['sstv:test_card'] = sstv.events(sstv.testCard()).map(([h, ms]) => [r6(h), r6(ms)]);
for (const seed of corpus.seeds) { let st = seed; const seq = []; for (let i = 0; i < 50; i++) { let v; [v, st] = sched.randInt(st, 0, 1000000); seq.push(v); } out[`lcg:${seed}`] = seq; }
process.stdout.write(JSON.stringify(out, Object.keys(out).sort()));
