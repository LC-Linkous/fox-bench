// main.js — app state and wiring. Tabs live in js/ui/*.js and render from app.cfg.
// SPDX-License-Identifier: GPL-2.0-only
import { $, $$ } from './ui/dom.js';
import { loadCatalog, loadDefaults } from './model/loaders.js';
import { mergeAndValidate, pageChecks } from './model/schema.js';
import { parseBanner } from './device/device.js';
import { profiles } from './model/profiles.js';
import { TABLE as MORSE } from './audio/morse.js';
import { hasWebSerial, SerialLink } from './device/serial-link.js';
import { ReplDevice } from './device/repl-device.js';
import { DemoDevice } from './device/demo-device.js';
import { DriveDevice, demoDrive, demoFoxbenchDrive } from './device/drive-device.js';
import { ConsoleDevice, demoConsole } from './device/console-device.js';
import { MemDirectoryHandle } from './device/memfs.js';
import { initConsole } from './ui/console.js';
import * as tabBoard from './ui/board.js';
import * as tabRadio from './ui/radio.js';
import * as tabBehavior from './ui/behavior.js';
import * as tabPlan from './ui/plan.js';
import * as tabId from './ui/id.js';
import * as tabPayload from './ui/payload.js';
import * as tabSchedule from './ui/schedule.js';
import * as tabDeploy from './ui/deploy.js';
import * as tabBench from './ui/bench.js';
import * as tabFleet from './ui/fleet.js';
import * as tabAbout from './ui/about.js';

const VERSION = '0.6.0';
/** Tab subtitles that read differently per device family (null = the page's original text). */
const LEDES = { drive: {
  board: 'Which fox is on the bench, open its USB drive (or use the simulated one). The vendor firmware stays; the page writes its files.',
  radio: 'Zone, attenuation and FM deviation for the SI5351 exciter the firmware drives. Nothing to wire.',
  behavior: 'The vendor firmware has one behaviour; this is where a board with several would choose.',
  plan: 'One frequency, checked against the limits the firmware itself enforces.',
  payload: 'What goes into audio.wav. Preview plays the same events the file will carry.',
  schedule: 'The firmware\'s duty cycle, drawn with the carrier offsets and power steps it adds by itself.',
  deploy: 'Render the four files, write them to the drive and read them back; then eject and power-cycle.',
}, 'foxlib-c': {
  board: 'Which fox is on the bench, open its FOXBENCH drive (or use the simulated one), or flash the fox-bench firmware onto it. Listen only shows its banner and log.',
  radio: 'Band, power and FM deviation for the SI5351 exciter the fox-bench firmware drives. Nothing to wire.',
  deploy: 'Write fox.json and defaults.json to the FOXBENCH drive; the fox reloads them by itself a second later and prints its banner on the serial port.',
  bench: 'Bench actions for this firmware go over its serial console (Listen only, then type key 2, tone 800 2, id, batt, status).',
} };
const TABS = { board: tabBoard, radio: tabRadio, behavior: tabBehavior, plan: tabPlan, id: tabId, payload: tabPayload, schedule: tabSchedule, deploy: tabDeploy, bench: tabBench, fleet: tabFleet, about: tabAbout };
const TAB_KEYS = { radio: ['radio', 'module', 'pins'], plan: ['plan'], id: ['id'], payload: ['payload'], schedule: ['schedule'] };

