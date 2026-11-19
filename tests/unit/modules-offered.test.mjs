// modules-offered.test.mjs — the Radio & pins module dropdown: a module fixed to one board is offered on that board only.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offeredModules } from '../../js/ui/radio.js';

const modules = {
  sa868_vhf: { id: 'sa868_vhf', name: 'SA868 VHF' },
  sa868_uhf: { id: 'sa868_uhf', name: 'SA868 UHF' },
  picofox_si5351: { id: 'picofox_si5351', name: 'PicoFox SI5351', fixed_to_board: 'picofox' },
};

test('the PicoFox\'s SI5351 is not offered on the XIAO + SA868 board', () => {
  const app = { catalog: { modules }, boardId: 'seeed_xiao_esp32c3', board: {} };
  assert.deepEqual(offeredModules(app).map(m => m.id), ['sa868_vhf', 'sa868_uhf']);
});

test('on the PicoFox itself only its built-in module is offered', () => {
  const app = { catalog: { modules }, boardId: 'picofox', board: { module_fixed: 'picofox_si5351' } };
  assert.deepEqual(offeredModules(app).map(m => m.id), ['picofox_si5351']);
});
