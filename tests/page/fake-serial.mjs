// fake-serial.mjs — a Web Serial port the page can open, backed by the fakes the unit tests already use.
// SPDX-License-Identifier: GPL-2.0-only
//
// Loaded into the page by the smoke test (served from the repo root, so the imports below resolve). It replaces
// navigator.serial.requestPort so that Connect, Listen only, the 1200-baud touch and a REPL deploy run through
// js/device/serial-link.js and the page's connect logic — the code that only a board exercised before — with the
// bytes coming from FakeBoard (a CircuitPython REPL) or FakeConsoleLink (the foxlib-c console).
//
//   window.__fakeSerial.install('board', { running: true, ... })   // FakeBoard options (tests/unit/fake-board.mjs)
//   window.__fakeSerial.install('console', { uid, template, ... })   // FakeConsoleLink options
//   window.__fakeSerial.install('dumb', { vid, pid })                // a port that answers nothing (another device)
//   window.__fakeSerial.port.drop()                                  // unplug: the read stream errors → onDrop
//   window.__fakeSerial.port.signals / .opens / .connected            // what the page did to it
import { FakeBoard } from '../unit/fake-board.mjs';
import { FakeConsoleLink } from '../../js/device/console-device.js';
import { Link } from '../../js/device/link.js';

class DumbLink extends Link { async open() {} async write() {} }

class FakePort {
  constructor(link, { vid = 0x303a, pid = 0x1001, disappearOnTouch = true } = {}) {
    this.link = link; this.vid = vid; this.pid = pid; this.disappearOnTouch = disappearOnTouch;
    this.connected = true; this.opens = 0; this.signals = []; this.baud = null; this._ctl = null; this.closedByPage = false;
  }
  getInfo() { return { usbVendorId: this.vid, usbProductId: this.pid }; }
  async open({ baudRate }) {
    this.opens++; this.baud = baudRate; this.closedByPage = false;
    this.readable = new ReadableStream({ start: c => { this._ctl = c; this.link.onData = b => { try { c.enqueue(b); } catch {} }; }, cancel: () => {} });
    this.writable = new WritableStream({ write: b => this.link.write(b) });
    await this.link.open();
  }
  async setSignals(s) {
    this.signals.push({ baud: this.baud, ...s });
    // the Arduino 1200-baud touch: DTR dropped at 1200 baud → the board reboots into its bootloader and leaves the bus
    if (this.baud === 1200 && s.dataTerminalReady === false && this.disappearOnTouch) setTimeout(() => { this.connected = false; }, 50);
  }
  async close() { this.closedByPage = true; try { this._ctl?.close(); } catch {} }
  /** Unplug while open: the page's read loop rejects, SerialLink calls onDrop. */
  drop() { this.connected = false; try { this._ctl?.error(new DOMException('The device has been lost.', 'NetworkError')); } catch {} }
}

const api = {
  port: null, link: null,
  install(kind, opts = {}) {
    const { vid, pid, disappearOnTouch, ...linkOpts } = opts;
    const link = kind === 'board' ? new FakeBoard(linkOpts) : kind === 'console' ? new FakeConsoleLink(linkOpts) : new DumbLink();
    api.link = link; api.port = new FakePort(link, { vid, pid, disappearOnTouch });
    if (!navigator.serial) Object.defineProperty(navigator, 'serial', { value: {}, configurable: true });
    navigator.serial.requestPort = async () => api.port;
    navigator.serial.getPorts = async () => [api.port];
    return api.port;
  },
  /** FakeBoard's filesystem as { name: text } for assertions. */
  files() { const out = {}; if (api.link?.fs) for (const [k, v] of api.link.fs) out[k] = new TextDecoder().decode(v); return out; },
};
window.__fakeSerial = api;