export const app = {
  version: VERSION,
  catalog: null,
  device: null, info: null,            // connected device and what connect() returned
  onBoard: { cfg: null, raw: null, foxlibVersion: '', foxlibMissing: [], foxlibComplete: false, files: {} },   // what was read from the board
  boardId: 'seeed_xiao_esp32c3', templateId: 'morse-songs', moduleId: 'sa868_vhf', region: 'US',
  defaults: null, cfg: null,           // template defaults for the board; the working config
  images: [],                           // sstv payload images
  issues: [], report: [], status: 'ok',
  console: null,
  listeners: new Set(),
  get board() { return this.catalog.boards[this.boardId]; },
  get template() { return this.catalog.templates[this.templateId]; },
  get module() { return this.catalog.modules[this.moduleId]; },
  get connected() { return !!this.device; },
  /** Device family of the selected board: 'foxlib' (CircuitPython + our firmware, REPL), 'drive' (vendor firmware, files on a USB
   *  drive) or 'foxlib-c' (fox-bench's native firmware: fox.json on its FOXBENCH drive, banner and bench on its serial console). */
  get family() { return this.board.family || 'foxlib'; },
  /** Families configured through files on a USB drive rather than a REPL. */
  get usesDrive() { return this.family === 'drive' || this.family === 'foxlib-c'; },
  /** The foxlib-c console to send bench commands to: the Listen-only device, or the demo's side console. */
  consoleDevice() { if (this.family !== 'foxlib-c') return null; if (this.device?.kind === 'console') return this.device; return this.sideConsole || null; },
  get vendor() { return this.board.vendor ? this.catalog.vendors[this.board.vendor] : null; },
  /** Templates that apply to a family. */
  templatesFor(family) { return Object.values(this.catalog.templates).filter(t => (t.families || ['foxlib']).includes(family)); },

  /** Re-validate and notify every tab. */
  changed(source) {
    if (!this.cfg) return;
    // re-entrancy guard: a render that removes a focused input can fire a second change event mid-render
    if (this._notifying) { this._pending = source; return; }
    this._notifying = true;
    try { this._changed(source); } finally { this._notifying = false; }
    if (this._pending) { const p = this._pending; this._pending = null; this.changed(p); }
  },
  _changed(source) {
    if (this.family === 'drive') {
      const r = this.vendor.validate(this.cfg, this.defaults, this.board);
      this.report = r.report; this.status = r.status; this.issues = r.issues; this.validCfg = r.cfg;
    } else {
      const r = mergeAndValidate(this.cfg, this.defaults, this.board);
      this.report = r.report; this.status = r.status;
      this.issues = pageChecks(r.cfg, { bands: this.catalog.bands, region: this.region, morseTable: MORSE, templateManifest: this.template, module: this.module, pinless: this.family === 'foxlib-c' });
      this.validCfg = r.cfg;
    }
    if (document.body.dataset.family !== this.family) {
      document.body.dataset.family = this.family;
      for (const [tab, text] of Object.entries(LEDES[this.family] || {})) { const el = $(`#tab-${tab} .lede`); if (el) { el.dataset.orig ??= el.textContent; el.textContent = text === null ? el.dataset.orig : text; } }
      for (const el of $$('.panel .lede')) if (!(LEDES[this.family] || {})[el.closest('.panel').id.slice(4)] && el.dataset.orig) el.textContent = el.dataset.orig;
    }
    $('.rail button[data-tab="bench"]').hidden = this.family === 'drive';
    if (!this.device) { $('#connectBtn').textContent = this.usesDrive ? `Open ${this.board.drive?.label || 'drive'}` : 'Connect'; $('#connectBtn').disabled = this.usesDrive ? !('showDirectoryPicker' in window) : !hasWebSerial(); }
    try { localStorage.setItem('fox-bench.working', JSON.stringify({ cfg: this.cfg, boardId: this.boardId, templateId: this.templateId, moduleId: this.moduleId, region: this.region })); } catch {}
    for (const [tab, keys] of Object.entries(TAB_KEYS)) {
      const bad = [...this.report.map(x => ({ level: 'err', key: x.key })), ...this.issues].filter(i => keys.some(k => i.key === k || i.key.startsWith(k + '.')));
      setFlag(tab, bad.some(i => i.level === 'err') ? 'err' : bad.some(i => i.level === 'warn') ? 'warn' : '');
    }
    setFlag('deploy', this.report.length || this.issues.some(i => i.level === 'err' && i.blocking !== false) ? 'err' : this.issues.some(i => i.level === 'err') ? 'warn' : this.connected ? 'ok' : '');
    for (const fn of this.listeners) fn(source);
    $('#tmplBadge').textContent = `${this.template.name}${this.template.status === 'experimental' ? ' · experimental' : ''}`;
    $('#tmplBadge').className = 'badge ' + (this.template.status === 'experimental' ? 'warn' : 'info'); $('#tmplBadge').hidden = false;
  },

  /** Switch template: new defaults, carry over the sections that still apply. */
  async setTemplate(id, { carry = true } = {}) {
    const prev = this.cfg;
    this.templateId = id;
    this.defaults = await loadDefaults(id, this.boardId);
    const next = structuredClone(this.defaults);
    if (carry && prev) {
      for (const k of ['module', 'pins', 'radio', 'plan', 'id', 'battery', 'limits', 'fleet']) next[k] = structuredClone(prev[k]);
      const sec = this.template.sections;
      if (sec.includes(`payload.${prev.payload.kind}`) || sec.includes('payload.*')) next.payload = structuredClone(prev.payload);
      if (sec.includes(`schedule.${prev.schedule.kind}`) || sec.includes('schedule.*')) next.schedule = structuredClone(prev.schedule);
    }
    this.cfg = next;
    this.changed('template');
  },
  async setBoard(id) {
    if (this.catalog.boards[id]?.status === 'planned') { this.console.err(`${this.catalog.boards[id].name} is not available yet`); this.changed('board'); return; }
    const prevFamily = this.family, prev = this.cfg;
    this.boardId = id;
    if (this.board.module_fixed) this.moduleId = this.board.module_fixed;
    if (!this.templatesFor(this.family).some(t => t.id === this.templateId)) {
      // the current template has no meaning for this board: switch to the first one that does, keeping the callsign and fleet notes
      this.templateId = this.templatesFor(this.family)[0].id;
      this.defaults = await loadDefaults(this.templateId, id);
      this.cfg = structuredClone(this.defaults);
      if (prev) { this.cfg.id.callmessage = prev.id.callmessage; this.cfg.fleet = structuredClone(prev.fleet); if (this.family === prevFamily) this.cfg.plan = structuredClone(prev.plan); }
      this.console.dim(`board ${this.board.name}: template switched to ${this.template.name}`);
      this.changed('board'); return;
    }
    this.defaults = await loadDefaults(this.templateId, id);
    this.cfg.board = id; this.cfg.pins = structuredClone(this.defaults.pins);
    if (this.board.module_fixed) { this.cfg.module = this.moduleId; this.cfg.radio = { ...this.cfg.radio, ...structuredClone(this.defaults.radio) }; }
    this.changed('board');
  },
  setModule(id) {
    this.moduleId = id; this.cfg.module = id; this.cfg.radio.ranges_mhz = structuredClone(this.module.ranges_mhz); this.cfg.radio.family = this.module.family; this.changed('module');
  },
  /** Load a complete config (from the board or a profile) into the working copy. */
  async loadCfg(cfg, { source = 'load' } = {}) {
    if (cfg.template && this.catalog.templates[cfg.template]) this.templateId = cfg.template;
    if (cfg.board && this.catalog.boards[cfg.board]) this.boardId = cfg.board;
    if (cfg.module && this.catalog.modules[cfg.module]) this.moduleId = cfg.module;
    this.defaults = await loadDefaults(this.templateId, this.boardId);
    this.cfg = this.family === 'drive' ? this.vendor.validate(cfg, this.defaults, this.board).cfg : mergeAndValidate(cfg, this.defaults, this.board).cfg;
    this.changed(source);
  },

  /** Save the whole form (and SSTV images) under a name; the name is kept in cfg.fleet.profile. */
  saveProfile(name) {
    name = (name || '').trim(); if (!name) return null;
    this.cfg.fleet = { ...this.cfg.fleet, profile: name };
    const rec = profiles.save({ name, template: this.templateId, board: this.boardId, module: this.moduleId, cfg: structuredClone(this.cfg), images: this.images.map(im => ({ ...im, pixels: Array.from(im.pixels) })) });
    this.console.line(`profile "${name}" saved`, 'ok');
    this.changed('profile');
    return rec;
  },
  setStatus(text, cls) { $('#status').className = 'status ' + (cls || ''); $('#statusText').textContent = text; },

  async connect(kind, { listen = false } = {}) {
    if (this.device) await this.disconnect();
    let device;
    if (this.usesDrive && !listen) {
      if (kind === 'demo') device = this.family === 'drive' ? await demoDrive(this.board, { MemDirectoryHandle }) : await demoFoxbenchDrive(this.board, this.defaults, { MemDirectoryHandle });
      else { let handle; try { handle = await DriveDevice.pick({ id: 'fox-bench-' + this.boardId }); } catch (e) { if (e.name !== 'AbortError') this.console.err(String(e.message || e)); return; } device = new DriveDevice(handle, { board: this.board }); }
    }
    else if (kind === 'demo') device = new DemoDevice({ board: this.board, moduleRanges: this.module.ranges_mhz });
    else {
      const link = new SerialLink(); await link.open();
      link.onDrop = () => { this.console.err(this.family === 'foxlib-c' ? 'serial port dropped (bootsel or a reboot re-enumerates the USB port — reconnect when it is back)' : 'serial port dropped (a reset re-enumerates the USB port — reconnect)'); this.disconnect(); };
      device = this.family === 'foxlib-c' ? new ConsoleDevice(link) : new ReplDevice(link);   // the foxlib-c family has a text console, not a REPL
    }
    device.onLog = (t, cls) => cls === 'tx' ? this.console.tx(t) : cls === 'reply' ? this.console.reply(t) : cls === 'ok' ? this.console.line(t, 'ok') : cls === 'err' ? this.console.err(t) : this.console.dim(t);
    this.setStatus(kind === 'demo' ? 'Starting simulated board…' : listen ? 'Opening port…' : 'Connecting…');
    if (listen && kind !== 'demo') {
      this.device = device; this.info = await device.listen(); this.onBoard = { cfg: null, raw: null, foxlibVersion: '', foxlibMissing: [], foxlibComplete: false, files: {}, template: null, listening: true };
      // banner lines that scroll past while listening update the status
      const prev = device.onLog; device.onLog = (t, cls) => { prev(t, cls); const b = parseBanner(t); if (b) { this.lastBanner = b; this.info = { ...this.info, boardId: b.board || '?', uid: b.uid || '' }; this.onBoard.foxlibVersion = b.foxlib || ''; this.onBoard.template = (b.template || '').split('/')[0] || null; this.setStatus(`Listening · ${b.board} · uid ${(b.uid || '').slice(-6)} · ${b.template} · cfg=${b.cfg} radio=${b.radio}`, 'tx'); this.changed('banner'); }
        else if (this.family === 'drive' && this.vendor?.BOOT_OK?.test(t)) { this.setStatus(`Listening · ${this.board.name} · firmware up, transmitting`, 'tx'); this.changed('banner'); }
        else if (this.family === 'drive' && this.vendor?.BOOT_REGEN?.test(t)) { this.console.line('the firmware is regenerating its own ID audio: the marker file did not match settings.txt (expected after a hand edit; not after a page deploy)', 'err'); } };
      $('#connectBtn').textContent = 'Disconnect'; $('#listenBtn').hidden = true; this.console.setEnabled(this.family === 'foxlib-c');   // the foxlib-c console takes text commands
      this.setStatus(this.family === 'drive' ? `Listening on the ${this.board.name} serial port — switch it off and on to see its boot messages` : this.family === 'foxlib-c' ? `Listening on the ${this.board.name} console — its banner appears now; type help in the console` : 'Listening — fox output streams to the console; tap R on the board to see its boot banner', 'tx');
      this.changed('connect'); return;
    }
    try { this.info = await device.connect(); }
    catch (e) {
      this.console.err(String(e.message || e));
      if (kind !== 'demo' && !this.usesDrive) this.console.err('No REPL prompt. If the board is running other firmware, tap its R (reset) button — or unplug and replug without holding B — then click Connect again. The board must already run CircuitPython.');
      this.setStatus('Not connected', 'err'); try { await device.close(); } catch {} return;
    }
    this.device = device;
    this.sideConsole = null;
    if (kind === 'demo' && this.family === 'foxlib-c') { const { device: c, link } = demoConsole(this.board, this.cfg); c.onLog = (t, cls) => { device.onLog(t, cls); const b = parseBanner(t); if (b) this.lastBanner = b; }; this.sideConsole = c; link.open(); }
    $('#demoBtn').setAttribute('aria-pressed', kind === 'demo' ? 'true' : 'false');
    $('#connectBtn').textContent = 'Disconnect'; $('#listenBtn').hidden = true;
    this.console.setEnabled((kind !== 'demo' && !this.usesDrive) || !!this.sideConsole);
    if (this.usesDrive) { this.setStatus(`${kind === 'demo' ? 'Demo · ' : ''}${this.board.name} · drive "${this.info.driveName || ''}"`, kind === 'demo' ? 'demo' : 'ok'); await this.readDrive(); this.changed('connect'); return; }
    this.setStatus(`${kind === 'demo' ? 'Demo · ' : ''}${this.info.boardId} · uid ${this.info.uid.slice(-6)}${this.info.foxlibVersion ? ' · foxlib ' + this.info.foxlibVersion : ' · no fox firmware'}`, kind === 'demo' ? 'demo' : 'ok');
    if (this.catalog.boards[this.info.boardId] && this.info.boardId !== this.boardId) await this.setBoard(this.info.boardId);
    await this.readBoard();
    this.changed('connect');
  },
  /** Drive families: list the drive and read what configures the fox (the vendor's settings file, or fox.json) into onBoard. */
  async readDrive() {
    const d = this.device; if (!d) return;
    if (this.family === 'foxlib-c') {
      if (d.kind === 'console') return;    // Listen only: the console has no files; the banner is what we learn
      const files = await d.list('');
      const raw = await d.readText('fox.json');
      const ob = { cfg: null, raw, foxlibVersion: this.onBoard.foxlibVersion || '', foxlibMissing: [], foxlibComplete: true, files, template: null };
      if (raw != null) { try { ob.cfg = JSON.parse(raw); ob.template = ob.cfg.template || null; } catch { this.console.err('fox.json on the drive is not valid JSON (the fox falls back to defaults.json and says cfg=default(parse) in its banner)'); } }
      this.onBoard = ob;
      if (!raw && ('settings.txt' in files || 'audio.wav' in files)) this.console.err('this drive holds the vendor firmware\'s files (settings.txt, audio.wav) and no fox.json: the board is still running the vendor firmware. Flash fox-bench\'s from the Board tab ("Reboot into bootloader", then copy to the RPI-RP2 drive), or select the "(vendor firmware)" target to keep using it.');
      this.console.dim(ob.cfg ? `fox.json read from the drive: template ${ob.cfg.template}, call "${ob.cfg.id?.callmessage}"` : `no fox.json on the drive (the firmware writes one from its built-in defaults at power-on)`);
      return;
    }
    const v = this.vendor; if (!v) return;
    const files = await d.list('');
    const raw = await d.readText(v.FILES.settings);
    const marker = await d.readBytes(v.FILES.marker);
    const ob = { cfg: null, raw, foxlibVersion: '', foxlibMissing: [], foxlibComplete: true, files, template: raw != null ? this.templatesFor('drive')[0]?.id : null, settings: raw != null ? v.parseSettings(raw) : null, markerOk: null };
    if (raw != null) { ob.cfg = v.cfgFromSettings(ob.settings, this.defaults); ob.markerOk = marker ? v.readMarker(marker) === v.byteSum(raw) : false; }
    this.onBoard = ob;
    if (raw == null && 'fox.json' in files) this.console.err('this drive holds fox.json and no settings.txt: the board is running fox-bench firmware, which ignores the vendor\'s files. Select the "(fox-bench firmware)" target, or put the vendor firmware back from the Board tab (Get pfoxr3v1.uf2 → Reboot into bootloader → Copy).');
    this.console.dim(raw != null ? `${v.FILES.settings}: ${Object.entries(ob.settings).map(([k, x]) => k + '=' + x).join(' ')}` : `no ${v.FILES.settings} on the drive (a factory board writes one at power-on)`);
  },
  /** Read what is on the board. Interrupts a running fox; call restartFox() afterwards if it should keep running. */
  async readBoard() {
    const d = this.device; if (!d) return;
    if (this.usesDrive) return this.readDrive();
    if (d.listening) { this.info = await d.identify(); this.setStatus(`${this.info.boardId} · uid ${this.info.uid.slice(-6)}`, 'ok'); this.console.setEnabled(true); }
    else await d.interrupt();
    const files = await d.list('');
    const fv = files.foxlib ? ((await d.readText('foxlib/VERSION')) || '').trim() : '';
    const libFiles = files.foxlib ? await d.list('foxlib') : {};
    const foxlibMissing = this.catalog.foxlibFiles.filter(n => !libFiles[n] || libFiles[n].size <= 0);
    this.info.foxlibVersion = fv;
    this.onBoard = { cfg: null, raw: null, foxlibVersion: fv, foxlibMissing, foxlibComplete: !!fv && foxlibMissing.length === 0, files, template: null };
    if (fv && foxlibMissing.length) this.console.err(`foxlib on the board is incomplete (missing ${foxlibMissing.join(', ')}); Deploy will reinstall it`);
    this.setStatus(`${d.kind === 'demo' ? 'Demo · ' : ''}${this.info.boardId} · uid ${this.info.uid.slice(-6)}${fv ? ' · foxlib ' + fv : ' · no fox firmware'}`, d.kind === 'demo' ? 'demo' : 'ok');
    const code = await d.readText('code.py');
    this.onBoard.template = code?.match(/fox-bench template: ([\w-]+)/)?.[1] || (code ? 'other' : null);
    const raw = await d.readText('fox.json');
    if (raw) { this.onBoard.raw = raw; try { this.onBoard.cfg = JSON.parse(raw); } catch { this.console.err('fox.json on the board is not valid JSON'); } }
    if (this.onBoard.cfg) { this.console.dim(`fox.json read from board: template ${this.onBoard.cfg.template}, call "${this.onBoard.cfg.id?.callmessage}"`); }
    else this.console.dim(this.onBoard.template ? `board runs ${this.onBoard.template} with no fox.json` : 'no fox firmware on the board');
  },
  /** Soft-reboot so code.py runs again; shows the banner. */
  async restartFox() {
    if (!this.device) return null;
    if (this.family === 'drive') { this.console.line('no reset over USB: eject the drive, switch the board off and on; Listen only shows its boot messages', 'dim'); return null; }
    if (this.family === 'foxlib-c') { this.console.line('the fox reloads by itself about a second after the last write; Listen only on its serial port shows the new banner', 'dim'); return null; }
    const text = await this.device.reboot();
    const banner = parseBanner(text);
    if (banner) this.lastBanner = banner;
    this.console.line(banner ? `fox restarted: ${banner._raw}` : 'restarted; no FOX banner seen', banner ? 'ok' : 'err');
    this.changed('restart');
    return banner;
  },
  /** Everything a bug report needs, as one JSON object. No secrets: the config, the board's identity, what the page saw. */
  diagnostics() {
    const safe = fn => { try { return fn(); } catch (e) { return `(unavailable: ${e.message})`; } };
    return {
      generated: new Date().toISOString(),
      page: { version: VERSION, url: location.href, userAgent: navigator.userAgent, webSerial: 'serial' in navigator, theme: document.documentElement.dataset.theme },
      catalog: safe(() => ({ foxlib: this.catalog.foxlibVersion, templates: Object.fromEntries(Object.values(this.catalog.templates).map(t => [t.id, `${t.version} ${t.status}`])), boards: Object.keys(this.catalog.boards), modules: Object.keys(this.catalog.modules) })),
      selection: { boardId: this.boardId, templateId: this.templateId, moduleId: this.moduleId, region: this.region },
      validation: { status: this.status, report: this.report, issues: this.issues },
      cfg: this.cfg, images: this.images.map(im => ({ name: im.name, w: im.w, h: im.h })),
      device: this.device ? { kind: this.device.kind, listening: !!this.device.listening, info: this.info, link: safe(() => this.device.link?.info?.()) } : null,
      onBoard: { ...this.onBoard, raw: this.onBoard.raw ? this.onBoard.raw.slice(0, 4000) : null },
      lastDeploy: this.lastDeploy || null,
      bench: (this.benchEvents || []).slice(-50),
      storage: safe(() => ({ profiles: JSON.parse(localStorage.getItem('fox-bench.profiles') || '[]').length, fleetRows: JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').length })),
      pageErrors: this.pageErrors.slice(-50),
      console: safe(() => this.console.recent(300)),
    };
  },
  pageErrors: [],
  async disconnect() {
    try { await this.device?.close(); } catch {}
    try { await this.sideConsole?.close(); } catch {} this.sideConsole = null;
    this.lastBanner = null;
    this.device = null; this.info = null; this.onBoard = { cfg: null, raw: null, foxlibVersion: '', foxlibMissing: [], foxlibComplete: false, files: {} };
    $('#demoBtn').setAttribute('aria-pressed', 'false'); $('#listenBtn').hidden = false;
    this.console.setEnabled(false); this.setStatus('Not connected');
    this.changed('disconnect');       // also resets the Connect button label for the family
  },
};

function setFlag(tab, cls) { const f = $(`.rail button[data-tab="${tab}"] .flag`); if (f) f.className = 'flag ' + cls; }

export function showTab(name) {
  $$('.rail button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  TABS[name]?.shown?.();
  try { localStorage.setItem('fox-bench.tab', name); } catch {}
}

async function boot() {
  $('#ver').textContent = 'v' + VERSION;
  const theme = localStorage.getItem('fox-bench.theme'); if (theme) document.documentElement.dataset.theme = theme;
  $('#themeBtn').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = t; localStorage.setItem('fox-bench.theme', t); app.changed('theme'); });
  app.console = initConsole({ log: $('#log'), form: $('#sendForm'), input: $('#sendInput'), handle: $('#consoleHandle'), drawer: $('#console'), toggle: $('#consoleToggle'), clearBtn: $('#clearLog'), copyBtn: $('#copyLog'), dlBtn: $('#dlLog'), dlMode: $('#dlMode') },
    async code => { if (!app.device) return;
      try {
        const con = app.consoleDevice(); if (con) { await con.send(code); return; }   // the foxlib-c console: text commands, replies arrive as fox output
        const out = await app.device.exec(code, { soft: true }); if (out) app.console.reply(out.replace(/\r/g, ''));
      } catch (e) { app.console.err(String(e.message || e)); } });
  if (!hasWebSerial()) { $('#noSerial').hidden = false; }

  try { app.catalog = await loadCatalog(); }
  catch (e) { app.console.err('could not load descriptors: ' + e.message + ' (serve the folder over http, not file://)'); return; }

  // restore the working config, else template defaults
  let restored = null; try { restored = JSON.parse(localStorage.getItem('fox-bench.working')); } catch {}
  if (restored?.cfg && app.catalog.templates[restored.templateId] && app.catalog.boards[restored.boardId]) {
    app.templateId = restored.templateId; app.boardId = restored.boardId; app.moduleId = restored.moduleId || app.moduleId; app.region = restored.region || app.region;
    app.defaults = await loadDefaults(app.templateId, app.boardId); app.cfg = restored.cfg;
  } else { await app.setTemplate(app.templateId, { carry: false }); }

  for (const [name, mod] of Object.entries(TABS)) mod.init(app, $(`#tab-${name} .body`));
  $$('.rail button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#connectBtn').addEventListener('click', () => app.device ? app.disconnect() : app.connect(app.usesDrive ? 'drive' : 'serial'));
  $('#listenBtn').addEventListener('click', () => app.device ? app.disconnect() : app.connect('serial', { listen: true }));
  if (!hasWebSerial()) $('#listenBtn').disabled = true;
  $('#demoBtn').addEventListener('click', () => app.device?.kind === 'demo' ? app.disconnect() : app.connect('demo'));
  window.addEventListener('beforeunload', () => { app.device?.close?.(); });
  window.addEventListener('error', e => app.pageErrors.push({ t: new Date().toISOString(), msg: String(e.message), at: `${e.filename}:${e.lineno}` }));
  window.addEventListener('unhandledrejection', e => app.pageErrors.push({ t: new Date().toISOString(), msg: String(e.reason?.message || e.reason) }));

  app.changed('boot');
  const savedTab = localStorage.getItem('fox-bench.tab'); showTab(savedTab && TABS[savedTab] ? savedTab : 'board');
  window.foxbench = app;   // for the console-curious
}
boot();
