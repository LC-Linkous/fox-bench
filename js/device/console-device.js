// console-device.js — Device over the foxlib-c firmware's serial console (PicoFox with fox-bench
// firmware). Line protocol, PROTOCOL.md "foxlib-c console": the fox prints its banner and log
// freely; a command is one line and is answered by `ok` or `err: …` once it has *finished*
// (a `key 2` answers `keyed 2.0 s` at once and `ok` two seconds later).
// SPDX-License-Identifier: GPL-2.0-only
//
// Files travel over the console too (PROTOCOL.md "Files over the console"): `put`, `get`, `rm`
// as base64 in lines. This device offers the same file surface as drive-device.js — list,
// readText/readBytes, writeText/writeBytes, remove — so the Deploy tab does not know whether it
// is writing a drive (the PicoFox) or talking to a console-configured fox (the ESP32 boards).
import { Device } from './device.js';
import { Link } from './link.js';
import { crc32 } from '../model/zip.js';

const dec = new TextDecoder(), enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex8 = n => n.toString(16).padStart(8, '0');

export class ConsoleDevice extends Device {
  constructor(link) {
    super(); this.kind = 'console'; this.transport = 'console'; this.link = link; this.listening = true;
    this._buf = ''; this._pending = null; this._queue = Promise.resolve(); this._lastRx = 0;
    link.onData = bytes => this._onData(bytes);
  }
  _run(fn) { const p = this._queue.then(fn, fn); this._queue = p.catch(() => {}); return p; }

  _onData(bytes) {
    this._buf += dec.decode(bytes, { stream: true });
    let i;
    while ((i = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, i).replace(/\r$/, ''); this._buf = this._buf.slice(i + 1);
      this._line(line);
    }
  }
  _line(line) {
    this._lastRx = Date.now();
    if (!line) return;
    this.log(line, 'reply');                          // everything the fox says is shown, command replies included
    const p = this._pending; if (!p) return;
    if (p.onLine && p.onLine(line)) return;
    if (/^ok(\s|$)/.test(line)) { p.resolve({ ok: true, lines: p.lines, okLine: line }); this._pending = null; }
    else if (line.startsWith('err:')) { p.resolve({ ok: false, error: line.slice(4).trim(), lines: p.lines }); this._pending = null; }
    else p.lines.push(line);
  }

  /** Listen only: the port is open, the banner arrives by itself. */
  async listen() { return { boardId: '?', uid: '', foxlibVersion: '', cpVersion: '', files: {}, listening: true }; }
  /** Connect (a console-configured fox): ask who it is — `version` gives the firmware and board id, `uid` the chip's. */
  async connect() {
    const v = await this.command('version', { timeout: 4000 });
    if (!v.ok) throw new Error(`the console answered "${v.error}" to version — is this fox-bench firmware?`);
    const m = v.lines.join(' ').match(/foxlib-c\s+(\S+)\s+board=(\S+)/);
    if (!m) throw new Error(`unexpected version reply: ${v.lines.join(' | ') || 'nothing'}`);
    const u = await this.command('uid', { timeout: 4000 });
    const uid = (u.lines.join(' ').match(/uid=([0-9a-fA-F]+)/) || [])[1] || '';
    return { boardId: m[2], uid, foxlibVersion: 'c-' + m[1], cpVersion: '', files: {}, listening: false };
  }

