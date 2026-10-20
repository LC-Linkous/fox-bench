// drive-device.js — Device over a USB drive (File System Access API): for boards whose
// firmware is configured by files on a mass-storage volume and offers no REPL (the PicoFox).
// SPDX-License-Identifier: GPL-2.0-only
//
// The user picks the drive's folder once (showDirectoryPicker, Chrome/Edge); after that
// files are read and written directly. There is nothing to execute, interrupt or reboot:
// exec/bench throw, reboot() returns '' and the page tells the user to power-cycle.
// Every write is verified by reading the file back (size and bytes).
import { Device } from './device.js';

const enc = new TextEncoder(), dec = new TextDecoder();

export class DriveDevice extends Device {
  constructor(handle, { board = null } = {}) {
    super(); this.kind = 'drive'; this.transport = 'drive'; this.handle = handle; this.board = board;
    this._queue = Promise.resolve();
  }
  _run(fn) { const p = this._queue.then(fn, fn); this._queue = p.catch(() => {}); return p; }

  /** Ask the user for the drive. Throws if the browser cannot, or the user cancels. */
  static async pick({ id = 'fox-bench-drive' } = {}) {
    if (!('showDirectoryPicker' in window)) throw new Error('This browser cannot open a drive folder (File System Access API). Use Chrome or Edge on a laptop or desktop.');
    const handle = await window.showDirectoryPicker({ id, mode: 'readwrite' });
    if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('write permission to the drive was not granted');
    return handle;
  }

  async connect() { return this._run(() => this._connect()); }
  async _connect() {
    const files = await this._list();
    const expected = this.board?.drive?.files || [];
    const looksRight = !expected.length || expected.some(f => f in files);
    if (!looksRight) this.log(`"${this.handle.name}" has none of ${expected.join(', ')} — is this the right drive? A factory-reset board recreates them at power-on.`, 'err');
    else this.log(`drive "${/^[\\/]*$/.test(this.handle.name || '') ? (this.board?.drive?.label || 'drive') : this.handle.name}": ${Object.keys(files).sort().join('  ')}`, 'dim');
    const name = /^[\\/]*$/.test(this.handle.name || '') ? (this.board?.drive?.label || 'drive') : this.handle.name;   // a Windows drive root is named "\"
    return { boardId: this.board?.id || 'drive', uid: '', foxlibVersion: '', cpVersion: '', files, driveName: name };
  }

  async list() { return this._run(() => this._list()); }
  async _list() {
    const files = {};
    for await (const h of this.handle.values()) {
      if (h.kind === 'directory') { files[h.name] = { size: 0, dir: true }; continue; }
      try { const f = await h.getFile(); files[h.name] = { size: f.size, dir: false, modified: f.lastModified }; } catch { files[h.name] = { size: -1, dir: false }; }
    }
    return files;
  }

  async readBytes(path) { return this._run(() => this._readBytes(path)); }
  async _readBytes(path) {
    try { const h = await this.handle.getFileHandle(path); return new Uint8Array(await (await h.getFile()).arrayBuffer()); }
    catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
  }
  async readText(path) { const b = await this.readBytes(path); return b == null ? null : dec.decode(b); }

  async writeBytes(path, bytes) { return this._run(() => this._writeBytes(path, bytes)); }
  async _writeBytes(path, bytes) {
    const h = await this.handle.getFileHandle(path, { create: true });
    const w = await h.createWritable({ keepExistingData: false });
    try { await w.write(bytes); } finally { await w.close(); }
    const back = new Uint8Array(await (await h.getFile()).arrayBuffer());
    if (back.length !== bytes.length) throw new Error(`${path}: wrote ${bytes.length} bytes, drive holds ${back.length}`);
    for (let i = 0; i < bytes.length; i++) if (back[i] !== bytes[i]) throw new Error(`${path}: byte ${i} differs after write`);
    this.log(`wrote ${path} (${bytes.length} B, read back identical)`, 'ok');
  }
  async writeText(path, text) { return this.writeBytes(path, enc.encode(text)); }

  async remove(path) { return this._run(async () => { try { await this.handle.removeEntry(path); } catch (e) { if (e.name !== 'NotFoundError') throw e; } }); }
  async mkdir() {}
  async interrupt() {}
  async reboot() { this.log('no reset over USB: eject the drive, then switch the board off and on', 'dim'); return ''; }
  async exec() { throw new Error('this board has no REPL; files only'); }
  async bench() { throw new Error('bench actions need a REPL; this board has none'); }
  async close() {}
}

/** The demo board for this family: an in-memory drive seeded like a factory PicoFox. */
export async function demoDrive(board, { MemDirectoryHandle }) {
  const settings = 'CALLSIGN=\nITU_ZONE=2\nFREQ_MHZ=146.565000\nDUTY_CYCLE=100\nATTENUATION=0\nMORSE_WPM=15\nMORSE_FARNSWORTH_WPM=10\nMORSE_TONE=600\nMORSE_TONE_VOL=70\n';
  const wav = new Uint8Array(44 + 5000 * 2); wav.set(enc.encode('RIFF'), 0); wav.set(enc.encode('WAVE'), 8);
  const handle = new MemDirectoryHandle(board?.drive?.label || 'PICOFOX', { 'settings.txt': settings, 'audio.wav': wav });
  const d = new DriveDevice(handle, { board }); d.kind = 'demo'; d.demo = true;
  return d;
}
