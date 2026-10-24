// fake-board.mjs — a Link that behaves like a CircuitPython board's USB-CDC
// REPL, with the quirks seen on real XIAO ESP32-C3s. Used to test the
// protocol layer (js/device/repl-link.js, repl-device.js) without hardware.
// SPDX-License-Identifier: GPL-2.0-only
//
// It is a state machine over the control bytes, not a Python interpreter:
// code sent in raw mode goes to `handler(code)`, and the default handler
// recognises the exact snippets repl-device.js sends (identity, listdir,
// read, write, mkdir, remove, bench) against an in-memory filesystem. If
// repl-device.js changes its snippets, these tests say so — on purpose.
//
// Quirks (constructor options):
//   running        code.py is running when the port opens (fox transmitting)
//   ctrlCIgnores   how many Ctrl-C to swallow before code.py stops (busy loop / USB hiccup)
//   ansi           prompts wrapped in ESC[2K ESC[0G and title-bar ESC]0;…ESC\\ like CP 9/10
//   noise          while running, emit a line of fox output every `noiseMs`
//   dropPrompt     omit the final '>' after an exec result (seen with the next read)
//   chunk          deliver output in slices of at most `chunk` bytes, async
//   latency        ms before each delivery
//   bootLog        lines code.py prints after a soft reboot (strings)
//   execDelay      ms the handler takes (first foxlib import compiles ~10 s on a C3)
import { Link } from '../../js/device/link.js';

const enc = new TextEncoder(), dec = new TextDecoder();
export const CP_BANNER = 'Adafruit CircuitPython 10.0.0 on 2025-09-10; Seeed Xiao ESP32C3 with ESP32-C3';
const TITLE = '\x1b]0;\u{1F40D}Wi-Fi: off | Done | 10.0.0\x1b\\';

/** Decode the Python bytes literal repl-device writes: b'...' with \\x.., \\', \\\\ escapes. */
export function parseBytesLiteral(lit) {
  const m = lit.match(/^b'([\s\S]*)'$/); if (!m) throw new Error('not a bytes literal: ' + lit.slice(0, 40));
  const out = []; const s = m[1];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out.push(s.charCodeAt(i)); continue; }
    const n = s[++i];
    if (n === 'x') { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else if (n === "'") out.push(0x27); else if (n === '\\') out.push(0x5c);
    else throw new Error('unexpected escape \\' + n);
  }
  return Uint8Array.from(out);
}

