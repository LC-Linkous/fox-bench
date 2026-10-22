// transport.test.mjs — a deploy goes out only over the transport its family uses (js/model/transport.js).
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployBlocker, deployTransports } from '../../js/model/transport.js';

const xiao = { id: 'seeed_xiao_esp32c3', name: 'XIAO ESP32-C3', family: undefined };
const pico = { id: 'picofox-foxlibc', name: 'PicoFox (fox-bench firmware)', family: 'foxlib-c' };
const vendor = { id: 'picofox-vendor', name: 'PicoFox (vendor firmware)', family: 'drive' };
const idle = { listening: false };

test('transports per family', () => {
  assert.deepEqual(deployTransports('foxlib'), ['repl', 'memory']);
  assert.deepEqual(deployTransports('foxlib-c'), ['drive']);
  assert.deepEqual(deployTransports('drive'), ['drive']);
});

test('the right pairings pass', () => {
  assert.equal(deployBlocker({ device: { transport: 'repl', kind: 'repl' }, board: xiao, onBoard: idle }), null);
  assert.equal(deployBlocker({ device: { transport: 'memory', kind: 'demo', board: xiao }, board: xiao, onBoard: idle }), null);
  assert.equal(deployBlocker({ device: { transport: 'drive', kind: 'drive' }, board: pico, onBoard: idle }), null);
  assert.equal(deployBlocker({ device: { transport: 'drive', kind: 'demo', board: vendor }, board: vendor, onBoard: idle }), null);
});

test('a REPL device with a PicoFox selected is refused (fox.json would land on the CircuitPython board)', () => {
  const why = deployBlocker({ device: { transport: 'repl', kind: 'repl' }, board: pico, onBoard: idle });
  assert.match(why, /CircuitPython REPL/); assert.match(why, /deployed over its drive/);
});

test('a drive with the XIAO selected is refused (foxlib would be written into the drive)', () => {
  assert.match(deployBlocker({ device: { transport: 'drive', kind: 'drive' }, board: xiao, onBoard: idle }), /USB drive.*deployed over the REPL/);
});

test('the foxlib-c console (Listen only) is never a deploy transport', () => {
  assert.match(deployBlocker({ device: { transport: 'console', kind: 'console', listening: true }, board: pico, onBoard: { listening: true } }), /serial console/);
});

test('listen-only on the REPL is refused until the board is identified', () => {
  assert.match(deployBlocker({ device: { transport: 'repl', kind: 'repl' }, board: xiao, onBoard: { listening: true } }), /Listen only/);
});

test('a demo board of another board id is refused', () => {
  assert.match(deployBlocker({ device: { transport: 'drive', kind: 'demo', board: vendor }, board: pico, onBoard: idle }), /start the demo again/);
});

test('nothing connected', () => { assert.equal(deployBlocker({ device: null, board: xiao, onBoard: idle }), 'not connected'); });
