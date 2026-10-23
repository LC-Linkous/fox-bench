// repl-link.test.mjs — the raw-REPL protocol against the fake board.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplLink, stripAnsi } from '../../js/device/repl-link.js';
import { FakeBoard } from './fake-board.mjs';

const FAST = { ctrlC: 120, enter: 80, exitRaw: 80, retryGap: 20 };   // the retry tests run in milliseconds, not seconds
const mk = async (opts, timeouts = FAST) => { const b = new FakeBoard(opts); const r = new ReplLink(b, () => {}, { timeouts }); await b.open(); return { b, r }; };

test('stripAnsi removes CircuitPython\'s clear-line and title-bar sequences and CRs', () => {
  assert.equal(stripAnsi('\x1b[2K\x1b[0G>>> '), '>>> ');
  assert.equal(stripAnsi('\x1b]0;\u{1F40D}Wi-Fi: off | Done | 10.0.0\x1b\\code.py output:\r\n'), 'code.py output:\n');
  assert.equal(stripAnsi('\x1b]0;title\x07FOX template=x'), 'FOX template=x');
  assert.equal(stripAnsi('plain'), 'plain');
});

test('interrupt from the friendly prompt', async () => {
  const { b, r } = await mk();
  await r.interrupt();
  assert.equal(b.state, 'friendly');
  assert.equal(b.tx[0], '\r\x03\x03');
});

test('interrupt a running, chatty fox with ANSI prompts', async () => {
  const { b, r } = await mk({ running: true, noise: true, noiseMs: 5, ansi: true, chunk: 7, latency: 2 });
  await r.interrupt();
  assert.equal(b.state, 'friendly');
  assert.equal(r.inRaw, false);
  await b.close();
});

test('interrupt retries when the first Ctrl-C is swallowed', async () => {
  const { b, r } = await mk({ running: true, ctrlCIgnores: 2 });
  await r.interrupt();
  assert.equal(b.state, 'friendly');
  assert.ok(b.tx.filter(s => s.includes('\x03')).length >= 2, 'sent Ctrl-C more than once');
});

test('interrupt from raw mode (page reloaded mid-session) gets back to friendly', async () => {
  const { b, r } = await mk();
  b.state = 'raw';
  await r.interrupt();
  assert.equal(b.state, 'friendly');
});

test('interrupt after our own exec sends Ctrl-B first and takes milliseconds, not the 4.5 s Ctrl-C dance', async () => {
  const { b, r } = await mk(undefined, {});   // production timeouts: the point is that none of them is waited out
  await r.enterRaw(); await r.exec('print(1)');
  b.tx.length = 0;
  const t0 = Date.now(); await r.interrupt();
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
  assert.equal(b.tx[0], '\r\x02', 'first thing sent is Ctrl-B');
  assert.equal(b.state, 'friendly');
});

test('exec returns stdout, raises on stderr, soft mode returns both', async () => {
  const { r } = await mk({ handler: code => code.includes('boom') ? { err: 'Traceback\r\nValueError: boom\r\n' } : { out: 'hi\n' } });
  assert.equal((await r.exec('print(1)')).out, 'hi\r\n');
  await assert.rejects(r.exec('boom'), /ValueError: boom/);
  const soft = await r.exec('boom', { soft: true });
  assert.match(soft.err, /ValueError/);
});

test('exec survives a missing final prompt and keeps working', async () => {
  const { r } = await mk({ dropPrompt: true });
  assert.equal((await r.exec('print(1)')).out, 'printed\r\n');
  assert.equal((await r.exec('print(2)')).out, 'printed\r\n');
});

test('exec with chunked, delayed, ANSI-decorated delivery and a long result', async () => {
  const big = 'x'.repeat(5000) + '\n';
  const { r } = await mk({ ansi: true, chunk: 13, latency: 1, handler: () => ({ out: big }) });
  const { out } = await r.exec('print("x"*5000)');
  assert.equal(out.replace(/\r/g, ''), big);
});

test('exec chunks long code so the C3 input buffer is never overrun', async () => {
  const { b, r } = await mk();
  const code = 'print(' + JSON.stringify('y'.repeat(1000)) + ')';
  await r.exec(code);
  const sent = b.tx.filter(s => !/^[\r\x01\x02\x03\x04]*$/.test(s));
  assert.ok(sent.every(s => s.length <= 128), 'every code chunk ≤ 128 bytes');
  assert.equal(b.execs[0], code);
});

test('rebootAndCapture returns the boot log up to the FOX banner, ANSI stripped', async () => {
  const { b, r } = await mk({ ansi: true, bootLog: ['foxlib 1.0.0', 'FOX template=morse-songs/1.0.0 foxlib=1.0.0 board=seeed_xiao_esp32c3 uid=85c818eae840 cfg=ok radio=ok id=set freq=146.565', 'tx 146.565 song=1'] });
  await r.exec('print(1)');                       // we are in raw mode; reboot must leave it first
  const text = await r.rebootAndCapture({ timeout: 3000 });
  assert.equal(b.reboots, 1);
  assert.match(text, /^soft reboot/m);
  assert.match(text, /^FOX template=morse-songs/m);
  assert.doesNotMatch(text, /\x1b/);
  assert.equal(r.inRaw, false);
});

test('rebootAndCapture gives up on a traceback that ends the program', async () => {
  const { r } = await mk({ bootLog: ['Traceback (most recent call last):', '  File "code.py", line 3', 'ImportError: no module named foxlib', '', 'Code done running.', 'Press any key to enter the REPL. Use CTRL-D to reload.'] });
  const t0 = Date.now();
  const text = await r.rebootAndCapture({ timeout: 10000 });
  assert.ok(Date.now() - t0 < 3000, 'did not wait for the full timeout');
  assert.match(text, /ImportError/);
});

test('unsolicited output reaches onUnsolicited stripped; bare prompts are suppressed', async () => {
  const { b, r } = await mk({ ansi: true });
  const got = [];
  r.onUnsolicited = t => got.push(t);
  await b._emit('\x1b[2K\x1b[0G>>> ');
  await b._emit('tx 146.565 song=2\r\n');
  await new Promise(res => setTimeout(res, 10));
  assert.deepEqual(got, ['tx 146.565 song=2\n']);
});