export class FakeBoard extends Link {
  constructor(opts = {}) {
    super();
    this.o = { running: false, ctrlCIgnores: 0, ansi: false, noise: false, noiseMs: 50, dropPrompt: false, chunk: 0, latency: 0, bootLog: [], execDelay: 0, ...opts };
    this.fs = new Map(Object.entries(opts.files || {}).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v]));   // path -> bytes; dirs end with '/'
    this.identity = { boardId: 'seeed_xiao_esp32c3', uid: '85c818eae840', release: '10.0.0', ...(opts.identity || {}) };
    this.bench = { probe: { '146.5': true, '433.5': false }, key: 'ok', rssi: '56', batt: '3.97', ...(opts.bench || {}) };
    this.handler = opts.handler || (code => this._defaultHandler(code));
    this.state = this.o.running ? 'running' : 'friendly';
    this.code = ''; this.openFile = null;
    this.tx = [];           // what the page sent, as strings, in order
    this.rxLog = [];        // what the board emitted
    this.execs = [];        // code snippets executed
    this.reboots = 0;
    this._pending = Promise.resolve();
    if (this.o.running && this.o.noise) this._startNoise();
  }

  async open() { if (this.o.ansi) this._emit(TITLE); }
  async close() { this.closed = true; this._stopNoise(); }
  info() { return 'fake board'; }

  _startNoise() { this._stopNoise(); this._noiseTimer = setInterval(() => { if (this.state === 'running') this._emit('tx 146.565 song=3\r\n'); }, this.o.noiseMs); }
  _stopNoise() { if (this._noiseTimer) clearInterval(this._noiseTimer); this._noiseTimer = null; }

  /** Deliver text to the page, honouring latency and chunking, in order. */
  _emit(text) {
    this.rxLog.push(text);
    const bytes = enc.encode(text);
    this._pending = this._pending.then(async () => {
      if (this.o.latency) await new Promise(r => setTimeout(r, this.o.latency));
      if (!this.o.chunk || bytes.length <= this.o.chunk) { this._feed(bytes); return; }
      for (let i = 0; i < bytes.length; i += this.o.chunk) { this._feed(bytes.subarray(i, i + this.o.chunk)); await new Promise(r => setTimeout(r, 1)); }
    });
    return this._pending;
  }
  _prompt(p) { return this.o.ansi ? '\x1b[2K\x1b[0G' + p : p; }
  _friendlyPrompt() { return (this.o.ansi ? TITLE : '') + this._prompt('>>> '); }

  async write(data) {
    const s = typeof data === 'string' ? data : dec.decode(data);
    this.tx.push(s);
    for (const ch of s) await this._byte(ch);
  }

  async _byte(ch) {
    switch (this.state) {
      case 'running':
        if (ch === '\x03') {
          if (this.o.ctrlCIgnores > 0) { this.o.ctrlCIgnores--; return; }
          this._stopNoise();
          this._emit('\r\nTraceback (most recent call last):\r\n  File "code.py", line 12, in <module>\r\n  File "foxlib/cycle.py", line 40, in run\r\nKeyboardInterrupt: \r\n\r\nCode done running.\r\n\r\nPress any key to enter the REPL. Use CTRL-D to reload.\r\n');
          this.state = 'anykey';
        }
        return;                                        // everything else is swallowed by the running program
      case 'anykey':
        if (ch === '\x04') { await this._reboot(); return; }
        this._emit('\r\n' + CP_BANNER + '\r\n' + this._friendlyPrompt());
        this.state = 'friendly';
        return;
      case 'friendly':
        if (ch === '\x03') { this._emit('\r\nKeyboardInterrupt\r\n' + this._friendlyPrompt()); return; }
        if (ch === '\x01') { this._emit('\r\n' + this._prompt('raw REPL; CTRL-B to exit\r\n>')); this.state = 'raw'; this.code = ''; return; }
        if (ch === '\x04') { await this._reboot(); return; }
        if (ch === '\r') { this._emit('\r\n' + this._friendlyPrompt()); return; }
        this._emit(ch);                                // echo
        return;
      case 'raw':
        if (ch === '\x02') { this._emit('\r\n' + CP_BANNER + '\r\n' + this._friendlyPrompt()); this.state = 'friendly'; return; }
        if (ch === '\x01') { this._emit('\r\n' + this._prompt('raw REPL; CTRL-B to exit\r\n>')); this.code = ''; return; }
        if (ch === '\x03') { this.code = ''; this._emit('\r\n>'); return; }
        if (ch === '\x04') {
          const code = this.code; this.code = '';
          if (!code) { this._emit('OK\x04\x04>'); return; }
          this.execs.push(code);
          this._emit('OK');
          const t0 = Date.now();
          let res; try { res = await this.handler(code); } catch (e) { res = { err: `Traceback (most recent call last):\r\n  File "<stdin>", line 1, in <module>\r\n${e.name || 'Exception'}: ${e.message}\r\n` }; }
          if (this.o.execDelay) await new Promise(r => setTimeout(r, Math.max(0, this.o.execDelay - (Date.now() - t0))));
          this._emit((res.out || '').replace(/\n/g, '\r\n') + '\x04' + (res.err || '') + '\x04' + (this.o.dropPrompt ? '' : '>'));
          return;
        }
        this.code += ch; return;
    }
  }

  async _reboot() {
    this.reboots++; this.state = 'running'; this.openFile = null;
    this._emit('\r\nsoft reboot\r\n\r\nAuto-reload is on. Simply save files over USB to run them or enter REPL to disable.\r\n' + (this.o.ansi ? TITLE : '') + 'code.py output:\r\n');
    const lines = typeof this.o.bootLog === 'function' ? this.o.bootLog(this) : this.o.bootLog;
    for (const l of lines) { await new Promise(r => setTimeout(r, 5)); this._emit(l + '\r\n'); }
    if (this.o.noise) this._startNoise();
  }

  /** The Python repl-device.js sends, answered from the in-memory filesystem. */
  _defaultHandler(code) {
    const J = s => JSON.parse(s);
    let m;
    if (code.startsWith('import board, microcontroller, os')) {
      const v = this.fs.get('foxlib/VERSION'); return { out: `${this.identity.boardId}\n${this.identity.uid}\n${v ? dec.decode(v).trim() : ''}\n${this.identity.release}\n` };
    }
    if ((m = code.match(/^import os\nfor n in os\.listdir\(("[^"]*")\)/))) {
      const dir = J(m[1]).replace(/^\//, ''); const prefix = dir ? dir + '/' : '';
      const seen = new Map();
      for (const [p, b] of this.fs) {
        if (!p.startsWith(prefix)) continue; const rest = p.slice(prefix.length); const name = rest.split('/')[0];
        if (!name) continue; if (rest.includes('/')) seen.set(name, 'd'); else if (!seen.has(name)) seen.set(name, b.length);
      }
      return { out: [...seen].map(([n, s]) => s === 'd' ? `${n} 0 d` : `${n} ${s} f`).join('\n') + '\n' };
    }
    if ((m = code.match(/^try:\n f=open\(("[^"]*"),'rb'\)/))) {
      const b = this.fs.get(J(m[1])); if (!b) return { out: '__MISSING__\n' };
      return { out: Array.from(b, c => c.toString(16).padStart(2, '0')).join('') };
    }
    if ((m = code.match(/^f=open\(("[^"]*"),'wb'\)$/))) { this.openFile = J(m[1]); this.fs.set(this.openFile, new Uint8Array(0)); return {}; }
    if ((m = code.match(/^f\.write\((b'[\s\S]*')\)$/))) {
      if (!this.openFile) throw new Error("NameError: name 'f' isn't defined");
      const cur = this.fs.get(this.openFile), add = parseBytesLiteral(m[1]); const nb = new Uint8Array(cur.length + add.length); nb.set(cur); nb.set(add, cur.length); this.fs.set(this.openFile, nb); return {};
    }
    if (code === 'f.close()') { if (!this.openFile) throw new Error("NameError: name 'f' isn't defined"); this.openFile = null; return {}; }
    if ((m = code.match(/^import os, binascii\nc=0\nf=open\(("[^"]*"),'rb'\)\nwhile True:\n b=f\.read\(512\)\n if not b: break\n c=binascii\.crc32\(b,c\)\nf\.close\(\)\nprint\(os\.stat\("[^"]*"\)\[6\], c\)/))) {
      const b = this.fs.get(J(m[1])); if (!b) throw new Error('OSError: [Errno 2] No such file/directory'); return { out: `${b.length} ${crc32(b)}\n` };
    }
    if ((m = code.match(/^import os\ntry:\n os\.mkdir\(("[^"]*")\)/))) { this.fs.set(J(m[1]).replace(/\/?$/, '/') + '', new Uint8Array(0)); return {}; }
    if ((m = code.match(/^import os\ntry:\n os\.remove\(("[^"]*")\)/))) { this.fs.delete(J(m[1])); return {}; }
    if (code.startsWith('import foxlib\n') && /fox = foxlib\.Fox\(/.test(code)) {
      if (!this.fs.has('foxlib/__init__.py')) throw new Error("ImportError: no module named 'foxlib'");
      if (!/fox\.deinit\(\)/.test(code)) throw new Error("ValueError: D3 in use");   // a second Fox in one VM must release the first
      // print(dict) on the board is a Python repr with single quotes and True/False — only json.dumps gives the page JSON
      if (/radio\.probe\(/.test(code)) return { out: (/json\.dumps\(/.test(code) ? JSON.stringify(this.bench.probe) : '{' + Object.entries(this.bench.probe).map(([k, v]) => `'${k}': ${v ? 'True' : 'False'}`).join(', ') + '}') + '\n' };
      if (/radio\.key_for\(/.test(code)) return { out: this.bench.key + '\n' };
      if (/radio\.rssi\(/.test(code)) return { out: this.bench.rssi + '\n' };
      if (/fox\.batt/.test(code)) return { out: this.bench.batt + '\n' };
    }
    if (code.startsWith('from foxlib.netfox import NetFox\n') && /fox = NetFox\(/.test(code)) {   // a network fox's bench
      if (!this.fs.has('foxlib/netfox.py')) throw new Error("ImportError: no module named 'foxlib.netfox'");
      if (!/fox\.deinit\(\)/.test(code)) throw new Error("RuntimeError: radio in use");
      if (/fox\.key_for\(/.test(code)) { const m2 = code.match(/key_for\((\d+)\)/); return { out: `ok wifi-ap FOXBENCH WiFi Beacon for ${m2 ? m2[1] : 3}.0 s\n` }; }
      if (/fox\.rssi\(/.test(code)) return { out: '-55 Neighbour | -70 AnotherAP\n' };
    }
    if (code.startsWith('print(')) return { out: 'printed\n' };
    throw new Error("NameError: unrecognised snippet: " + code.split('\n')[0].slice(0, 60));
  }
}

// Independent CRC32 (not the page's) so the test checks the page's implementation too.
export function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; }
