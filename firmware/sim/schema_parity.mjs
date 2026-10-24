// SPDX-License-Identifier: GPL-2.0-only
// sim/schema_parity.mjs -- the schema corpus through js/model/schema.js (the page's fox.json validator);
// --compare a.json b.json reports differences in status or effective config per case.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..');
const { mergeAndValidate } = await import(join(root, 'js/model/schema.js'));
const net = await import(join(root, 'js/model/netschema.js'));
const isNet = t => JSON.parse(readFileSync(join(root, 'firmware/templates', t, 'template.json'))).contract === 'net';

const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
if (process.argv[2] === '--compare') {
  const a = JSON.parse(readFileSync(process.argv[3])), b = JSON.parse(readFileSync(process.argv[4]));
  let bad = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[k] || !b[k]) { bad++; console.log('MISSING', k); continue; }
    if (a[k].status !== b[k].status) { bad++; console.log(`STATUS   ${k}\n   py ${a[k].status}\n   js ${b[k].status}`); }
    const ca = a[k].cfg, cb = b[k].cfg;
    for (const sec of new Set([...Object.keys(ca || {}), ...Object.keys(cb || {})])) {
      if (canon(ca?.[sec]) !== canon(cb?.[sec])) { bad++; console.log(`CFG      ${k} .${sec}\n   py ${canon(ca?.[sec])?.slice(0, 160)}\n   js ${canon(cb?.[sec])?.slice(0, 160)}`); }
    }
  }
  console.log(bad ? `${bad} schema mismatches` : `schema parity ok: ${Object.keys(a).length} cases identical`);
  process.exit(bad ? 1 : 0);
}
const corpus = JSON.parse(readFileSync(join(here, 'schema_corpus.json')));
const out = {};
for (const c of corpus.cases) {
  const defaults = JSON.parse(readFileSync(join(root, 'firmware/templates', c.template, 'defaults', c.board + '.json')));
  const target = JSON.parse(readFileSync(join(root, 'boards', c.board + '.json')));
  const hw = target.hardware ? JSON.parse(readFileSync(join(root, 'hardware', target.hardware + '.json'))) : {};
  const board = { ...hw, ...target };   // a target merged with its hardware, as the page's loader does
  const r = isNet(c.template) ? net.validate(c.user, defaults, board) : mergeAndValidate(c.user, defaults, board);
  out[c.name] = { status: r.status, cfg: r.cfg };
}
process.stdout.write(canon(out));
