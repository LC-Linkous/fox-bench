// console-device.test.mjs — the foxlib-c console protocol (line commands, ok/err replies that
// arrive when the action has finished, fox log interleaved) over a fake console link.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleDevice, FakeConsoleLink, demoConsole } from '../../js/device/console-device.js';
import { parseBanner } from '../../js/device/device.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('banner arrives unsolicited and parses; every line is logged as fox output', async () => {
  const link = new FakeConsoleLink({ callsign: 'KY4ZR FOX DE KY4ZR' });
  const d = new ConsoleDevice(link); const logs = []; d.onLog = (t, c) => logs.push([c, t]);
  await d.listen(); await link.open(); await sleep(30);
  const banner = logs.map(([, t]) => parseBanner(t)).find(Boolean);
  assert.ok(banner, 'a FOX banner line was logged');
  assert.equal(banner.board, 'picofox-foxlibc'); assert.equal(banner.foxlib, 'c-0.1.0'); assert.equal(banner.id, 'set'); assert.equal(banner.template, 'morse-songs/0.1.0');
});

test('command waits for ok, collects the lines before it; err rejects through bench()', async () => {
  const link = new FakeConsoleLink({ latency: 2 }); const d = new ConsoleDevice(link); d.onLog = () => {};
  await link.open(); await sleep(10);
  const r = await d.command('batt');
  assert.equal(r.ok, true); assert.match(r.lines.join(' '), /charging=no/);
  assert.match(await d.bench('batt'), /charger idle/);
  link.charging = true; assert.equal(await d.bench('batt'), 'charging');
  await assert.rejects(d.bench('key', { seconds: 99 }), /0 < s <= 60/);
  await assert.rejects(d.command('nonsense').then(r => { if (!r.ok) throw new Error(r.error); }), /unknown command/);
  assert.deepEqual(link.sent.slice(0, 2), ['batt', 'batt']);
});

test('key: the reply comes when the action ends (ok after the keyed time), and the status text is returned', async () => {
  const link = new FakeConsoleLink({ latency: 2 }); const d = new ConsoleDevice(link); const logs = []; d.onLog = (t, c) => logs.push([c, t]);
  await link.open(); await sleep(10);
  const t0 = Date.now();
  assert.equal(await d.bench('key', { seconds: 0.2 }), 'ok');
  assert.ok(Date.now() - t0 >= 180, 'waited for the keyed time');
  assert.ok(logs.some(([c, t]) => c === 'reply' && /keyed 0\.2 s/.test(t)), 'the immediate acknowledgement was logged');
  const st = await d.bench('status');
  assert.match(st, /revision=3/); assert.match(st, /i2c_write_us=\d+/);
});

test('commands are serialised: a second command waits for the first reply', async () => {
  const link = new FakeConsoleLink({ latency: 2 }); const d = new ConsoleDevice(link); d.onLog = () => {};
  await link.open(); await sleep(10);
  const a = d.bench('tone', { hz: 800, seconds: 0.15 }), b = d.bench('batt');
  const order = [];
  await Promise.all([a.then(() => order.push('tone')), b.then(() => order.push('batt'))]);
  assert.deepEqual(order, ['tone', 'batt']);
  assert.deepEqual(link.sent, ['tone 800 0.15', 'batt']);
});

test('a command with no reply times out with a readable error', async () => {
  const link = new FakeConsoleLink({ latency: 2 }); link._cmd = () => {};   // a dead firmware
  const d = new ConsoleDevice(link); d.onLog = () => {};
  await assert.rejects(d.command('status', { timeout: 50 }), /no reply to "status"/);
});

test('bootsel: sends the command, the port drops afterwards', async () => {
  const link = new FakeConsoleLink({ latency: 2 }); const d = new ConsoleDevice(link); d.onLog = () => {};
  let dropped = false; link.onDrop = () => { dropped = true; };
  await link.open(); await sleep(10);
  assert.equal(await d.bootsel(), true); assert.equal(link.bootsel, true);
  await sleep(80); assert.equal(dropped, true);
});

test('demoConsole follows the working config (template, callsign) and logs like a device', async () => {
  const { device, link } = demoConsole({ id: 'picofox-foxlibc' }, { template: 'popcorn', id: { callmessage: 'W1ABC FOX' } });
  const logs = []; device.onLog = (t, c) => logs.push([c, t]);
  await link.open(); await sleep(20);
  const b = logs.map(([, t]) => parseBanner(t)).find(Boolean);
  assert.equal(b.template, 'popcorn/0.1.0'); assert.equal(b.id, 'set');
  assert.equal(device.kind, 'demo');
  await device.close();
});

test('drawer send(): one write, after the fox has been quiet, and no second tx log line (the drawer logs it)', async () => {
  const link = new FakeConsoleLink({ latency: 5 }); const d = new ConsoleDevice(link); const logs = []; d.onLog = (t, cls) => logs.push([cls, t]);
  await link.open(); await sleep(50);
  link._emit('cycle 1 @ 146.5650 MHz\r\n');   // the fox is printing: the drawer must wait for ≥150 ms of silence
  const t0 = Date.now(); await d.send('status');
  assert.ok(Date.now() - t0 >= 120, `waited for quiet (${Date.now() - t0} ms)`);
  assert.deepEqual(link.sent.filter(l => l === 'status'), ['status'], 'written exactly once');
  assert.equal(logs.filter(([cls]) => cls === 'tx').length, 0, 'send() does not log a tx line itself');
});
