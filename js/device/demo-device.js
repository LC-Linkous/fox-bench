// demo-device.js — a simulated XIAO ESP32-C3 running CircuitPython, with an
// in-memory filesystem and a boot that behaves like foxlib would: load
// defaults.json, merge fox.json, validate, print the FOX banner. Lets the
// whole page be exercised with nothing plugged in.
// SPDX-License-Identifier: GPL-2.0-only
import { Device } from './device.js';
import { mergeAndValidate } from '../model/schema.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class DemoDevice extends Device {
  /** opts.board: board descriptor; opts.module: module descriptor whose ranges the fake SA868 accepts */
  constructor(opts = {}) {
    super(); this.kind = 'demo';
    this.board = opts.board; this.moduleRanges = opts.moduleRanges || [[134, 174]];
    this.fs = new Map();           // path -> Uint8Array
    this.dirs = new Set();
    this.enc = new TextEncoder(); this.dec = new TextDecoder();
    this.uid = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    this.battV = 3.92;
  }
  async connect() {
    await sleep(250); this.log('demo board: CircuitPython 10.x on XIAO ESP32-C3 (simulated)', 'dim');
    const v = this.fs.get('foxlib/VERSION');
    return { boardId: this.board?.id || 'seeed_xiao_esp32c3', uid: this.uid, foxlibVersion: v ? this.dec.decode(v).trim() : '', cpVersion: '10.0.0-demo', files: await this.list('') };
  }
  async list(path = '') {
    const out = {}; const pre = path ? path + '/' : '';
    for (const [p, b] of this.fs) if (p.startsWith(pre)) { const rest = p.slice(pre.length); if (!rest.includes('/')) out[rest] = { size: b.length, dir: false }; }
    for (const d of this.dirs) if (d.startsWith(pre)) { const rest = d.slice(pre.length); if (rest && !rest.includes('/')) out[rest] = { size: 0, dir: true }; }
    return out;
  }
  async readBytes(p) { await sleep(40); return this.fs.has(p) ? this.fs.get(p) : null; }
  async readText(p) { const b = await this.readBytes(p); return b == null ? null : this.dec.decode(b); }
  async writeBytes(p, bytes) { await sleep(30 + bytes.length / 40); this.fs.set(p, new Uint8Array(bytes)); this.log(`wrote ${p} (${bytes.length} B)`, 'ok'); }
  async writeText(p, t) { return this.writeBytes(p, this.enc.encode(t)); }
  async mkdir(p) { this.dirs.add(p); }
  async remove(p) { this.fs.delete(p); }
  async exec(code) { this.log(code.split('\n')[0] + ' …', 'tx'); await sleep(60); return ''; }

  /** What foxlib.cfg would do at boot. */
  _boot() {
    const lines = ['soft reboot', '', 'Auto-reload is off.', 'code.py output:'];
    if (!this.fs.has('code.py')) { lines.push('Code done running.', '', 'Press any key to enter the REPL.'); return lines.join('\n'); }
    if (!this.fs.has('foxlib/__init__.py')) { lines.push('Traceback (most recent call last):', '  File "code.py", line 8, in <module>', "ImportError: no module named 'foxlib'", '', 'Code done running.'); return lines.join('\n'); }
    let defaults = null, user = null, cfgStatus;
    try { defaults = JSON.parse(this.dec.decode(this.fs.get('defaults.json'))); } catch { cfgStatus = 'fatal(defaults.json)'; }
    if (defaults) {
      const raw = this.fs.get('fox.json');
      if (!raw) cfgStatus = 'default(missing)';
      else { try { user = JSON.parse(this.dec.decode(raw)); } catch { cfgStatus = 'default(parse)'; } }
    }
    let cfg = defaults, report = [];
    if (defaults && user) { const r = mergeAndValidate(user, defaults, this.board); cfg = r.cfg; report = r.report; cfgStatus = r.fatal ? `fatal(${r.fatal})` : report.length ? `partial(${report.map(x => x.key).join(',')})` : 'ok'; }
    const template = cfg?.template || '?';
    const codeHead = this.dec.decode(this.fs.get('code.py')).match(/template: ([\w-]+)/)?.[1];
    if (codeHead && cfg && codeHead !== template) cfgStatus = 'default(template)';
    lines.push('initializing system ... ');
    const freqs = (cfg?.plan?.frequencies_mhz || []).filter(f => this.moduleRanges.some(([lo, hi]) => f >= lo && f <= hi));
    const radio = cfgStatus?.startsWith('fatal') ? 'skipped' : freqs.length ? 'ok' : 'err(DMOSETGROUP:1)';
    const idSet = cfg && !cfg.id.callmessage.includes(cfg.id.placeholder);
    const fl = this.dec.decode(this.fs.get('foxlib/VERSION') || this.enc.encode('?')).trim();
    lines.push(`FOX template=${template}/${this._tmplVersion()} foxlib=${fl} board=${this.board?.id || 'seeed_xiao_esp32c3'} uid=${this.uid} cfg=${cfgStatus} radio=${radio} id=${idSet ? 'set' : 'unset'} freq=${freqs.join(',') || 'none'}`);
    if (!idSet) lines.push('** callsign not set: staying silent (id.tx_without_callsign=false) **');
    if (cfg?.pins?.batt_sense) lines.push(`battery: ${this.battV.toFixed(2)} V`);
    this.lastCfg = cfg; this.lastRadio = radio;
    return lines.join('\n');
  }
  _tmplVersion() { return this.dec.decode(this.fs.get('code.py') || new Uint8Array()).match(/version="?([\d.]+)/)?.[1] || '1.0.0'; }

  async reboot() { this.log('soft reboot (Ctrl-D) — capturing boot log', 'dim'); await sleep(600); const t = this._boot(); this.log(t, 'reply'); return t; }

  async bench(action, args = {}) {
    await sleep(300);
    switch (action) {
      case 'probe': return JSON.stringify(Object.fromEntries((args.freqs || [146.5, 433.5]).map(f => [f, this.moduleRanges.some(([lo, hi]) => f >= lo && f <= hi)])));
      case 'key': this.log(`demo: keyed ${args.seconds}s into the dummy load`, 'dim'); await sleep((args.seconds || 3) * 1000); return 'ok';
      case 'rssi': return String(Math.round(60 + Math.random() * 20));
      case 'batt': this.battV = Math.max(3.2, this.battV - 0.005); return this.battV.toFixed(3);
    }
    throw new Error('unknown bench action');
  }
  async close() {}
}
