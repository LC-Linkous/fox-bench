// repl-device.test.mjs — files, identity, bench and the operation queue over the fake board.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplDevice } from '../../js/device/repl-device.js';
import { parseBanner } from '../../js/device/device.js';
import { FakeBoard, parseBytesLiteral } from './fake-board.mjs';

const FOXLIB = { 'foxlib/__init__.py': 'class Fox: pass\n', 'foxlib/VERSION': '1.0.0\n', 'foxlib/radio.py': '# radio\n' };
const mk = async opts => { const b = new FakeBoard(opts); const d = new ReplDevice(b); d.onLog = () => {}; await b.open(); return { b, d }; };
const enc = new TextEncoder();

test('parseBytesLiteral round-trips the encoder repl-device uses', async () => {
  const { b, d } = await mk();
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  await d.writeBytes('bin', all);
  assert.deepEqual(Array.from(b.fs.get('bin')), Array.from(all));
  assert.deepEqual(Array.from(parseBytesLiteral("b'a\\'b\\\\c\\x00\\xff'")), [97, 39, 98, 92, 99, 0, 255]);
});

test('connect to a running fox: interrupt, identity, foxlib version, file list', async () => {
  const { b, d } = await mk({ running: true, noise: true, noiseMs: 5, ansi: true, chunk: 9, files: { ...FOXLIB, 'code.py': 'x', 'fox.json': '{}' } });
  const info = await d.connect();
  assert.equal(info.boardId, 'seeed_xiao_esp32c3');
  assert.equal(info.uid, '85c818eae840');
  assert.equal(info.foxlibVersion, '1.0.0');
  assert.equal(info.cpVersion, '10.0.0');
  assert.deepEqual(Object.keys(info.files).sort(), ['code.py', 'fox.json', 'foxlib']);
  assert.equal(info.files.foxlib.dir, true);
  assert.equal(b.tx[0], '\r\x03\x03', 'first bytes on the wire stop the fox');
  await b.close();
});

test('connect on a board with no foxlib reports an empty version', async () => {
  const { d } = await mk({ files: { 'code.py': 'print(1)' } });
  const info = await d.connect();
  assert.equal(info.foxlibVersion, '');
});

test('writeBytes: large binary file is chunked, verified by size and CRC, and lands intact', async () => {
  const { b, d } = await mk();
  const data = new Uint8Array(3000); for (let i = 0; i < data.length; i++) data[i] = (i * 7919) & 0xff;
  const logs = []; d.onLog = (t, c) => logs.push([t, c]);
  await d.writeBytes('foxlib/tones.py', data);
  assert.deepEqual(Array.from(b.fs.get('foxlib/tones.py')), Array.from(data));
  assert.ok(b.execs.filter(c => c.startsWith('f.write(')).length >= 7, 'written in several pieces');
  assert.ok(b.execs.some(c => c.includes('binascii.crc32')), 'CRC verified on the board');
  assert.ok(logs.some(([t, c]) => c === 'ok' && /crc [0-9a-f]+/.test(t)), 'log line carries the CRC');
});

test('writeBytes: a corrupted write is detected by the CRC, not just the size', async () => {
  const b = new FakeBoard();
  const inner = b.handler;
  b.handler = code => { const r = inner(code); if (code.startsWith('f.close()')) { const f = b.fs.get(b._last); } return r; };
  // flip one byte after the last write, before verification, keeping the size
  b.handler = code => {
    if (code.startsWith('import os, binascii')) { const p = 'fox.json'; const f = b.fs.get(p); f[3] ^= 0x01; }
    return inner(code);
  };
  const d = new ReplDevice(b); d.onLog = () => {};
  await assert.rejects(d.writeText('fox.json', '{"a": 1, "b": 2}'), /CRC mismatch/);
});

test('writeBytes: a short write is still caught by the size check', async () => {
  const b = new FakeBoard();
  const inner = b.handler;
  b.handler = code => { if (code.startsWith('import os, binascii')) b.fs.set('x', b.fs.get('x').subarray(0, 2)); return inner(code); };
  const d = new ReplDevice(b); d.onLog = () => {};
  await assert.rejects(d.writeText('x', 'hello'), /wrote 5 bytes, board reports 2/);
});

test('readBytes/readText: present, missing, binary', async () => {
  const { d } = await mk({ files: { 'fox.json': '{"id":1}', 'bin': Uint8Array.from([0, 1, 254, 255]) } });
  assert.equal(await d.readText('fox.json'), '{"id":1}');
  assert.equal(await d.readText('nope.json'), null);
  assert.deepEqual(Array.from(await d.readBytes('bin')), [0, 1, 254, 255]);
});

test('list, mkdir, remove', async () => {
  const { b, d } = await mk({ files: { ...FOXLIB, 'code.py': 'x' } });
  const top = await d.list('');
  assert.equal(top['code.py'].size, 1);
  const sub = await d.list('foxlib');
  assert.deepEqual(Object.keys(sub).sort(), ['VERSION', '__init__.py', 'radio.py']);
  await d.mkdir('songs');
  await d.remove('code.py');
  assert.equal(b.fs.has('code.py'), false);
});

