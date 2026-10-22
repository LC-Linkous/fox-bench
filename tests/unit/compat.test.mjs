// compat.test.mjs — the fox's foxlib-c version against the page (js/model/compat.js).
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmpVersion, foxlibcCompat, FOXLIBC_SINCE } from '../../js/model/compat.js';

const cfg = (telemetry = []) => ({ id: { telemetry } });

test('version comparison', () => {
  assert.ok(cmpVersion('0.1.5', '0.1.6') < 0); assert.ok(cmpVersion('0.1.10', '0.1.9') > 0); assert.equal(cmpVersion('c-0.1.5', '0.1.5'), 0); assert.ok(cmpVersion('1.0', '0.9.9') > 0);
});

test('a fox older than the site gets a warning, not a block', () => {
  const iss = foxlibcCompat(cfg(), { foxVersion: 'c-0.1.4', hostedVersion: '0.1.6' });
  assert.deepEqual(iss.map(i => i.level), ['warn']); assert.match(iss[0].msg, /runs foxlib-c 0.1.4; this site builds 0.1.6/);
});

test('a feature the fox predates is blocking and says which firmware it needs', () => {
  const iss = foxlibcCompat(cfg(['chg']), { foxVersion: 'c-0.1.2', hostedVersion: '0.1.6' });
  assert.equal(iss[0].level, 'err'); assert.equal(iss[0].key, 'id.telemetry'); assert.match(iss[0].msg, /needs firmware 0.1.3\+; this fox runs 0.1.2/);
  assert.deepEqual(foxlibcCompat(cfg(['chg']), { foxVersion: 'c-0.1.3', hostedVersion: '0.1.3' }), []);
});

test('unknown fox version (older firmware without board.json), the demo and the host sim compare to nothing', () => {
  assert.deepEqual(foxlibcCompat(cfg(['chg']), { foxVersion: '', hostedVersion: '0.1.6' }), []);
  assert.deepEqual(foxlibcCompat(cfg(['chg']), { foxVersion: 'c-demo', hostedVersion: '0.1.6' }), []);
  assert.deepEqual(foxlibcCompat(cfg(), { foxVersion: 'c-host', hostedVersion: '0.1.6' }), []);
});

test('a fox newer than the page is an info', () => {
  const iss = foxlibcCompat(cfg(), { foxVersion: 'c-0.2.0', hostedVersion: '0.1.6' });
  assert.deepEqual(iss.map(i => i.level), ['info']);
});

test('every since entry is a parseable version not newer than the repo', async () => {
  const fs = await import('node:fs');
  const hosted = fs.readFileSync(new URL('../../firmware/foxlib-c/VERSION', import.meta.url), 'utf8').trim();
  for (const f of FOXLIBC_SINCE) { assert.match(f.since, /^\d+\.\d+\.\d+$/); assert.ok(cmpVersion(f.since, hosted) <= 0, `${f.key} since ${f.since} > ${hosted}`); }
});
