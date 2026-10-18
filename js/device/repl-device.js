// repl-device.js — Device over the raw REPL: files are read and written by
// Python running on the board. This is the path for boards with no USB
// drive (ESP32-C3), where the REPL is the only way to touch the filesystem.
// SPDX-License-Identifier: GPL-2.0-only
import { Device } from './device.js';
import { ReplLink } from './repl-link.js';

const WRITE_CHUNK = 384;   // bytes per f.write(); bytes-literal escapes roughly double it on the wire

function pyBytesLiteral(bytes) {
  let s = "b'";
  for (const b of bytes) {
    if (b === 0x27) s += "\\'"; else if (b === 0x5c) s += '\\\\';
    else if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
    else s += '\\x' + b.toString(16).padStart(2, '0');
  }
  return s + "'";
}
function hexToBytes(hex) { const out = new Uint8Array(hex.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16); return out; }

export class ReplDevice extends Device {
  constructor(link) {
    super(); this.kind = 'repl'; this.link = link;
    this._queue = Promise.resolve();      // one operation on the wire at a time; a second call waits, never interrupts
    this.repl = new ReplLink(link, t => this.log(t, 'dim'));
    this.repl.onUnsolicited = t => this.log(t.replace(/\r/g, ''), 'reply');
    this.enc = new TextEncoder(); this.dec = new TextDecoder();
  }

  /** Run fn when the previous operation has finished (success or failure). */
  _run(fn) { const p = this._queue.then(fn, fn); this._queue = p.catch(() => {}); return p; }

  async connect() { return this._run(() => this._connect()); }
  async _connect() {
    await this.repl.interrupt();
    const out = await this._exec(
      "import board, microcontroller, os\n" +
      "print(board.board_id)\n" +
      "print(''.join('%02x' % b for b in microcontroller.cpu.uid))\n" +
      "try:\n print(open('foxlib/VERSION').read().strip())\nexcept Exception:\n print('')\n" +
      "print(os.uname().release)\n");
    const [boardId, uid, foxlibVersion, cpVersion] = out.trim().split('\n').map(s => s.trim());
    const files = await this._list('');
    return { boardId, uid, foxlibVersion, cpVersion, files };
  }

  async interrupt() { return this._run(() => this.repl.interrupt()); }

  async exec(code, opts) { return this._run(() => this._exec(code, opts)); }
  async _exec(code, opts) {
    this.log(code.split('\n')[0] + (code.includes('\n') ? ' …' : ''), 'tx');
    const { out } = await this.repl.exec(code, opts);
    return out;
  }

  async list(path = '') { return this._run(() => this._list(path)); }
  async _list(path = '') {
    const out = await this._exec(
      `import os\nfor n in os.listdir(${JSON.stringify(path || '/')}):\n` +
      ` try:\n  s=os.stat(${JSON.stringify(path ? path + '/' : '')}+n); print(n, s[6], 'd' if s[0] & 0x4000 else 'f')\n except Exception as e:\n  print(n, -1, '?')\n`);
    const files = {};
    for (const line of out.trim().split('\n')) { if (!line.trim()) continue; const [n, size, kind] = line.trim().split(' '); files[n] = { size: +size, dir: kind === 'd' }; }
    return files;
  }

  async readBytes(path) { return this._run(() => this._readBytes(path)); }
  async _readBytes(path) {
    const out = await this._exec(
      `try:\n f=open(${JSON.stringify(path)},'rb')\nexcept OSError:\n print('__MISSING__')\nelse:\n` +
      ` while True:\n  b=f.read(512)\n  if not b: break\n  print(''.join('%02x'%c for c in b), end='')\n f.close()\n`, { timeout: 30000 });
    if (out.startsWith('__MISSING__')) return null;
    return hexToBytes(out.trim());
  }
  async readText(path) { const b = await this.readBytes(path); return b == null ? null : this.dec.decode(b); }
  async _readText(path) { const b = await this._readBytes(path); return b == null ? null : this.dec.decode(b); }

  async writeBytes(path, bytes) { return this._run(() => this._writeBytes(path, bytes)); }
  async _writeBytes(path, bytes) {
    await this._exec(`f=open(${JSON.stringify(path)},'wb')`);
    for (let i = 0; i < bytes.length; i += WRITE_CHUNK) {
      await this.repl.exec(`f.write(${pyBytesLiteral(bytes.subarray(i, i + WRITE_CHUNK))})`);
    }
    const out = await this.repl.exec(`f.close()\nimport os\nprint(os.stat(${JSON.stringify(path)})[6])`);
    const size = parseInt(out.out.trim(), 10);
    if (size !== bytes.length) throw new Error(`${path}: wrote ${bytes.length} bytes, board reports ${size}`);
    this.log(`wrote ${path} (${bytes.length} B)`, 'ok');
  }
  async writeText(path, text) { return this.writeBytes(path, this.enc.encode(text)); }

  async mkdir(path) { return this._run(() => this._exec(`import os\ntry:\n os.mkdir(${JSON.stringify(path)})\nexcept OSError:\n pass\n`)); }
  async remove(path) { return this._run(() => this._exec(`import os\ntry:\n os.remove(${JSON.stringify(path)})\nexcept OSError:\n pass\n`)); }

  async reboot() { return this._run(() => this._reboot()); }
  async _reboot() {
    this.log('soft reboot (Ctrl-D) — capturing boot log', 'dim');
    const text = await this.repl.rebootAndCapture();
    this.log(text, 'reply');
    return text;
  }

  /** Bench actions run against a fresh foxlib.Fox (CircuitPython's REPL does not keep code.py's globals). */
  async bench(action, args = {}) { return this._run(() => this._bench(action, args)); }
  async _bench(action, args = {}) {
    await this.repl.interrupt();
    const pre = "import foxlib\nfox = foxlib.Fox('fox.json', defaults='defaults.json', quiet=True)\n";
    const body = {
      probe: `print(fox.radio.probe(${JSON.stringify(args.freqs || [146.5, 433.5]).replace(/\[|\]/g, m => m === '[' ? '(' : ')')}))`,
      key:   `print(fox.radio.key_for(${+args.seconds || 3}))`,
      rssi:  `print(fox.radio.rssi())`,
      batt:  `print(fox.batt.read() if fox.batt else None)`,
    }[action];
    if (!body) throw new Error('unknown bench action ' + action);
    return (await this._exec(pre + body, { timeout: 45000 + (args.seconds || 0) * 1000 })).trim();   // first import compiles foxlib: several seconds on a C3
  }

  async close() { try { await this.repl.exitRaw(); } catch {} await this.link.close(); }
}
