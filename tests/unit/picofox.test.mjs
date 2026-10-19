// picofox.test.mjs — the PicoFox vendor model: settings text, byte-sum marker, validation, cycle, files.
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pf from '../../js/model/vendor/picofox.js';
import { parseWav, renderPcm, wavBytes, levels } from '../../js/audio/wav.js';

const defaults = JSON.parse(readFileSync(new URL('../../firmware/templates/picofox/defaults/picofox.json', import.meta.url)));
const board = JSON.parse(readFileSync(new URL('../../boards/picofox.json', import.meta.url)));
const fixture = readFileSync(new URL('../fixtures/picofox/settings.txt', import.meta.url), 'utf8');

test('settings.txt round-trips byte for byte through parse → serialize (same layout the firmware writes)', () => {
  const s = pf.parseSettings(fixture);
  assert.equal(s.CALLSIGN, 'N0CALL/LOCK'); assert.equal(s.FREQ_MHZ, '147.470000');
  assert.equal(pf.serializeSettings(s), fixture);
});

test('byte-sum marker matches an independent computation (Python: sum(open(f,"rb").read()) = 10361) and little-endian int32 layout', () => {
  assert.equal(pf.byteSum(fixture), 10361);
  const m = pf.markerBytes(10361);
  assert.deepEqual(Array.from(m), [0x79, 0x28, 0, 0]);
  assert.equal(pf.readMarker(m), 10361);
});

