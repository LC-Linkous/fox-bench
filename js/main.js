// main.js — app state and wiring. Tabs live in js/ui/*.js and render from app.cfg.
// SPDX-License-Identifier: GPL-2.0-only
import { $, $$ } from './ui/dom.js';
import { loadCatalog, loadDefaults } from './model/loaders.js';
import { mergeAndValidate, pageChecks } from './model/schema.js';
import { TABLE as MORSE } from './audio/morse.js';
import { hasWebSerial, SerialLink } from './device/serial-link.js';
import { ReplDevice } from './device/repl-device.js';
import { DemoDevice } from './device/demo-device.js';
import { initConsole } from './ui/console.js';
import * as tabConnect from './ui/connect.js';
import * as tabBoard from './ui/board.js';
import * as tabRadio from './ui/radio.js';
import * as tabPlan from './ui/plan.js';
import * as tabId from './ui/id.js';
import * as tabPayload from './ui/payload.js';
import * as tabSchedule from './ui/schedule.js';
import * as tabDeploy from './ui/deploy.js';
import * as tabBench from './ui/bench.js';
import * as tabFleet from './ui/fleet.js';
import * as tabAbout from './ui/about.js';

const VERSION = '0.2.0';
const TABS = { connect: tabConnect, board: tabBoard, radio: tabRadio, plan: tabPlan, id: tabId, payload: tabPayload, schedule: tabSchedule, deploy: tabDeploy, bench: tabBench, fleet: tabFleet, about: tabAbout };
const TAB_KEYS = { board: ['pins'], radio: ['radio', 'module'], plan: ['plan'], id: ['id'], payload: ['payload'], schedule: ['schedule'] };

export const app = {
  version: VERSION,
  catalog: null,
  device: null, info: null,            // connected device and what connect() returned
  onBoard: { cfg: null, raw: null, foxlibVersion: '', files: {} },   // what was read from the board
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
    const r = mergeAndValidate(this.cfg, this.defaults, this.board);
    this.report = r.report; this.status = r.status;
    this.issues = pageChecks(r.cfg, { bands: this.catalog.bands, region: this.region, morseTable: MORSE, templateManifest: this.template, module: this.module });
    this.validCfg = r.cfg;
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
    this.boardId = id;
    this.defaults = await loadDefaults(this.templateId, id);
    this.cfg.board = id; this.cfg.pins = structuredClone(this.defaults.pins);
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
    this.cfg = mergeAndValidate(cfg, this.defaults, this.board).cfg;
    this.changed(source);
  },

  setStatus(text, cls) { $('#status').className = 'status ' + (cls || ''); $('#statusText').textContent = text; },

  async connect(kind) {
    if (this.device) await this.disconnect();
    let device;
    if (kind === 'demo') device = new DemoDevice({ board: this.board, moduleRanges: this.module.ranges_mhz });
    else { const link = new SerialLink(); await link.open(); link.onDrop = () => { this.console.err('serial port dropped'); this.disconnect(); }; device = new ReplDevice(link); }
    device.onLog = (t, cls) => cls === 'tx' ? this.console.tx(t) : cls === 'reply' ? this.console.reply(t) : cls === 'ok' ? this.console.line(t, 'ok') : cls === 'err' ? this.console.err(t) : this.console.dim(t);
    this.setStatus(kind === 'demo' ? 'Starting simulated board…' : 'Connecting…');
    try { this.info = await device.connect(); }
    catch (e) { this.console.err(String(e.message || e)); this.setStatus('Not connected', 'err'); try { await device.close(); } catch {} return; }
    this.device = device;
    $('#demoBtn').setAttribute('aria-pressed', kind === 'demo' ? 'true' : 'false');
    $('#connectBtn').textContent = 'Disconnect';
    this.console.setEnabled(kind !== 'demo');
    this.setStatus(`${kind === 'demo' ? 'Demo · ' : ''}${this.info.boardId} · uid ${this.info.uid.slice(-6)}${this.info.foxlibVersion ? ' · foxlib ' + this.info.foxlibVersion : ' · no fox firmware'}`, kind === 'demo' ? 'demo' : 'ok');
    if (this.catalog.boards[this.info.boardId] && this.info.boardId !== this.boardId) await this.setBoard(this.info.boardId);
    await this.readBoard();
    this.changed('connect');
  },
  async readBoard() {
    const d = this.device; if (!d) return;
    const files = await d.list('');
    const fv = files.foxlib ? ((await d.readText('foxlib/VERSION')) || '').trim() : '';
    this.info.foxlibVersion = fv;
    this.onBoard = { cfg: null, raw: null, foxlibVersion: fv, files, template: null };
    this.setStatus(`${d.kind === 'demo' ? 'Demo · ' : ''}${this.info.boardId} · uid ${this.info.uid.slice(-6)}${fv ? ' · foxlib ' + fv : ' · no fox firmware'}`, d.kind === 'demo' ? 'demo' : 'ok');
    const code = await d.readText('code.py');
    this.onBoard.template = code?.match(/fox-bench template: ([\w-]+)/)?.[1] || (code ? 'other' : null);
    const raw = await d.readText('fox.json');
    if (raw) { this.onBoard.raw = raw; try { this.onBoard.cfg = JSON.parse(raw); } catch { this.console.err('fox.json on the board is not valid JSON'); } }
    if (this.onBoard.cfg) { this.console.dim(`fox.json read from board: template ${this.onBoard.cfg.template}, call "${this.onBoard.cfg.id?.callmessage}"`); }
    else this.console.dim(this.onBoard.template ? `board runs ${this.onBoard.template} with no fox.json` : 'no fox firmware on the board');
  },
  async disconnect() {
    try { await this.device?.close(); } catch {}
    this.device = null; this.info = null; this.onBoard = { cfg: null, raw: null, foxlibVersion: '', files: {} };
    $('#demoBtn').setAttribute('aria-pressed', 'false'); $('#connectBtn').textContent = 'Connect';
    this.console.setEnabled(false); this.setStatus('Not connected');
    this.changed('disconnect');
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
    async code => { if (!app.device) return; try { const out = await app.device.exec(code, { soft: true }); if (out) app.console.reply(out.replace(/\r/g, '')); } catch (e) { app.console.err(String(e.message || e)); } });
  if (!hasWebSerial()) { $('#noSerial').hidden = false; $('#connectBtn').disabled = true; }

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
  $('#connectBtn').addEventListener('click', () => app.device ? app.disconnect() : app.connect('serial'));
  $('#demoBtn').addEventListener('click', () => app.device?.kind === 'demo' ? app.disconnect() : app.connect('demo'));
  window.addEventListener('beforeunload', () => { app.device?.close?.(); });

  app.changed('boot');
  showTab(localStorage.getItem('fox-bench.tab') || 'connect');
  window.foxbench = app;   // for the console-curious
}
boot();