  /** Send one command line and wait for its ok / err. Output lines before the reply are returned. */
  async command(text, { timeout = 5000 } = {}) {
    return this._run(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this._pending?.resolve === done) { this._pending = null; reject(new Error(`no reply to "${text}" within ${timeout / 1000} s`)); } }, timeout);
      const done = r => { clearTimeout(timer); resolve(r); };
      this._pending = { lines: [], resolve: done };
      this.log(text, 'tx');
      this.link.write(text.trim() + '\r\n').catch(e => { clearTimeout(timer); this._pending = null; reject(e); });
    }));
  }
  /** Console drawer: send a line without waiting; replies show up as fox output. */
  /** Console drawer: send a line without waiting for its reply — but after whatever command is in flight, and once the
   *  fox has been quiet for a moment (a line typed into the middle of the boot banner was lost on a real board). */
  async send(text) {
    return this._run(async () => {
      const t0 = Date.now();
      while (Date.now() - this._lastRx < 150 && Date.now() - t0 < 2000) await new Promise(r => setTimeout(r, 50));
      await this.link.write(text.trim() + '\r\n');   // the drawer already logged the line; logging it here showed it twice
    });
  }

  /** The page's bench actions, in the console's words. Returns the strings the Bench tab shows. */
  async bench(action, args = {}) {
    const need = r => { if (!r.ok) throw new Error(r.error || 'failed'); return r; };
    switch (action) {
      case 'key': { const s = args.seconds || 3; need(await this.command(`key ${s}`, { timeout: s * 1000 + 5000 })); return 'ok'; }
      case 'tone': { const s = args.seconds || 2; need(await this.command(`tone ${args.hz || 800} ${s}`, { timeout: s * 1000 + 5000 })); return 'ok'; }
      case 'id': { need(await this.command('id', { timeout: 120000 })); return 'ok'; }
      case 'batt': { const r = need(await this.command('batt')); const m = r.lines.join(' ').match(/charging=(\w+)/); return m ? (m[1] === 'yes' ? 'charging' : 'charger idle — battery full, or no USB power') : r.lines.join(' '); }
      case 'status': { const r = need(await this.command('status')); return r.lines.join('\n'); }
      case 'freq': { need(await this.command(`freq ${args.mhz}`)); return 'ok'; }
      case 'atten': { need(await this.command(`atten ${args.code}`)); return 'ok'; }
      case 'stop': { need(await this.command('stop')); return 'ok'; }
      case 'reload': { need(await this.command('reload', { timeout: 10000 })); return 'ok'; }
      // the network foxes' bench, in console words (PROTOCOL.md): `key` brings the radio up for s seconds and answers like
      // foxlib's key_for; `scan` what the radio hears; `health` the board's numbers as JSON; the logs are files
      case 'rssi': { const r = need(await this.command('scan', { timeout: 20000 })); return r.lines.join(' | ') || 'nothing heard'; }
      case 'health': { const r = need(await this.command('health', { timeout: 10000 })); return r.lines.join(''); }
      case 'finds': return (await this.readText('finds.csv')) ?? '';
      case 'near': return (await this.readText('near.csv')) ?? '';
    }
    throw new Error(`unknown bench action ${action}`);
  }
  // ---- files over the console (the drive-device surface) ----
  /** `files` → { name: { size, dir: false } }, as the drive device lists. */
  async list() {
    const r = await this.command('files'); if (!r.ok) throw new Error(r.error);
    const out = {}; const m = r.lines.join(' ').matchAll(/(\S+)\s+(\d+)/g);
    for (const [, name, size] of m) out[name] = { size: +size, dir: false };
    return out;
  }
  /** `get <name>`: the bytes, or null when the fox has no such file. */
  async readBytes(path) {
    const r = await this.command(`get ${path}`, { timeout: 15000 });
    if (!r.ok) { if (/no such file/.test(r.error)) return null; throw new Error(r.error); }
    const head = r.lines[0]?.match(/size=(\d+) crc32=([0-9a-f]{8})/);
    if (!head) throw new Error(`get ${path}: no size line (${r.lines[0] || 'nothing'})`);
    const end = r.lines.indexOf('.', 1); if (end < 0) throw new Error(`get ${path}: no end-of-file line`);
    const bytes = unb64(r.lines.slice(1, end).join(''));
    if (bytes.length !== +head[1] || hex8(crc32(bytes)) !== head[2]) throw new Error(`get ${path}: ${bytes.length} bytes, crc ${hex8(crc32(bytes))} — the fox said ${head[1]} / ${head[2]}`);
    return bytes;
  }
  async readText(path) { const b = await this.readBytes(path); return b == null ? null : dec.decode(b); }
  /** `put <name> <size>`, the base64 lines, `.`; the fox's `ok size= crc32=` must match what was sent. */
  async writeBytes(path, bytes) {
    const text = b64(bytes), lines = []; for (let i = 0; i < text.length; i += 76) lines.push(text.slice(i, i + 76));
    const body = lines.join('\r\n') + (lines.length ? '\r\n' : '') + '.\r\n';
    const r = await this._run(() => new Promise((resolve, reject) => {
      const timeout = 20000 + bytes.length * 2;   // ~1 ms per byte over a slow console, with headroom
      const timer = setTimeout(() => { if (this._pending?.resolve === done) { this._pending = null; reject(new Error(`no reply to "put ${path}" within ${timeout / 1000} s`)); } }, timeout);
      const done = x => { clearTimeout(timer); resolve(x); };
      let sentBody = false;
      this._pending = { lines: [], resolve: done, onLine: line => {   // `send` is the fox's go-ahead for the body: one write, then the ok/err as usual
        if (!sentBody && /^send$/.test(line)) { sentBody = true; this.link.write(body).catch(e => { clearTimeout(timer); this._pending = null; reject(e); }); return true; } return false; } };
      this.log(`put ${path} ${bytes.length}`, 'tx');
      this.link.write(`put ${path} ${bytes.length}\r\n`).catch(e => { clearTimeout(timer); this._pending = null; reject(e); });
    }));
    if (!r.ok) throw new Error(`put ${path}: ${r.error}`);
    const m = r.lines.concat(r.okLine || '').join(' ').match(/size=(\d+) crc32=([0-9a-f]{8})/);
    if (!m || +m[1] !== bytes.length || m[2] !== hex8(crc32(bytes))) throw new Error(`put ${path}: the fox kept ${m ? m[1] + ' bytes, crc ' + m[2] : 'something else'} — sent ${bytes.length} / ${hex8(crc32(bytes))}`);
    return bytes.length;
  }
  async writeText(path, text) { return this.writeBytes(path, enc.encode(text)); }
  async remove(path) { const r = await this.command(`rm ${path}`); if (!r.ok && !/no such file/.test(r.error)) throw new Error(r.error); return r.ok; }

  /** Jump to the UF2 bootloader: the port disappears and RPI-RP2 mounts. */
  async bootsel() { const r = await this.command('bootsel', { timeout: 3000 }).catch(() => ({ ok: true })); return r.ok; }
  async interrupt() { try { await this.command('stop'); } catch {} }
  async reboot() { try { await this.command('reboot'); } catch {} return ''; }
  async exec() { throw new Error('this board has no REPL; the console takes commands (help)'); }
  async close() { try { await this.link.close(); } catch {} }
}