test('firmwareCallsign keeps only A–Z 0–9, upper-cased, 12 max; dropped() names what went', () => {
  assert.equal(pf.firmwareCallsign('N0CALL/LOCK'), 'N0CALLLOCK');
  assert.equal(pf.firmwareCallsign('ky4zr/3'), 'KY4ZR3');
  assert.equal(pf.firmwareCallsign('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJKL');
  assert.deepEqual(pf.dropped('N0CALL/LOCK-1'), ['/', '-']);
});

test('settingsFromCfg: first word of the ID becomes CALLSIGN; deviation → MORSE_TONE_VOL; duty from schedule', () => {
  const cfg = structuredClone(defaults);
  cfg.id.callmessage = 'KY4ZR FOX DE KY4ZR'; cfg.radio.id_deviation_hz = 5000; cfg.schedule = { kind: 'duty', duty_percent: 60, pad_ms: 2000 }; cfg.plan.frequencies_mhz = [146.565];
  const s = pf.settingsFromCfg(cfg);
  assert.equal(s.CALLSIGN, 'KY4ZR'); assert.equal(s.MORSE_TONE_VOL, 50); assert.equal(s.DUTY_CYCLE, 60); assert.equal(s.FREQ_MHZ, 146.565);
  assert.match(pf.serializeSettings(s), /^CALLSIGN=KY4ZR\nITU_ZONE=2\nFREQ_MHZ=146.565000\nDUTY_CYCLE=60\n/);
  const back = pf.cfgFromSettings(pf.parseSettings(pf.serializeSettings(s)), defaults);
  assert.equal(back.schedule.duty_percent, 60); assert.equal(back.radio.id_deviation_hz, 5000); assert.equal(back.plan.frequencies_mhz[0], 146.565);
});

test('validate: band edges per zone, silent-fox conditions, dropped characters, deviation warnings', () => {
  const v = pf.validate({ id: { callmessage: 'KY4ZR FOX DE KY4ZR' }, plan: { frequencies_mhz: [146.565] } }, defaults, board);
  assert.equal(v.status, 'ok'); assert.deepEqual(v.issues.filter(i => i.level === 'err'), []);
  const edge = pf.validate({ id: { callmessage: 'KY4ZR' }, plan: { frequencies_mhz: [147.99] } }, defaults, board);
  assert.ok(edge.issues.some(i => i.level === 'err' && /20 kHz inside/.test(i.msg)), 'band-edge margin enforced');
  const z1 = pf.validate({ id: { callmessage: 'KY4ZR' }, radio: { itu_zone: 1 }, plan: { frequencies_mhz: [147.0] } }, defaults, board);
  assert.ok(z1.issues.some(i => i.level === 'err' && /zone 1/.test(i.msg)), 'zone 1 tops out at 146');
  const duty0 = pf.validate({ id: { callmessage: 'KY4ZR' }, schedule: { kind: 'duty', duty_percent: 0 } }, defaults, board);
  assert.ok(duty0.issues.some(i => i.level === 'err' && /never transmits/.test(i.msg)));
  const slash = pf.validate({ id: { callmessage: 'KY4ZR/3 FOX' } }, defaults, board);
  assert.ok(slash.issues.some(i => /becomes "KY4ZR3"/.test(i.msg)), 'dropped slash explained');
  const wide = pf.validate({ id: { callmessage: 'KY4ZR' }, radio: { id_deviation_hz: 7000 } }, defaults, board);
  assert.ok(wide.issues.some(i => /wider than/.test(i.msg)));
  const bad = pf.validate({ id: { callmessage: 'KY4ZR' }, radio: { itu_zone: 4, attenuation: 200 }, schedule: { kind: 'popcorn' }, payload: { kind: 'sstv' }, plan: { frequencies_mhz: [146.5, 146.6] } }, defaults, board);
  assert.equal(bad.status, 'partial(radio.itu_zone,radio.attenuation,payload.kind,schedule.kind)');
  assert.deepEqual(bad.cfg.plan.frequencies_mhz, [146.5]);
  assert.ok(bad.issues.some(i => /only the first entry/.test(i.msg)));
});

test('cycle: audio then ID, carrier offsets step per segment, duty gap and power steps', () => {
  const cfg = pf.validate({ id: { callmessage: 'KY4ZR' }, schedule: { kind: 'duty', duty_percent: 50 }, radio: { attenuation: 8 } }, defaults, board).cfg;
  const c = pf.cycle(cfg, 10 * 60 * 1000);
  assert.ok(c.audioMs > 10000 && c.idMs > 2000, `audio ${c.audioMs} id ${c.idMs}`);
  assert.equal(c.offMs, Math.round(c.onMs * 0.5));
  assert.deepEqual(c.items.slice(0, 3).map(i => i.kind), ['audio', 'id', 'off']);
  assert.deepEqual(c.items.filter(i => i.kind !== 'off').slice(0, 6).map(i => i.offsetHz), [0, 1000, 3000, 5000, 3000, 1000]);
  const attn = c.items.filter(i => i.kind === 'audio').slice(0, 3).map(i => i.attenuation);
  assert.deepEqual(attn, [8, 48, 28]);
  assert.equal(c.items[0].dbm, 16);
  const full = pf.cycle({ ...cfg, schedule: { kind: 'duty', duty_percent: 100 } }, 60000);
  assert.ok(full.items.every(i => i.kind !== 'off') && full.items.every(i => i.kind === 'off' || i.attenuation === 8), 'no gap and no stepping at 100 %');
  const r2 = pf.cycle({ ...cfg, radio: { ...cfg.radio, revision: 'r2' } }, 60000);
  assert.ok(r2.items.filter(i => i.kind === 'audio').every(i => i.attenuation === 8), 'rev 2 never steps');
});

test('files: four files, valid WAVs at 5 kHz s16 mono, levels = deviation / 10 kHz, marker = sum of settings', () => {
  const cfg = pf.validate({ id: { callmessage: 'KY4ZR FOX DE KY4ZR' }, radio: { id_deviation_hz: 5000, audio_deviation_hz: 4000 } }, defaults, board).cfg;
  const fs = pf.files(cfg);
  assert.deepEqual(fs.map(f => f.path), ['settings.txt', 'audio.wav', '.callsign.wav', '.settings_crc.bin']);
  const settings = fs[0].data; assert.match(settings, /^CALLSIGN=KY4ZR\n/);
  assert.equal(pf.readMarker(fs[3].data), pf.byteSum(settings));
  const id = parseWav(fs[2].data), au = parseWav(fs[1].data);
  assert.equal(id.sampleRate, 5000); assert.equal(id.channels, 1); assert.equal(id.bits, 16);
  assert.ok(Math.abs(levels(id.pcm).peak - 0.5) < 0.02, 'ID at 50 % = ±5 kHz');
  assert.ok(Math.abs(levels(au.pcm).peak - 0.4) < 0.02, 'audio at 40 % = ±4 kHz');
  assert.equal(id.pcm.length, Math.round(pf.idEvents(cfg).reduce((a, [, ms]) => a + ms, 0) * 5));
});

test('renderPcm: tone frequency and silence are right, high notes fold down an octave, edges are ramped', () => {
  const pcm = renderPcm([[1000, 100], [0, 50], [4000, 100]], { sampleRate: 5000, level: 1, rampMs: 2 });
  assert.equal(pcm.length, 1250);
  const zero = Array.from(pcm.slice(500, 750)); assert.ok(zero.every(x => x === 0), 'silence is zeros');
  // zero crossings of the first 100 ms at 1 kHz: ~200
  let zc = 0; for (let i = 1; i < 500; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) zc++;
  assert.ok(Math.abs(zc - 200) <= 4, `1 kHz tone: ${zc} zero crossings`);
  let zc2 = 0; for (let i = 751; i < 1250; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) zc2++;
  assert.ok(Math.abs(zc2 - 400) <= 6, `4 kHz folded to 2 kHz: ${zc2} zero crossings in 100 ms (an unfolded 4 kHz would alias to 1 kHz ≈ 200)`);
  assert.ok(Math.abs(pcm[0]) < 1000 && Math.abs(pcm[499]) < 1000, 'ramped edges');
  const w = parseWav(wavBytes(pcm, 5000)); assert.equal(w.pcm.length, pcm.length); assert.equal(w.pcm[300], pcm[300]);
});
