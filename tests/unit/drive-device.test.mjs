// drive-device.test.mjs — the drive transport over the in-memory directory handle.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DriveDevice, demoDrive } from '../../js/device/drive-device.js';
import { MemDirectoryHandle } from '../../js/device/memfs.js';
import * as pf from '../../js/model/vendor/picofox.js';

const board = JSON.parse(readFileSync(new URL('../../boards/picofox.json', import.meta.url)));
const defaults = JSON.parse(readFileSync(new URL('../../firmware/templates/picofox/defaults/picofox.json', import.meta.url)));

test('connect lists the drive and warns when it does not look like the board\'s drive', async () => {
  const logs = [];
  const d = new DriveDevice(new MemDirectoryHandle('PicoFox', { 'settings.txt': 'CALLSIGN=X\n', 'audio.wav': new Uint8Array(100) }), { board }); d.onLog = (t, c) => logs.push([c, t]);
  const info = await d.connect();
  assert.equal(info.boardId, 'picofox'); assert.equal(info.driveName, 'PicoFox'); assert.equal(info.files['audio.wav'].size, 100);
  assert.ok(!logs.some(([c]) => c === 'err'));
  const other = new DriveDevice(new MemDirectoryHandle('USB STICK', { 'holiday.jpg': new Uint8Array(3) }), { board }); const l2 = []; other.onLog = (t, c) => l2.push([c, t]);
  await other.connect();
  assert.ok(l2.some(([c, t]) => c === 'err' && /right drive/.test(t)));
});

test('write → read back identical; text and bytes; remove; missing file reads null', async () => {
  const d = new DriveDevice(new MemDirectoryHandle('PicoFox'), { board }); d.onLog = () => {};
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 255);
  await d.writeBytes('audio.wav', bytes);
  assert.deepEqual(Array.from(await d.readBytes('audio.wav')), Array.from(bytes));
  await d.writeText('settings.txt', 'CALLSIGN=KY4ZR\n');
  assert.equal(await d.readText('settings.txt'), 'CALLSIGN=KY4ZR\n');
  assert.equal(await d.readText('nope'), null);
  await d.remove('settings.txt'); assert.equal(await d.readText('settings.txt'), null);
  await d.remove('nope');   // no throw
});

test('a short write is detected by the read-back', async () => {
  const h = new MemDirectoryHandle('PicoFox');
  const d = new DriveDevice(h, { board }); d.onLog = () => {};
  const origGet = h.getFileHandle.bind(h);
  h.getFileHandle = async (name, o) => { const fh = await origGet(name, o); const cw = fh.createWritable.bind(fh); fh.createWritable = async () => { const w = await cw(); const ww = w.write.bind(w); w.write = async data => ww(data.subarray(0, 3)); return w; }; return fh; };
  await assert.rejects(d.writeBytes('x', new Uint8Array(10)), /wrote 10 bytes, drive holds 3/);
});

test('no REPL: exec and bench refuse, reboot is a no-op with advice', async () => {
  const d = new DriveDevice(new MemDirectoryHandle('PicoFox'), { board }); const logs = []; d.onLog = t => logs.push(t);
  await assert.rejects(d.exec('print(1)'), /no REPL/);
  await assert.rejects(d.bench('rssi'), /need a REPL/);
  assert.equal(await d.reboot(), ''); assert.ok(logs.some(t => /switch the board off and on/.test(t)));
});

test('a full PicoFox deploy onto the demo drive: four files, marker matches, settings parse back', async () => {
  const d = await demoDrive(board, { MemDirectoryHandle }); d.onLog = () => {};
  assert.equal(d.kind, 'demo'); assert.equal(d.transport, 'drive');
  const cfg = pf.validate({ id: { callmessage: 'KY4ZR FOX DE KY4ZR' }, schedule: { kind: 'duty', duty_percent: 50 } }, defaults, board).cfg;
  for (const f of pf.files(cfg)) await d.writeBytes(f.path, typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data);
  const files = await d.list('');
  assert.deepEqual(Object.keys(files).sort(), ['.callsign.wav', '.settings_crc.bin', 'audio.wav', 'settings.txt']);
  const settings = await d.readText('settings.txt');
  assert.equal(pf.readMarker(await d.readBytes('.settings_crc.bin')), pf.byteSum(settings));
  assert.equal(pf.parseSettings(settings).DUTY_CYCLE, '50');
});
