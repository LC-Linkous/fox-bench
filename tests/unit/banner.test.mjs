// parseBanner takes keys straight off the wire. A board (or a fake one) that prints `__proto__=…` must not reach
// Object.prototype — audit Low: "__proto__ as a banner board id freezes the page until reload".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBanner } from '../../js/device/device.js';

test('a banner is a flat map of its key=value pairs; quoted values keep their spaces', () => {
  const b = parseBanner('boot\nFOX template=morse-songs/1.1.0 foxlib=1.2.1 board=seeed_xiao_esp32c3 uid=abc123 cfg=ok radio=ok name="W1ABC FOX" freq=146.565\n');
  assert.equal(b.board, 'seeed_xiao_esp32c3');
  assert.equal(b.name, 'W1ABC FOX');
  assert.equal(b.template, 'morse-songs/1.1.0');
  assert.equal(parseBanner('nothing here'), null);
});

test('prototype keys off the wire stay plain keys and touch nothing shared', () => {
  const before = Object.prototype.polluted;
  const b = parseBanner('FOX board=__proto__ __proto__=x constructor=y uid=1 cfg=ok radio=ok');
  assert.equal(b.board, '__proto__');
  assert.equal(Object.getPrototypeOf(b), null, 'result has no prototype');
  assert.equal(b.__proto__, 'x', 'the key is a plain own key');
  assert.equal(Object.prototype.polluted, before);
  assert.equal(({}).x, undefined, 'Object.prototype untouched');
  // the thing the page does with it next: look the id up in the catalog without finding Object.prototype
  const boards = Object.create(null); boards.seeed_xiao_esp32c3 = { id: 'seeed_xiao_esp32c3' };
  assert.equal(Object.hasOwn(boards, b.board), false);
  assert.equal(boards[b.board], undefined);
});
