// flasher.js — put CircuitPython on a bare ESP32 board from the browser.
// SPDX-License-Identifier: GPL-2.0-only
//
// Wraps Espressif's esptool-js (Apache-2.0), loaded at run time from a CDN
// the first time it is needed; it is not part of this repository. If it
// cannot be loaded (offline, blocked CDN) flashing is unavailable and the
// page says so — tools/batch_flash.py does the same job from a terminal.
//
// A flash is: user picks the board's bootloader port → connect, detect
// chip, run the stub → (erase whole flash) → write the .bin at the board's
// offset, MD5-verified → hard reset into CircuitPython. The chip facts
// (MAC, revision, features, crystal, flash size) come back for the fleet
// log; on ESP32 the MAC is also microcontroller.cpu.uid, so the flash row
// and later deploy rows share a key.
import { md5 } from '../model/md5.js';

export const ESPTOOL_VERSION = '0.7.0';
export const ESPTOOL_URL = `https://cdn.jsdelivr.net/npm/esptool-js@${ESPTOOL_VERSION}/bundle.js`;
export const BIN_URL = (boardId, version) => `https://downloads.circuitpython.org/bin/${boardId}/en_US/adafruit-circuitpython-${boardId}-en_US-${version}.bin`;

let esptool = null;
export async function loadEsptool() {
  if (esptool) return esptool;
  try { esptool = await import(/* webpackIgnore: true */ ESPTOOL_URL); }
  catch (e) { throw new Error(`could not load esptool-js from ${ESPTOOL_URL} (${e.message || e}). Flashing needs that library; offline, use tools/batch_flash.py.`); }
  return esptool;
}

/** adafruit-circuitpython-<board>-<lang>-<version>.bin → { boardId, lang, version }; null if not that shape. */
export function parseBinName(name) {
  const m = /^adafruit-circuitpython-(.+)-([a-z]{2}(?:_[A-Z]{2})?)-([\w.\-]+)\.bin$/.exec(name || '');
  return m ? { boardId: m[1], lang: m[2], version: m[3] } : null;
}

/** The image to flash, kept across tabs (Board tab loads it, Fleet tab batch-flashes it). */
export const image = { name: '', bytes: null, info: null, source: '' };
export function setImage(name, bytes, source = 'file') { image.name = name; image.bytes = bytes; image.info = parseBinName(name); image.source = source; }

/**
 * Flash `image` onto the board on a port the user picks. Resolves with chip facts.
 *   opts: { offset, eraseAll, baud, onLog(text), onProgress(fraction, phase), onPhase(text), impl }
 * `impl` replaces the esptool-js module (the demo passes a simulator).
 */
export async function flash({ offset = 0, eraseAll = true, baud = 460800, onLog = () => {}, onProgress = () => {}, onPhase = () => {}, impl = null } = {}) {
  if (!image.bytes) throw new Error('no CircuitPython image loaded');
  const lib = impl || await loadEsptool();
  if (!impl && !('serial' in navigator)) throw new Error('Web Serial is not available in this browser (use Chrome or Edge on a laptop or desktop)');
  onPhase('choose the board\'s port');
  const port = impl ? null : await navigator.serial.requestPort();
  const transport = new lib.Transport(port, false);
  const terminal = { clean() {}, writeLine: t => onLog(t), write: t => onLog(t) };
  const loader = new lib.ESPLoader({ transport, baudrate: baud, romBaudrate: 115200, terminal });
  const t0 = performance.now();
  const facts = { chip: '', revision: '', features: '', crystal: '', mac: '', flash_size: '', erase_ok: '', flash_ok: '', seconds: 0 };
  try {
    onPhase('connecting (hold B if it does not answer)');
    facts.chip = await loader.main();                   // detect, print facts, run stub, change baud
    try { facts.revision = String(await loader.chip.getChipRevision?.(loader) ?? ''); } catch {}
    try { facts.features = (await loader.chip.getChipFeatures(loader)).join(' '); } catch {}
    try { facts.crystal = String(await loader.chip.getCrystalFreq(loader)) + 'MHz'; } catch {}
    try { facts.mac = (await loader.chip.readMac(loader)).toLowerCase(); } catch {}
    try { facts.flash_size = (await loader.detectFlashSize?.()) || ''; } catch {}
    if (eraseAll) {
      onPhase('erasing whole flash');
      try { await loader.eraseFlash(); facts.erase_ok = 'yes'; } catch (e) { facts.erase_ok = 'no'; throw e; }
    } else facts.erase_ok = 'skipped';
    onPhase(`writing ${image.name} (${(image.bytes.length / 1024).toFixed(0)} kB) at 0x${offset.toString(16)}`);
    await loader.writeFlash({
      fileArray: [{ data: image.bytes, address: offset }],
      flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
      reportProgress: (i, written, total) => onProgress(total ? written / total : 0, 'write'),
      calculateMD5Hash: img => md5(img),
    });
    facts.flash_ok = 'yes';
    onPhase('resetting into CircuitPython');
    try { await loader.after('hard_reset'); } catch {}
  } catch (e) {
    if (!facts.flash_ok) facts.flash_ok = 'no';
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { facts });
  } finally {
    facts.seconds = Math.round((performance.now() - t0) / 100) / 10;
    try { await transport.disconnect(); } catch {}
  }
  return facts;
}

/** A stand-in for esptool-js so "Try without hardware" exercises the whole flow. */
export function demoEsptool({ ms = 1500 } = {}) {
  const sleep = t => new Promise(r => setTimeout(r, t));
  class Transport { constructor() {} async disconnect() {} }
  class ESPLoader {
    constructor({ terminal }) { this.t = terminal; this.chip = { getChipRevision: async () => 4, getChipFeatures: async () => ['WiFi', 'BLE'], getCrystalFreq: async () => 40, readMac: async () => '84:F7:03:12:34:56' }; }
    async main() { await sleep(ms * 0.2); this.t.writeLine('Chip is ESP32-C3 (QFN32) (revision v0.4)'); this.t.writeLine('Uploading stub...'); this.t.writeLine('Stub running...'); return 'ESP32-C3 (QFN32) (revision v0.4)'; }
    async detectFlashSize() { return '4MB'; }
    async eraseFlash() { this.t.writeLine('Erasing flash (this may take a while)...'); await sleep(ms * 0.3); this.t.writeLine('Chip erase completed successfully in 0.4s'); }
    async writeFlash({ fileArray, reportProgress, calculateMD5Hash }) {
      const total = fileArray[0].data.length; const steps = 10;
      for (let i = 1; i <= steps; i++) { await sleep(ms * 0.4 / steps); reportProgress(0, Math.round(total * i / steps), total); }
      this.t.writeLine(`Hash of data verified: ${calculateMD5Hash ? calculateMD5Hash(fileArray[0].data) : '(skipped)'}`);
    }
    async after() { this.t.writeLine('Hard resetting via RTS pin...'); await sleep(ms * 0.1); }
  }
  return { Transport, ESPLoader };
}
