// console-device.js — Device over the foxlib-c firmware's serial console (PicoFox with fox-bench
// firmware). Line protocol, PROTOCOL.md "foxlib-c console": the fox prints its banner and log
// freely; a command is one line and is answered by `ok` or `err: …` once it has *finished*
// (a `key 2` answers `keyed 2.0 s` at once and `ok` two seconds later).
// SPDX-License-Identifier: GPL-2.0-only
//
// Files are not reachable this way (that is the FOXBENCH drive, drive-device.js); this device
// is what Listen only opens for the family: banner, log, bench actions, bootsel.
import { Device } from './device.js';
import { Link } from './link.js';

const dec = new TextDecoder();

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
    if (/^ok(\s|$)/.test(line)) { p.resolve({ ok: true, lines: p.lines }); this._pending = null; }
    else if (line.startsWith('err:')) { p.resolve({ ok: false, error: line.slice(4).trim(), lines: p.lines }); this._pending = null; }
    else p.lines.push(line);
  }

  /** Listen only: the port is open, the banner arrives by itself. */
  async listen() { return { boardId: '?', uid: '', foxlibVersion: '', cpVersion: '', files: {}, listening: true }; }
  async connect() { return this.listen(); }

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
    }
    throw new Error(`unknown bench action ${action}`);
  }
  /** Jump to the UF2 bootloader: the port disappears and RPI-RP2 mounts. */
  async bootsel() { const r = await this.command('bootsel', { timeout: 3000 }).catch(() => ({ ok: true })); return r.ok; }
  async interrupt() { try { await this.command('stop'); } catch {} }
  async reboot() { try { await this.command('reboot'); } catch {} return ''; }
  async exec() { throw new Error('this board has no REPL; the console takes commands (help)'); }
  async close() { try { await this.link.close(); } catch {} }
}

/** A Link that answers like the foxlib-c firmware's console: for the demo and the unit tests. */
export class FakeConsoleLink extends Link {
  constructor({ uid = 'e66138935f0a1b2c', template = 'morse-songs', callsign = 'N0CALL DECOY DECOY N0CALL', revision = 3, latency = 5, log = true } = {}) {
    super(); Object.assign(this, { uid, template, callsign, revision, latency, logging: log, keyed: false, atten: 0, carrier: 146.565, charging: false, bootsel: false, sent: [] });
    this._timers = [];
  }
  async open() { this._emit(this.banner()); }
  banner() { const set = !this.callsign.includes('N0CALL'); return `initializing system ... \r\nFOX template=${this.template}/0.1.0 foxlib=c-0.1.0 board=picofox-foxlibc uid=${this.uid} cfg=ok radio=ok id=${set ? 'set' : 'unset'} freq=${this.carrier}\r\n${set ? '' : '** callsign not set: staying silent (id.tx_without_callsign=false) **\r\n'}`; }
  _emit(text, after = this.latency) { const t = setTimeout(() => this._feed(this.enc.encode(text)), after); this._timers.push(t); }
  async write(data) {
    const text = typeof data === 'string' ? data : dec.decode(data);
    for (const line of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) { this.sent.push(line); this._cmd(line); }
  }
  _cmd(line) {
    const [cmd, ...a] = line.split(/\s+/);
    const reply = (t, ms) => this._emit(t + '\r\n', ms ?? this.latency);
    switch (cmd) {
      case 'help': reply('fox-bench PicoFox console\r\n  status   key <s>   tone <hz> <s>   id   batt   files   reload   stop   bootsel\r\nok'); break;
      case 'status': reply(`${this.banner().split('\r\n')[1]}\r\nrevision=${this.revision} si5351=ok carrier=${(this.carrier * 1e6).toFixed(1)} keyed=${this.keyed ? 1 : 0} attenuation=${this.atten} i2c_write_us=78 state=0\r\ncharging=${this.charging ? 'yes' : 'no'} host_drive=no host_writes=0 dirty=0\r\nfiles: README.txt 212  defaults.json 1830  fox.json 1830\r\nok`); break;
      case 'key': { const s = parseFloat(a[0] || '2'); if (!(s > 0 && s <= 60)) { reply('err: 0 < s <= 60'); break; } this.keyed = true; reply(`keyed ${s.toFixed(1)} s`); this._emit('ok\r\n', s * 1000 + this.latency); this._timers.push(setTimeout(() => { this.keyed = false; }, s * 1000)); break; }
      case 'tone': { const hz = parseFloat(a[0] || '0'), s = parseFloat(a[1] || '2'); if (!(hz >= 50 && hz <= 4000 && s > 0 && s <= 60)) { reply('err: tone <50-4000 hz> <s<=60>'); break; } reply(`tone ${hz.toFixed(0)} Hz ${s.toFixed(1)} s`); this._emit('ok\r\n', s * 1000 + this.latency); break; }
      case 'id': reply(`morse: ${this.callsign}`); this._emit('ok\r\n', 300); break;
      case 'batt': reply(`batt charging=${this.charging ? 'yes' : 'no'} volts=none\r\nok`); break;
      case 'files': reply('README.txt 212  defaults.json 1830  fox.json 1830\r\nok'); break;
      case 'freq': { const m = parseFloat(a[0] || '0'); if (!(m >= 144.02 && m <= 147.98)) { reply('err: outside the module ranges'); break; } this.carrier = m; reply(`carrier ${m.toFixed(4)} MHz\r\nok`); break; }
      case 'atten': { const v = parseInt(a[0] || '-1', 10); if (!(v >= 0 && v <= 127)) { reply('err: 0-127'); break; } this.atten = v; reply(`attenuation ${v}\r\nok`); break; }
      case 'stop': this.keyed = false; reply('ok'); break;
      case 'reload': reply(`reload: console\r\n${this.banner()}ok`); break;
      case 'uid': reply(`uid=${this.uid}\r\nok`); break;
      case 'version': reply('foxlib-c 0.1.0 board=picofox-foxlibc\r\nok'); break;
      case 'bootsel': this.bootsel = true; reply('ok (entering UF2 bootloader: the RPI-RP2 drive appears)'); this._timers.push(setTimeout(() => { if (this.onDrop) this.onDrop(new Error('port gone')); }, 50)); break;
      default: reply(`err: unknown command '${cmd}' (help)`);
    }
  }
  async close() { this.closed = true; for (const t of this._timers) clearTimeout(t); }
}

/** The demo console for the foxlib-c family (Listen only without hardware). */
export function demoConsole(board, cfg) {
  const link = new FakeConsoleLink({ template: cfg?.template || 'morse-songs', callsign: cfg?.id?.callmessage || 'N0CALL DECOY DECOY N0CALL' });
  const d = new ConsoleDevice(link); d.kind = 'demo'; d.demo = true; d.console = true;
  return { device: d, link };
}