test('bench actions build a fresh Fox and return the firmware\'s answer', async () => {
  const { b, d } = await mk({ running: true, files: FOXLIB, execDelay: 20, bench: { rssi: '61' } });
  assert.equal(await d.bench('rssi'), '61');
  assert.equal(await d.bench('key', { seconds: 2 }), 'ok');
  assert.equal(await d.bench('batt'), '3.97');
  const probe = JSON.parse(await d.bench('probe'));                 // the Radio tab JSON.parses this; a Python repr would throw
  assert.deepEqual(probe, { '146.5': true, '433.5': false });
  assert.ok(b.execs.every(c => !c.includes('import foxlib') || /fox = foxlib\.Fox\('fox\.json', defaults='defaults\.json', quiet=True\)/.test(c)), 'every bench exec constructs Fox(quiet=True)');
  assert.ok(b.execs.every(c => !c.includes('import foxlib') || /fox\.deinit\(\)/.test(c)), 'every bench exec releases a previous Fox first');
  assert.ok(b.execs.every(c => !c.includes('import foxlib') || /if fox\.fatal: raise/.test(c)), 'every bench exec surfaces a fatal boot instead of an AttributeError');
  assert.match(b.execs.find(c => c.includes('key_for')), /key_for\(2\)/);
  await assert.rejects(d.bench('dance'), /unknown bench action/);
});

test('bench without foxlib on the board fails with the firmware\'s ImportError', async () => {
  const { d } = await mk({ files: { 'code.py': 'x' } });
  await assert.rejects(d.bench('rssi'), /ImportError/);
});

test('operation queue: concurrent calls run one after another, never interleaved', async () => {
  const { b, d } = await mk({ files: FOXLIB, execDelay: 5 });
  const [, , rssi] = await Promise.all([
    d.writeText('a.txt', 'A'.repeat(900)),
    d.writeText('b.txt', 'B'.repeat(900)),
    d.bench('rssi'),
  ]);
  assert.equal(rssi, '56');
  assert.equal(b.fs.get('a.txt').length, 900); assert.equal(b.fs.get('b.txt').length, 900);
  // between a file's open and its close, no other file is opened
  let open = null;
  for (const c of b.execs) {
    const m = c.match(/^f=open\(("[^"]*"),'wb'\)$/);
    if (m) { assert.equal(open, null, `opened ${m[1]} while ${open} was still open`); open = m[1]; }
    if (c.startsWith('f.close()')) open = null;
  }
  const interrupts = b.tx.filter(s => s === '\r\x03\x03').length;
  assert.equal(interrupts, 1, 'only the bench action interrupted, once, after the writes');
});

test('a failed operation does not wedge the queue', async () => {
  const { d } = await mk({ files: FOXLIB });
  await assert.rejects(d.exec('raise'), /NameError/);
  assert.equal(await d.readText('foxlib/VERSION'), '1.0.0\n');
});

test('reboot returns the boot log and the FOX banner parses, parentheses included', async () => {
  const banner = 'FOX template=composite/0.9.0 foxlib=1.0.0 board=seeed_xiao_esp32c3 uid=85c818eae840 cfg=partial(pins.batt_sense,id.wpm) radio=err(no reply) id=unset freq=146.565,147.42';
  const { d } = await mk({ bootLog: ['foxlib 1.0.0', banner] });
  const text = await d.reboot();
  const p = parseBanner(text);
  assert.equal(p.template, 'composite/0.9.0');
  assert.equal(p.cfg, 'partial(pins.batt_sense,id.wpm)');
  assert.equal(p.radio, 'err(no reply)');
  assert.equal(p.id, 'unset');
  assert.equal(p.freq, '146.565,147.42');
  assert.equal(parseBanner('nothing here'), null);
});

test('a deploy-shaped sequence on a running fox: interrupt → write set → reboot → banner', async () => {
  const files = { ...FOXLIB, 'code.py': 'old', 'fox.json': '{}' };
  const b = new FakeBoard({ running: true, noise: true, noiseMs: 3, ansi: true, chunk: 11, files, bootLog: board => ['FOX template=morse-songs/1.0.0 foxlib=1.0.0 board=seeed_xiao_esp32c3 uid=85c818eae840 cfg=ok radio=ok id=set freq=' + (board.fs.has('fox.json') ? '146.565' : 'none')] });
  const d = new ReplDevice(b); d.onLog = () => {};
  await d.connect();
  await d.interrupt();
  await d.writeText('fox.json', JSON.stringify({ plan: { frequencies_mhz: [146.565] } }));
  await d.writeText('code.py', 'import foxlib\n');
  await d.mkdir('foxlib');
  for (const [p, t] of Object.entries(FOXLIB)) await d.writeText(p, t);
  const text = await d.reboot();
  assert.equal(parseBanner(text).cfg, 'ok');
  assert.equal(b.reboots, 1);
  assert.equal(new TextDecoder().decode(b.fs.get('code.py')), 'import foxlib\n');
  await b.close();
});
