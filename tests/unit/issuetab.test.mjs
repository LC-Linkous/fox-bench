// A check's message offers the way to where it is settled.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabForKey, issueAction, TAB_NAMES } from '../../js/model/issuetab.js';
import { validate, checks } from '../../js/model/netschema.js';
import { readFileSync } from 'node:fs';

test('the tab a key is edited on: a network fox keeps its contest features on Payload', () => {
  assert.equal(tabForKey('net.mac', true), 'radio');
  assert.equal(tabForKey('checkpoint.portal.enabled', true), 'payload');
  assert.equal(tabForKey('stealth.start.at', true), 'payload');
  assert.equal(tabForKey('sense.crowd.max', true), 'payload');
  assert.equal(tabForKey('schedule.wake_s', true), 'schedule');
  assert.equal(tabForKey('id.callmessage', true), 'id');
  assert.equal(tabForKey('fleet.points_to', true), 'deploy');
  assert.equal(tabForKey('plan.frequencies_mhz', false), 'plan');
  assert.equal(tabForKey('limits.watchdog_s', false), 'behavior');
  assert.equal(tabForKey('pins.ptt', false), 'radio');
  assert.equal(tabForKey('payload.kind', false), 'payload');
  for (const t of new Set(['net.x', 'checkpoint.x', 'id.x', 'schedule.x', 'fleet.x', 'plan.x', 'limits.x'].flatMap(k => [tabForKey(k, true), tabForKey(k, false)]))) assert.ok(TAB_NAMES[t], t);
});

test('an issue offers a fix, or a tab, and never a link to where the reader already is', () => {
  assert.deepEqual(issueAction({ key: 'checkpoint.stop_at', fix: 'clock' }, true, 'payload'), { fix: 'clock' });
  assert.deepEqual(issueAction({ key: 'checkpoint.portal.enabled', tab: 'board' }, true, 'payload'), { tab: 'board' });
  assert.deepEqual(issueAction({ key: 'net.mac' }, true, 'radio'), {});
  assert.deepEqual(issueAction({ key: 'net.mac' }, true, 'deploy'), { tab: 'radio' });
});

test('the checks that send the reader elsewhere say where: the clock ones carry the fix, the template one the Board tab', () => {
  const D = JSON.parse(readFileSync(new URL('../../firmware/templates/checkpoint/defaults/esp32c3.json', import.meta.url)));
  const C3 = { id: 'esp32c3', radios: ['wifi', 'ble'] };
  const v = validate({ checkpoint: { stop_at: '2027-04-01T12:00:00' } }, D, C3);
  const stop = checks(v.cfg, C3, { clockSet: false }).find(i => i.key === 'checkpoint.stop_at');
  assert.equal(stop?.fix, 'clock');
  assert.ok(!checks(v.cfg, C3, { clockSet: true }).some(i => i.key === 'checkpoint.stop_at'));
});
