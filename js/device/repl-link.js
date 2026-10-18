// repl-link.js — the CircuitPython raw-REPL protocol over a Link.
// SPDX-License-Identifier: GPL-2.0-only
//
// This is what Thonny and mpremote do, made explicit (PROTOCOL.md):
//   interrupt   \r\x03\x03          stop code.py; foxlib releases PTT in a finally
//   enter raw   \r\x01              expect "raw REPL; CTRL-B to exit\r\n>"
//   exec        <code>\x04          expect "OK" <stdout> \x04 <stderr> \x04 ">"
//   exit raw    \r\x02              friendly REPL
//   reboot      \x04 at friendly    runs code.py; we capture the boot log
//
// Code is sent in small chunks with a pause: CircuitPython's input buffer
// is a few hundred bytes without raw-paste mode, and USB-CDC on the C3
// has no flow control.

const CHUNK = 128;
/** CircuitPython's REPL emits terminal escapes: ESC[2K ESC[0G (clear line), ESC]0;title BEL/ESC\\ (title bar). */
export const stripAnsi = t => t.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ReplLink {
  constructor(link, log) {
    this.link = link; this.log = log || (() => {});
    this.dec = new TextDecoder();
    this.buf = '';
    this.waiters = [];
    this.inRaw = false;
    this.onUnsolicited = null;          // text arriving when nobody is waiting (boot output)
    link.onData = bytes => this._onData(bytes);
  }

  _onData(bytes) {
    this.buf += this.dec.decode(bytes, { stream: true });
    if (this.waiters.length) this.waiters[0].check();
    else if (this.onUnsolicited) { const t = stripAnsi(this.buf); this.buf = ''; if (t.replace(/[\s>]/g, '')) this.onUnsolicited(t); }
  }

  /** Resolve when `buf` contains `marker`; returns text before it and removes through it. */
  _waitFor(marker, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const w = { check: () => {
        const i = this.buf.indexOf(marker);
        if (i < 0) return;
        const before = this.buf.slice(0, i); this.buf = this.buf.slice(i + marker.length);
        clearTimeout(t); this.waiters.shift(); resolve(before);
        if (this.waiters.length) this.waiters[0].check();
      } };
      const t = setTimeout(() => { const k = this.waiters.indexOf(w); if (k >= 0) this.waiters.splice(k, 1); reject(new Error(`timeout waiting for ${JSON.stringify(marker)}; got ${JSON.stringify(this.buf.slice(-120))}`)); }, timeout);
      this.waiters.push(w); w.check();
    });
  }

  async _send(s) { await this.link.write(s); }

  /** Stop whatever is running and get a prompt. Tolerates a board mid-boot or already at a prompt. */
  async interrupt() {
    this.buf = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      await this._send('\r\x03\x03');
      try { await this._waitFor('>>> ', 2500); this.inRaw = false; this.log('interrupted → friendly REPL'); return; } catch {}
      // maybe at "Press any key to enter the REPL", mid-boot, or already in raw mode
      await this._send('\r');
      try { await this._waitFor('>>> ', 2000); this.inRaw = false; return; } catch {}
      try { await this._send('\r\x02'); await this._waitFor('>>> ', 2000); this.inRaw = false; return; } catch {}
      await sleep(500);
    }
    throw new Error('no REPL prompt — is this a CircuitPython board? (Try: unplug, replug without holding B, then Connect.)');
  }

  async enterRaw() {
    if (this.inRaw) return;
    this.buf = '';
    await this._send('\r\x01');
    await this._waitFor('raw REPL; CTRL-B to exit\r\n>', 3000);
    this.inRaw = true;
  }
  async exitRaw() {
    if (!this.inRaw) return;
    await this._send('\r\x02');
    try { await this._waitFor('>>> ', 2000); } catch {}
    this.inRaw = false;
  }

  /** Run Python in raw mode; returns { out, err }. Throws on a Python exception unless {soft}. */
  async exec(code, { timeout = 10000, soft = false } = {}) {
    await this.enterRaw();
    this.buf = '';
    for (let i = 0; i < code.length; i += CHUNK) { await this._send(code.slice(i, i + CHUNK)); await sleep(8); }
    await this._send('\x04');
    await this._waitFor('OK', 3000);
    const out = await this._waitFor('\x04', timeout);
    const err = await this._waitFor('\x04', 3000);
    try { await this._waitFor('>', 2000); } catch { /* both \x04 seen: the exec completed; the prompt may arrive with the next read */ }
    if (err && !soft) throw new Error(err.trim().split('\n').pop() || err);
    return { out, err };
  }

  /** Soft reboot and collect the boot log until the FOX banner or timeout. */
  async rebootAndCapture({ timeout = 15000, until = /^FOX /m } = {}) {
    await this.exitRaw();
    this.buf = '';
    await this._send('\x04');
    const start = performance.now();
    let text = '';
    while (performance.now() - start < timeout) {
      await sleep(100);
      if (this.buf.length) { text += this.buf; this.buf = ''; }
      if (until.test(text)) { await sleep(300); text += this.buf; this.buf = ''; break; }
      if (/Traceback|Error:/.test(text) && /Press any key|Code done running/.test(text)) break;
    }
    return stripAnsi(text);
  }
}