/** A Link that answers like the foxlib-c firmware's console: for the demo and the unit tests. */
/** The version the fake claims. Old on purpose (0.1.0 predates `chg` and `correction_ppm`), so the page's compat badge
 *  and feature gating are exercised against the demo; the reply *shapes* follow the current firmware (console_corpus.json). */
const FAKE_VERSION = '0.1.0';
export class FakeConsoleLink extends Link {
  constructor({ uid = 'e66138935f0a1b2c', template = 'morse-songs', callsign = 'N0CALL DECOY DECOY N0CALL', revision = 3, latency = 5, log = true, boardId = 'picofox-foxlibc' } = {}) {
    super(); Object.assign(this, { uid, template, callsign, revision, latency, logging: log, boardId, keyed: false, atten: 0, carrier: 146.565, cfgCarrier: 146.565, charging: false, bootsel: false, sent: [], _t0: Date.now() });
    this._timers = [];
    // the fox's files, as `files` / `get` / `put` / `rm` see them (PROTOCOL.md "Files over the console")
    const seed = enc.encode(JSON.stringify({ schema: 1, template, board: boardId, id: { callmessage: callsign }, fleet: { notes: 'demo' } }, null, 1));
    this.files = new Map([['README.txt', enc.encode('fox-bench firmware: fox.json over defaults.json\n')], ['defaults.json', seed], ['fox.json', seed]]);
    this._put = null;   // a put in progress: { name, size, lines }
  }
  reloads = 0;
  async open() { this._emit(this.banner()); }
  banner() { const set = !this.callsign.includes('N0CALL'); return `initializing system ... \r\nFOX template=${this.template}/${FAKE_VERSION} foxlib=c-${FAKE_VERSION} board=${this.boardId} uid=${this.uid} cfg=ok radio=ok id=${set ? 'set' : 'unset'} freq=${this.carrier}\r\n${set ? '' : '** callsign not set: staying silent (id.tx_without_callsign=false) **\r\n'}`; }
  _emit(text, after = this.latency) { for (const l of text.split(/\r?\n/)) if (l) { this._echoRing.push(l); if (this._echoRing.length > 12) this._echoRing.shift(); } const t = setTimeout(() => this._feed(this.enc.encode(text)), after); this._timers.push(t); }
  _echoRing = [];   // the last lines the fox sent: a received line equal to one is the host echoing it back, and is dropped (core/echo.c)
  async write(data) {
    const text = typeof data === 'string' ? data : dec.decode(data);
    for (const line of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) { this.sent.push(line); this._cmd(line); }
  }
  static FILE_OK = /^(fox\.json|defaults\.json|[A-Za-z0-9_.-]+\.bin)$/;
  _cmd(line) {
    const reply = (t, ms) => this._emit(t + '\r\n', ms ?? this.latency);
    if (!this._put) { const echoed = this._echoRing.indexOf(line); if (echoed >= 0) { this._echoRing.splice(echoed, 1); return; } }   // never inside a put: a body may repeat lines a `get` just sent
    if (this._put) {   // the body of a put: base64 lines until the `.`
      const p = this._put;
      if (line !== '.') { p.lines.push(line); return; }
      this._put = null;
      let bytes; try { bytes = unb64(p.lines.join('')); } catch { reply('err: bad base64'); return; }
      if (bytes.length !== p.size) { reply(`err: got ${bytes.length} bytes, put said ${p.size}`); return; }
      this.files.set(p.name, bytes);
      if (p.name === 'fox.json' || p.name === 'defaults.json') { this._timers.push(setTimeout(() => { this.reloads++; this._emit(`reload: console\r\n${this.banner()}`); }, 1000)); }
      reply(`ok size=${bytes.length} crc32=${hex8(crc32(bytes))}`);
      return;
    }
    const [cmd, ...a] = line.split(/\s+/);
    switch (cmd) {
      case 'put': { const name = a[0] || '', size = parseInt(a[1] || '-1', 10); if (!FakeConsoleLink.FILE_OK.test(name)) { reply('err: refused name'); break; } if (!(size >= 0 && size <= 16384)) { reply('err: put <name> <size 0-16384>'); break; } this._put = { name, size, lines: [] }; reply('send'); break; }
      case 'get': { if (!FakeConsoleLink.FILE_OK.test(a[0] || '')) { reply('err: refused name'); break; } const b = this.files.get(a[0]); if (!b) { reply('err: no such file'); break; } const t = b64(b), ls = []; for (let i = 0; i < t.length; i += 76) ls.push(t.slice(i, i + 76)); reply(`size=${b.length} crc32=${hex8(crc32(b))}\r\n${ls.join('\r\n')}${ls.length ? '\r\n' : ''}.\r\nok`); break; }
      case 'rm': { if (!FakeConsoleLink.FILE_OK.test(a[0] || '')) { reply('err: refused name'); break; } if (!this.files.has(a[0])) { reply('err: no such file'); break; } this.files.delete(a[0]); reply('ok'); break; }
      case 'scan': reply('-52 ch1 neighbour-1 | -80 ch6 neighbour-2\r\nok'); break;
      case 'health': reply(`{"free": 180000, "after_import": 180000, "import_s": 0, "with_fox": 150000, "foxlib": "c-${FAKE_VERSION}", "fatal": null}\r\nok`); break;
      case 'help': reply('fox-bench PicoFox console\r\n  status            banner line, revision, charging, drive, files\r\n  key <s>           unmodulated carrier for s seconds (max 60)\r\n  tone <hz> <s>     carrier with a tone\r\n  id                send the ID once now\r\n  freq <mhz>        retune until the next reload\r\n  atten <0-127>     attenuator code now (rev 3 boards; dB per step not yet metered)\r\n  batt              charging state (no voltage sense on this board)\r\n  files | put <name> <size> | get <name> | rm <name>\r\n  reload | stop | uid | version | reboot | bootsel\r\nok'); break;
      case 'status': reply(`${this.banner().split('\r\n')[1]}\r\nuptime=${Math.floor((Date.now() - this._t0) / 1000)}s reset=power_on version=${FAKE_VERSION}\r\nrevision=${this.revision} si5351=ok carrier=${(this.carrier * 1e6).toFixed(1)} keyed=${this.keyed ? 1 : 0} attenuation=${this.atten} i2c_write_us=78 i2c_errors=0 core1=ok correction_ppm=0.0 state=${this.keyed ? 1 : 0}\r\ncharging=${this.charging ? 'yes' : 'no'} host_drive=no host_writes=0 dirty=0\r\nfiles: board.json 77  README.txt 212  defaults.json 1830  fox.json 1830\r\nok`); break;
      case 'key': { const s = parseFloat(a[0] || '2'); if (!(s > 0 && s <= 60)) { reply('err: 0 < s <= 60'); break; } this.keyed = true; reply(`keyed ${s.toFixed(1)} s`); this._emit('ok\r\n', s * 1000 + this.latency); this._timers.push(setTimeout(() => { this.keyed = false; }, s * 1000)); break; }
      case 'tone': { const hz = parseFloat(a[0] || '0'), s = parseFloat(a[1] || '2'); if (!(hz >= 50 && hz <= 4000 && s > 0 && s <= 60)) { reply('err: tone <50-4000 hz> <s<=60>'); break; } reply(`tone ${hz.toFixed(0)} Hz ${s.toFixed(1)} s`); this._emit('ok\r\n', s * 1000 + this.latency); break; }
      case 'id': reply(`morse: ${this.callsign}`); this._emit('ok\r\n', 300); break;
      case 'batt': reply(`batt charging=${this.charging ? 'yes' : 'no'} volts=none note=${this.charging ? 'charger_active' : 'charger_idle(full_or_no_usb_power)'}\r\nok`); break;
      case 'files': reply([...this.files].map(([n, b]) => `${n} ${b.length}`).join('  ') + '\r\nok'); break;
      case 'freq': { const m = parseFloat(a[0] || '0'); if (!(m >= 144.02 && m <= 147.98)) { reply('err: outside the module ranges'); break; } this.carrier = m; reply(`carrier ${m.toFixed(4)} MHz\r\nok`); break; }
      case 'atten': { const v = parseInt(a[0] || '-1', 10); if (!(v >= 0 && v <= 127)) { reply('err: 0-127'); break; } this.atten = v; reply(`attenuation ${v}\r\nok`); break; }
      case 'stop': this.keyed = false; reply('ok'); break;
      case 'reload': this.carrier = this.cfgCarrier; reply(`reload: console\r\n${this.banner()}ok`); break;   // a console `freq` lasts until the next reload
      case 'uid': reply(`uid=${this.uid}\r\nok`); break;
      case 'version': reply(`foxlib-c ${FAKE_VERSION} board=${this.boardId}\r\nok`); break;
      case 'bootsel': this.bootsel = true; reply('ok (entering UF2 bootloader: the RPI-RP2 drive appears)'); this._timers.push(setTimeout(() => { if (this.onDrop) this.onDrop(new Error('port gone')); }, 50)); return;   // no second ok: the port is gone
      default: reply(`err: unknown command '${cmd}' (help)`);
    }
  }
  async close() { this.closed = true; for (const t of this._timers) clearTimeout(t); }
}

/** The demo console for the foxlib-c family (Listen only without hardware). */
export function demoConsole(board, cfg, { files = false } = {}) {
  const link = new FakeConsoleLink({ template: cfg?.template || 'morse-songs', callsign: cfg?.id?.callmessage || 'N0CALL DECOY DECOY N0CALL', boardId: board?.id || 'picofox-foxlibc' });
  const d = new ConsoleDevice(link); d.kind = 'demo'; d.demo = true; d.console = true;
  if (files) d.transport = 'console';   // a console-configured demo: files over the fake console, nothing else differs
  return { device: d, link };
}
