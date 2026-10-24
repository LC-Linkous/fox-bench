// smoke.mjs — drive the page in headless Chromium through the demo board:
// every tab × every template, deploy, bench, library, out-of-band override,
// export zip, profile. Fails on any console error or failed assertion.
// SPDX-License-Identifier: GPL-2.0-only
//
//   node tests/page/smoke.mjs            (installs nothing; needs tests/node_modules/playwright)
//   SHOTS=dir node tests/page/smoke.mjs  also writes a screenshot per tab
//   CHROMIUM=/path/to/chromium           use a specific binary
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TABS = ['board', 'radio', 'behavior', 'plan', 'id', 'payload', 'schedule', 'deploy', 'bench', 'fleet', 'about'];

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ok   ' + msg); else { failures++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => check(a === b, `${msg} (${JSON.stringify(a)})` + (a === b ? '' : ` expected ${JSON.stringify(b)}`));

/** Parse the local file headers of a stored zip (what js/model/zip.js writes) into {name, data}. */
function zipEntries(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); const out = []; let o = 0;
  while (o + 30 <= buf.length && v.getUint32(o, true) === 0x04034b50) {
    const comp = v.getUint32(o + 18, true), nl = v.getUint16(o + 26, true), xl = v.getUint16(o + 28, true);
    const name = new TextDecoder().decode(buf.subarray(o + 30, o + 30 + nl)); const start = o + 30 + nl + xl;
    out.push({ name, data: buf.subarray(start, start + comp) }); o = start + comp;
  }
  return out;
}
/** Unpack a foxlib-c deploy set (fox.json + defaults.json) and boot it in the C firmware's host simulation (built with make). */
async function bootInFoxlibC(entries, label) {
  const { mkdtemp, writeFile } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { execFile } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'fox-bench-foxlibc-'));
  for (const e of entries) await writeFile(join(dir, e.name), e.data);
  const bin = join(ROOT, 'firmware/foxlib-c/tests/build/host_sim');
  await new Promise((res, rej) => execFile('make', ['-s', '-C', join(ROOT, 'firmware/foxlib-c/tests'), 'build/host_sim'], { timeout: 120000 }, (err, so, se) => err ? rej(new Error(`${label}: host_sim build failed\n${so}${se}`)) : res()));
  return new Promise((res, rej) => execFile(bin, [dir, '--cap-ms', '120000', '--stop-after-unkeys', '2'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => err ? rej(new Error(`${label}: host_sim failed\n${stdout}${stderr}`)) : res(stdout)));
}

/** Unpack a deploy-set zip into a temp dir and boot it in the firmware simulator. Returns the sim's stdout, or throws. */
async function bootInSimulator(entries, label) {
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { execFile } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'fox-export-'));
  for (const e of entries) { await mkdir(dirname(join(dir, e.name)), { recursive: true }); await writeFile(join(dir, e.name), e.data); }
  return new Promise((res, rej) => execFile('python3', [join(ROOT, 'firmware/sim/run.py'), '--deploy-set', dir], { timeout: 120000 }, (err, stdout, stderr) => err ? rej(new Error(`${label}: simulator failed\n${stdout}${stderr}`)) : res(stdout)));
}

const { url, close, overrides } = await serve(ROOT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));   // no fonts, no network: the page must work offline
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
page.on('requestfailed', r => errors.push(`request failed ${r.url()} ${r.failure()?.errorText}`));
page.on('dialog', d => d.dismiss());                                     // default: refuse confirms; tests opt in below
const settle = ms => page.waitForTimeout(ms);
/** Wait for a condition instead of a fixed time: a slow runner does not under-sleep, a fast one does not over-sleep.
 *  `cond` runs in the page; `name` is what the failure says. Returns true when it came true in time. */
const until = async (cond, name, ms = 15000, arg = null) => { try { await page.waitForFunction(cond, arg, { timeout: ms, polling: 100 }); return true; } catch { console.log(`  (timed out waiting for ${name})`); return false; } };
const untilTextArgs = async (sel, re, ms = 15000) => { try { await page.waitForFunction(([s, src]) => new RegExp(src).test((document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ')), [sel, re.source], { timeout: ms, polling: 100 }); return true; } catch { console.log(`  (timed out waiting for ${sel} to match ${re})`); return false; } };
const untilFleet = async (pred, ms = 15000) => { try { await page.waitForFunction(src => (new Function('r', 'return ' + src))(JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').slice(-1)[0] || {}), pred, { timeout: ms, polling: 100 }); return true; } catch { console.log(`  (timed out waiting for a fleet row where ${pred})`); return false; } };
const tab = async name => { await page.click(`.rail button[data-tab="${name}"]`); await settle(150); if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const text = sel => page.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim());
const app = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' }); await settle(300);

  console.log('load');
  check((await text('#ver')).startsWith('v'), 'version shown');
  eq(await text('#statusText'), 'Not connected', 'initial status');
  const templates = await app(() => window.foxbench.templatesFor('foxlib').map(t => t.id));
  check(templates.length >= 7, `catalog has ${templates.length} foxlib templates`);
  for (const t of TABS) await tab(t);                                    // every tab renders disconnected

  console.log('demo connect');
  await page.click('#demoBtn'); await settle(800);
  check((await text('#statusText')) !== 'Not connected', 'status changed after demo connect');
  check(await app(() => window.foxbench.connected), 'app.connected');

  console.log('validation');
  await tab('plan');
  await page.click('#tab-plan button.btn.small:has-text("433.900")'); await settle(150);
  let badges = await page.$$eval('#tab-plan .list .badge', els => els.map(e => e.textContent));
  check(badges.some(b => /outside the .* range/.test(b)), 'UHF entry flagged against the VHF module');
  await page.click('#tab-plan .list li:nth-child(2) button[title="remove"]'); await settle(150);
  await tab('deploy');
  await page.check('#tab-deploy .gate input');
  check(await page.isDisabled('#tab-deploy button.btn.primary'), 'deploy disabled while callsign unset (gate ticked, so the callsign is the reason)');
  await page.uncheck('#tab-deploy .gate input');
  await tab('id');
  await page.fill('#tab-id input[type=text]', 'W1ABC FOX DE W1ABC'); await settle(200);
  eq(await app(() => window.foxbench.cfg.id.callmessage), 'W1ABC FOX DE W1ABC', 'callsign stored without losing focus');
  check(await page.evaluate(() => document.activeElement && document.activeElement.type === 'text'), 'focus kept in the callsign input after re-render');

  console.log('every template deploys on the demo board');
  for (const id of templates) {
    await tab('behavior');
    await page.selectOption('#tab-behavior select', id); await settle(300);
    for (const t of TABS) await tab(t);
    await tab('deploy');
    await page.check('#tab-deploy .gate input');
    await page.click('#tab-deploy button.btn.primary'); await until(() => !!window.foxbench.lastDeploy, 'the deploy to finish'); await settle(200);
    const banner = await app(() => window.foxbench.onBoard.template ? document.querySelector('#tab-deploy').textContent : '');
    const m = banner.match(/FOX template=(\S+) foxlib=(\S+) board=\S+ uid=\S+ cfg=(\S+) radio=(\S+) id=(\S+) freq=(\S+)/);
    check(m && m[1].startsWith(id + '/'), `${id}: banner template`);
    check(m && m[3] === 'ok', `${id}: cfg=ok`);
    check(m && m[4] === 'ok', `${id}: radio=ok`);
    check(m && m[5] === 'set', `${id}: id=set`);
  }
  const rows = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'deploy').length);
  eq(rows, templates.length, 'fleet log has one row per deploy');

  console.log('bench');
  await tab('bench');
  await page.click('#tab-bench button:has-text("Read RSSI")'); await untilTextArgs('#tab-bench pre.out', /rssi\s+\d+/, 10000);
  check(/rssi\s+\d+/.test(await text('#tab-bench pre.out')), 'RSSI logged');
  await page.click('#tab-bench button:has-text("Key")'); await untilTextArgs('#tab-bench pre.out', /key\s+ok/, 20000);   // demo keys for the configured 3 s
  check(/key\s+ok/.test(await text('#tab-bench pre.out')), 'key test logged ok');
  await tab('radio');
  await page.click('#tab-radio button:has-text("Probe")'); await untilTextArgs('#tab-radio', /146\.5 MHz accepted/, 10000);
  check(/146\.5 MHz accepted/.test(await text('#tab-radio')), 'probe reports the VHF band');

  console.log('flash CircuitPython (demo esptool)');
  const lib = await app(async () => { try { const m = await import(new URL('flasher/vendor/esptool-js/bundle.js', location.href).href); return Object.keys(m).filter(k => /^(ESPLoader|Transport)$/.test(k)); } catch (e) { return 'ERR ' + e.message; } });
  check(Array.isArray(lib) && lib.length === 2, 'vendored esptool-js bundle is served and exports ESPLoader/Transport (' + JSON.stringify(lib) + ')');
  await tab('board');
  check(await page.isDisabled('#tab-board button:has-text("Flash CircuitPython")'), 'flash disabled until an image is loaded');
  const fakeBin = Buffer.alloc(80000); for (let i = 0; i < fakeBin.length; i++) fakeBin[i] = (i * 7) & 0xff;
  await page.setInputFiles('#tab-board input[type=file][accept=".bin"]', { name: 'adafruit-circuitpython-raspberry_pi_pico-en_US-10.2.1.bin', mimeType: 'application/octet-stream', buffer: fakeBin }); await settle(300);
  check(/not seeed_xiao_esp32c3/.test(await text('#tab-board')), 'image for another board is flagged');
  await page.setInputFiles('#tab-board input[type=file][accept=".bin"]', { name: 'adafruit-circuitpython-seeed_xiao_esp32c3-en_US-10.2.1.bin', mimeType: 'application/octet-stream', buffer: fakeBin }); await settle(300);
  check(!(await page.isDisabled('#tab-board button:has-text("Flash CircuitPython")')), 'flash enabled with the right image in demo mode');
  await page.click('#tab-board button:has-text("Flash CircuitPython")'); await settle(400);
  check(await page.$('#tab-board progress'), 'progress bar shown while flashing');
  await untilTextArgs('#tab-board', /Flashed in .* ESP32-C3/);
  check(/Flashed in .* ESP32-C3.*MAC 84:f7:03:12:34:56/.test(await text('#tab-board')), 'demo flash reports chip and MAC');
  let flashRows = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'flash'));
  check(flashRows.length === 1 && flashRows[0].uid === '84f703123456' && /10\.2\.1\.bin/.test(flashRows[0].notes) && flashRows[0].result === 'ok', 'fleet row for the flash keyed on the MAC');
  await tab('fleet');
  check(/Flash board #1/.test(await text('#tab-fleet')), 'batch card starts at board #1');
  await page.click('#tab-fleet button:has-text("Flash board #1")'); await untilTextArgs('#tab-fleet', /Flash board #2/);
  check(/Flash board #2/.test(await text('#tab-fleet')), 'batch number advances after a flash');
  flashRows = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'flash'));
  check(flashRows.length === 2 && String(flashRows[1].board_number) === '1', 'batch row carries the board number');
  check(/flash/.test(await text('#tab-fleet table')), 'fleet table shows the flash rows');

  console.log('payload: library, SSTV, spectrum');
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'morse-songs'); await settle(300);
  await tab('payload');
  const before = await app(() => window.foxbench.cfg.payload.playlist.length);
  await page.fill('#tab-payload input[placeholder="filter…"]', 'yank'); await settle(200);
  await page.click('#tab-payload ul.list li button:has-text("+ add")'); await settle(200);
  eq(await app(() => window.foxbench.cfg.payload.playlist.length), before + 1, 'library song added to the playlist');
  check(await page.$('#tab-payload canvas'), 'trace canvas drawn');
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'composite'); await settle(300);
  await tab('payload'); await page.selectOption('#tab-payload select', 'sstv'); await settle(600);
  check((await page.$$('#tab-payload canvas')).length >= 2, 'SSTV preview draws decode canvases');
  const xs = await page.$$('#tab-payload button[title="remove"]');
  check(xs.length >= 1, 'the SSTV card has a remove button');
  if (xs.length) { await xs[0].click(); await settle(200); }
  eq(await app(() => window.foxbench.images.length), 0, 'removing the only SSTV card removes it');
  check(/no images/i.test(await text('#tab-payload')), 'and the tab warns rather than refusing');
  await tab('schedule'); await page.selectOption('#tab-schedule select', 'resurrection'); await settle(300);
  check(await page.$('#tab-schedule canvas'), 'schedule timeline drawn');

  console.log('out-of-band override');
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'morse-songs'); await settle(300);
  await tab('plan');
  await page.click('#tab-plan button.btn.small:has-text("+ Add frequency")'); await settle(150);
  const inputs = await page.$$('#tab-plan .list input[type=number]');
  await inputs.at(-1).fill('150'); await inputs.at(-1).dispatchEvent('change'); await settle(200);
  badges = await page.$$eval('#tab-plan .list .badge', els => els.map(e => e.textContent));
  check(badges.some(b => /outside the US bands/.test(b)), 'out-of-band entry flagged red, not refused');
  await tab('deploy');
  await page.check('#tab-deploy .gate input');
  check(!(await page.isDisabled('#tab-deploy button.btn.primary')), 'out-of-band does not block deploy (gate ticked, button enabled)');
  page.removeAllListeners('dialog');
  let dialog = null; page.once('dialog', async d => { dialog = d.message(); await d.accept(); });
  await page.check('#tab-deploy .gate input'); await page.click('#tab-deploy button.btn.primary'); await until(() => !!window.foxbench.lastDeploy, 'the deploy to finish'); await settle(300);
  check(dialog && /150 MHz/.test(dialog), 'deploy asked to confirm the 150 MHz entry');
  check(/freq=146\.565,150/.test(await text('#tab-deploy')), 'board banner carries both frequencies');
  page.on('dialog', d => d.dismiss());

  console.log('export deploy set');
  await tab('deploy');
  page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export deploy set")')]);
  const buf = new Uint8Array(await (await import('node:fs/promises')).readFile(await dl.path()));
  const entries = zipEntries(buf), names = entries.map(e => e.name);
  for (const need of ['code.py', 'fox.json', 'defaults.json', 'foxlib/__init__.py', 'foxlib/VERSION', 'README.txt']) check(names.includes(need), `zip contains ${need}`);
  const foxlib = await app(() => window.foxbench.catalog.foxlibFiles || null);
  if (foxlib) check(foxlib.every(f => names.includes('foxlib/' + f)), 'zip contains every foxlib file');
  const onDisk = foxlib ? await Promise.all(foxlib.map(async f => (await import('node:fs/promises')).readFile(join(ROOT, 'firmware/foxlib', f)))) : [];
  check(foxlib && foxlib.every((f, i) => Buffer.compare(Buffer.from(entries.find(e => e.name === 'foxlib/' + f).data), onDisk[i]) === 0), 'zip foxlib bytes identical to the repo');
  try { const sim = await bootInSimulator(entries, 'morse-songs export'); check(/deploy set boots/.test(sim), 'exported set boots in the simulator: ' + (sim.match(/banner: (.*)/)?.[1] || '').slice(0, 90)); check(/keyed [1-9]/.test(sim), 'exported set keys the transmitter'); }
  catch (e) { check(false, e.message.split('\n').slice(0, 6).join(' | ')); }
  // an SSTV export carries the images file and boots too
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'morse-sstv'); await settle(300);
  await tab('payload'); await page.click('#tab-payload button:has-text("Add test card")'); await settle(400);
  await tab('deploy'); page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export deploy set")')]);
  const entries2 = zipEntries(new Uint8Array(await (await import('node:fs/promises')).readFile(await dl2.path())));
  check(entries2.some(e => e.name === 'images.bin' && e.data.length > 100), 'SSTV export contains images.bin');
  try { const sim = await bootInSimulator(entries2, 'morse-sstv export'); check(/deploy set boots/.test(sim), 'SSTV export boots in the simulator'); }
  catch (e) { check(false, e.message.split('\n').slice(0, 6).join(' | ')); }
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'morse-songs'); await settle(300); await tab('deploy');
  page.on('dialog', d => d.dismiss());

  console.log('profiles');
  await page.fill('#tab-deploy input[type=text]', 'smoke profile');
  await page.click('#tab-deploy button:has-text("Save profile")'); await settle(200);
  await tab('fleet');
  check(/smoke profile/.test(await text('#tab-fleet ul.list')), 'profile saved from Deploy appears in Fleet');
  await page.click('#tab-fleet ul.list li:has-text("smoke profile") button:has-text("Load")'); await settle(300);
  eq(await app(() => window.foxbench.cfg.fleet.profile), 'smoke profile', 'profile loads back');
  // audit: the demo board was deployed earlier in this run; its UID is in the log, and what is on it matches
  await page.fill('#tab-fleet input[placeholder^="note"]', 'smoke box'); await page.click('#tab-fleet button:has-text("Audit")'); await settle(400);
  check(/match/.test(await text('#tab-fleet')) && !/mismatch/.test(await text('#tab-fleet')), 'audit of the demo board matches its last deploy');
  const auditRowOk = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'audit').pop());
  check(auditRowOk && auditRowOk.result === 'match' && /matched by uid/.test(auditRowOk.notes) && /smoke box/.test(auditRowOk.notes), 'audit row appended with the note');
  // change the callsign on the form only: the board still carries the deployed one, so the audit still matches the log, not the form
  await app(() => { window.foxbench.cfg.id.callmessage = 'N0BODY HERE'; window.foxbench.changed('id'); }); await settle(200);
  await page.click('#tab-fleet button:has-text("Audit")'); await settle(400);
  check(/match/.test(await text('#tab-fleet')) && !/mismatch/.test(await text('#tab-fleet')), 'audit compares the board with the log, not with the unsaved form');
  await app(() => { window.foxbench.cfg.id.callmessage = 'W1ABC FOX DE W1ABC'; window.foxbench.changed('id'); }); await settle(200);

  console.log('diagnostics');
  const diag = await app(() => window.foxbench.diagnostics());
  check(diag.page.version && diag.catalog.foxlib && diag.cfg && diag.device?.kind === 'demo', 'diagnostics carries page, catalog, cfg, device');
  check(diag.lastDeploy && diag.lastDeploy.banner && diag.bench.length >= 2 && diag.console.length > 10, 'diagnostics carries last deploy, bench events, console');
  check(JSON.stringify(diag).length < 2_000_000, 'diagnostics is a reasonable size');
  await tab('board');
  const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-board button:has-text("Download diagnostics")')]);
  check(/fox-bench-diagnostics-.*\.json/.test(dl3.suggestedFilename()), 'diagnostics downloads as JSON');

  console.log('PicoFox (drive family)');
  // switching to another family while the C3 demo is connected disconnects it: that device speaks the REPL, and a
  // deploy for the PicoFox must never go out over it
  eq(await app(() => window.foxbench.connected), true, 'C3 demo still connected before the family switch');
  await tab('board');
  await page.selectOption('#tab-board select', 'picofox-vendor'); await settle(400);
  eq(await app(() => window.foxbench.connected), false, 'selecting a board of another family disconnects the old device');
  check(/different kind of board/.test(await text('#log')), 'the console says why it disconnected');
  eq(await app(() => window.foxbench.family), 'drive', 'family switches with the board');
  eq(await app(() => window.foxbench.templateId), 'picofox', 'template switched to the board\'s only template');
  eq(await app(() => window.foxbench.cfg.id.callmessage), 'W1ABC FOX DE W1ABC', 'callsign carried across the board switch');
  check(/does not run CircuitPython/.test(await text('#tab-board')), 'Board tab says no CircuitPython');
  check(!(await page.$('#tab-board button:has-text("Flash CircuitPython")')), 'no Flash CircuitPython button for the PicoFox');
  check(/Get pfoxr3v1\.uf2/.test(await text('#tab-board')) && /Reboot into bootloader/.test(await text('#tab-board')) && !/Get fox-bench firmware/.test(await text('#tab-board')), 'vendor target offers the vendor UF2 and the bootloader touch, not the fox-bench image');
  check(/silently dropped/.test(await text('#tab-board')) && /DUTY_CYCLE of 0/.test(await text('#tab-board')), 'firmware quirks listed on the Board tab');
  check(await page.isHidden('.rail button[data-tab="bench"]'), 'Bench tab hidden');
  eq(await text('#connectBtn'), 'Open PicoFox', 'Connect button names the drive');
  await tab('behavior');
  const opts = await page.$$eval('#tab-behavior select option', els => els.map(e => e.value));
  check(opts.length === 1 && opts[0] === 'picofox', 'template dropdown filtered to the board\'s templates (' + opts.join(',') + ')');
  for (const t of ['radio', 'behavior', 'plan', 'id', 'payload', 'schedule', 'deploy', 'fleet', 'about']) await tab(t);
  await tab('plan');
  const fIn = await page.$('#tab-plan input[type=number]'); await fIn.fill('147.99'); await fIn.dispatchEvent('change'); await settle(200);
  check(/would stay silent/.test(await text('#tab-plan')), 'band-edge rule explained on the Frequency tab');
  const fIn2 = await page.$('#tab-plan input[type=number]'); await fIn2.fill('146.565'); await fIn2.dispatchEvent('change'); await settle(200);   // the tab re-rendered
  await tab('id'); await page.fill('#tab-id input[type=text]', 'KY4ZR/3 FOX'); await settle(300);
  check(/KY4ZR3/.test(await text('#tab-id')), 'ID tab shows the firmware-reduced CALLSIGN');
  await page.fill('#tab-id input[type=text]', 'KY4ZR FOX DE KY4ZR'); await settle(300);
  await tab('radio');
  check(/±5 kHz is standard/.test(await text('#tab-radio')), 'ID deviation defaults to ±5 kHz with the firmware\'s 7 kHz noted');
  eq(await app(() => window.foxbench.cfg.radio.id_deviation_hz), 5000, 'id deviation default 5000');
  await tab('schedule');
  await page.click('#tab-schedule button:has-text("50 %")'); await settle(300);
  check(/Off/.test(await text('#tab-schedule')) && await page.$('#tab-schedule canvas'), 'duty cycle timeline drawn');
  await page.click('#demoBtn'); await settle(800);                       // demo drive
  check(/PicoFox/.test(await text('#statusText')) && /drive/.test(await text('#statusText')), 'demo drive connected: ' + await text('#statusText'));
  await tab('board');
  check(/no callsign — silent/.test(await text('#tab-board')), 'factory drive shows an empty callsign');
  await tab('deploy');
  check(/settings\.txt/.test(await text('#tab-deploy')) && /\.callsign\.wav/.test(await text('#tab-deploy')) && /\.settings_crc\.bin/.test(await text('#tab-deploy')), 'deploy lists the four files');
  await page.check('#tab-deploy .gate input'); await page.click('#tab-deploy button.btn.primary'); await untilTextArgs('#tab-deploy', /files written and read back|deploy failed/);
  check(/files written and read back/.test(await text('#tab-deploy')), 'files written to the demo drive');
  const onDrive = await app(async () => { const d = window.foxbench.device; const l = await d.list(''); const s = await d.readText('settings.txt'); return { names: Object.keys(l).sort(), s, markerOk: window.foxbench.onBoard.markerOk }; });
  check(onDrive.names.join() === '.callsign.wav,.settings_crc.bin,audio.wav,settings.txt' && /CALLSIGN=KY4ZR\n/.test(onDrive.s) && /DUTY_CYCLE=50\n/.test(onDrive.s) && onDrive.markerOk === true, 'drive holds the four files, settings as configured, marker matching');
  page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export files")')]);
  const pfNames = zipEntries(new Uint8Array(await (await import('node:fs/promises')).readFile(await dlp.path()))).map(e => e.name);
  check(['settings.txt', 'audio.wav', '.callsign.wav', '.settings_crc.bin', 'README.txt'].every(n => pfNames.includes(n)), 'PicoFox zip has the four files + README');
  page.on('dialog', d => d.dismiss());
  const row = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.board === 'picofox-vendor' && r.action === 'deploy').pop());
  check(row && row.result === 'written' && /dBm/.test(row.power), 'fleet row for the PicoFox deploy');
  await page.click('#demoBtn'); await settle(300);

  console.log('PicoFox drive: switching targets keeps the drive');
  // A fake drive root (Windows names it "\\") holding the vendor firmware's files and an editor's .crswap leftover. Both PicoFox
  // targets read the same drive, so the dropdown switch must not disconnect it — only read it as the other firmware's files.
  await app(() => {
    const files = { 'settings.txt': 'CALLSIGN=W1ABC\nFREQ_MHZ=146.565000\n', 'audio.wav': 'RIFF', '.settings_crc.bin': '\0\0\0\0', 'settings.txt.crswap': '' };
    const fh = name => ({ kind: 'file', name, getFile: async () => new File([files[name]], name), createWritable: async () => ({ write: async b => { files[name] = typeof b === 'string' ? b : new TextDecoder().decode(b); }, close: async () => {} }) });
    const handle = { kind: 'directory', name: '\\', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      values: async function* () { for (const n of Object.keys(files)) yield fh(n); },
      getFileHandle: async (n, o) => { if (!(n in files)) { if (o?.create) files[n] = ''; else { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } } return fh(n); },
      removeEntry: async n => { delete files[n]; } };
    window.showDirectoryPicker = async () => handle; window.__fakeDriveFiles = files;
  });
  await page.click('#connectBtn'); await settle(500);
  eq(await app(() => window.foxbench.connected), true, 'fake PicoFox drive opened under the vendor target');
  check(/drive "PicoFox"/.test(await text('#log')), 'a drive root named "\\" is shown by its label');
  check(/settings\.txt\.crswap: Chrome's temporary/.test(await text('#log')), 'the .crswap leftover is explained');
  await tab('board');
  await page.selectOption('#tab-board select', 'picofox-foxlibc'); await settle(500);
  eq(await app(() => window.foxbench.connected), true, 'switching to the fox-bench target keeps the drive open');
  eq(await app(() => window.foxbench.family), 'foxlib-c', 'family is foxlib-c after the switch');
  check(/same drive, read as that firmware's files/.test(await text('#log')), 'the console says the drive was kept');
  check(/still running the vendor firmware/.test(await text('#log')), 'vendor files and no fox.json: the page says the board still runs the vendor firmware');
  check(!/no fox\.json on the drive \(the firmware writes/.test(await text('#log')), 'no second, contradictory "no fox.json" line');
  eq((await text('#log')).split("crswap: Chrome's temporary").length - 1, 1, 'the .crswap note is given once, not on every re-read');
  await page.selectOption('#tab-board select', 'picofox-vendor'); await settle(500);
  eq(await app(() => window.foxbench.connected), true, 'and back to the vendor target, still open');
  eq(await app(() => window.foxbench.onBoard?.settings?.CALLSIGN), 'W1ABC', 'the vendor settings are read again after the switch back');
  // the reverse case: fox-bench firmware's files on the drive while the vendor target is selected
  await app(() => { window.__fakeDriveFiles['board.json'] = '{"board":"picofox-foxlibc","uid":"e4654c16431b2321","foxlib":"c-0.1.9"}'; });
  await app(() => window.foxbench.readDrive());
  check(/the board is running fox-bench's firmware/.test(await text('#log')), 'vendor target on a drive with board.json: the page says fox-bench firmware is running');
  await app(() => { delete window.__fakeDriveFiles['board.json']; });
  await app(() => window.foxbench.removeCrswap());
  await settle(300);
  eq(await app(() => 'settings.txt.crswap' in window.__fakeDriveFiles), false, 'removeCrswap() deletes the leftover');
  await app(() => window.foxbench.disconnect()); await settle(300);
  eq(await app(() => window.foxbench.connected), false, 'fake drive closed');

  console.log('PicoFox with fox-bench firmware (foxlib-c family)');
  await tab('board');
  await page.selectOption('#tab-board select', 'picofox-foxlibc'); await settle(400);
  eq(await app(() => window.foxbench.family), 'foxlib-c', 'family switches to foxlib-c');
  eq(await app(() => window.foxbench.templateId), 'morse-songs', 'template switched to the first template of the family (keeps morse-songs)');
  eq(await app(() => window.foxbench.cfg.id.callmessage), 'KY4ZR FOX DE KY4ZR', 'callsign carried across the board switch');
  check(/does not run CircuitPython/.test(await text('#tab-board')) && /Get fox-bench firmware/.test(await text('#tab-board')), 'Board tab offers the hosted fox-bench firmware');
  await settle(300);
  check(/Hosted build:.*no build info on this site/.test(await text('#tab-board')), 'without CI\'s fingerprint file the card says the image is checked as a UF2 only');
  check(/Open FOXBENCH/.test(await text('#connectBtn')), 'Connect button names the FOXBENCH drive');
  check(await page.isVisible('.rail button[data-tab="bench"]'), 'Bench tab shown (console commands)');
  await tab('behavior');
  const optsC = await page.$$eval('#tab-behavior select option', els => els.map(e => e.value));
  check(optsC.includes('morse-songs') && optsC.includes('popcorn') && optsC.includes('resurrection') && optsC.includes('morse-sstv') && !optsC.includes('picofox'), 'template dropdown filtered to the foxlib-c set (' + optsC.join(',') + ')');
  for (const t of ['radio', 'plan', 'id', 'payload', 'schedule', 'deploy', 'bench', 'fleet', 'about']) await tab(t);
  await tab('radio');
  check(/FM update rate/.test(await text('#tab-radio')) && /Pre-emphasis/.test(await text('#tab-radio')) && !/Board revision/.test(await text('#tab-radio')), 'Radio tab shows the foxlib-c controls, no vendor revision picker');
  eq(await app(() => window.foxbench.cfg.radio.sample_rate), 8000, 'sample rate default 8000');
  eq(await app(() => window.foxbench.report.length), 0, 'no pin complaints for a pinless board');
  await tab('plan');
  const fInC = await page.$('#tab-plan input[type=number]'); await fInC.fill('147.99'); await fInC.dispatchEvent('change'); await settle(200);
  check((await app(() => window.foxbench.issues.some(i => /band edge/.test(i.msg)))), 'band-edge check flags 147.99 for the foxlib-c family');
  const fInC2 = await page.$('#tab-plan input[type=number]'); await fInC2.fill('146.565'); await fInC2.dispatchEvent('change'); await settle(200);
  await tab('bench');
  check(/Listen only/.test(await text('#tab-bench')) && /Key test/.test(await text('#tab-bench')), 'Bench tab asks for the console when nothing is connected');
  await page.click('#demoBtn'); await settle(800);                       // demo FOXBENCH drive + a demo console beside it
  check(/FOXBENCH/.test(await text('#statusText')), 'demo FOXBENCH drive connected: ' + await text('#statusText'));
  await tab('bench');
  const keyIn = await page.$('#tab-bench input[type=number]'); await keyIn.fill('1'); await keyIn.dispatchEvent('change');
  await page.click('#tab-bench button:has-text("Key")'); await untilTextArgs('#tab-bench', /key\s+ok/);
  check(/key\s+ok/.test(await text('#tab-bench')), 'bench Key over the demo console: ok after the keyed second');
  await page.click('#tab-bench button:has-text("Charging?")'); await settle(400);
  check(/charger idle/.test(await text('#tab-bench')), 'bench Charging? reads the console reply');
  await page.click('#tab-bench button:has-text("Status")'); await settle(400);
  check(/i2c_write_us/.test(await text('#tab-bench')), 'bench Status shows the firmware status block');
  check(/FOX template=morse-songs/.test(await text('#log')), 'console drawer carries the demo banner');
  await tab('board');
  check(/Enter UF2 bootloader/.test(await text('#tab-board')), 'Board tab offers bootsel while a console is live');
  await tab('board');
  check(/Template on board/.test(await text('#tab-board')) && /morse-songs/.test(await text('#tab-board')), 'drive\'s fox.json read: template shown');
  await tab('deploy');
  check(/fox\.json/.test(await text('#tab-deploy')) && /defaults\.json/.test(await text('#tab-deploy')) && !/code\.py/.test(await text('#tab-deploy')), 'deploy lists fox.json + defaults.json, no code.py');
  await page.check('#tab-deploy .gate input'); await page.click('#tab-deploy button.btn.primary'); await untilTextArgs('#tab-deploy', /files written and read back|deploy failed/);
  check(/files written and read back/.test(await text('#tab-deploy')), 'files written to the demo FOXBENCH drive');
  const onDriveC = await app(async () => { const d = window.foxbench.device; const l = await d.list(''); const f = JSON.parse(await d.readText('fox.json')); return { names: Object.keys(l).sort(), f }; });
  check(onDriveC.names.join() === 'README.txt,board.json,defaults.json,fox.json' && onDriveC.f.template === 'morse-songs' && onDriveC.f.board === 'picofox-foxlibc' && onDriveC.f.id.callmessage === 'KY4ZR FOX DE KY4ZR' && !('ptt' in (onDriveC.f.pins || {})), 'drive holds fox.json for this board and template');
  // the deploy row carries the UID the firmware wrote to board.json, and an audit over the drive matches it by uid
  const rowCu = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'deploy' && r.board === 'picofox-foxlibc').pop());
  check(rowCu && rowCu.uid === 'e66138935f0a1b2c', 'foxlib-c deploy row stamped with the UID from board.json');
  await tab('fleet'); await page.click('#tab-fleet button:has-text("Audit")'); await settle(600);
  const auditC = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'audit').pop());
  check(auditC && auditC.result === 'match' && /via (drive|demo) · matched by uid/.test(auditC.notes), 'audit of the PicoFox over its drive matches by uid: ' + (auditC && auditC.notes));
  await tab('deploy');
  page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  const [dlc] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export files")')]);
  const cEntries = zipEntries(new Uint8Array(await (await import('node:fs/promises')).readFile(await dlc.path())));
  check(['fox.json', 'defaults.json', 'README.txt'].every(n => cEntries.map(e => e.name).includes(n)), 'foxlib-c zip has fox.json + defaults.json + README');
  page.on('dialog', d => d.dismiss());
  // the exported set boots in the C firmware's host simulation (same scenarios machinery as firmware/foxlib-c/tests/sim.py)
  try {
    const out = await bootInFoxlibC(cEntries, 'foxlib-c export');
    const rec = JSON.parse(out);
    check(/FOX template=morse-songs/.test(rec.prints) && /cfg=ok/.test(rec.prints) && /id=set/.test(rec.prints) && rec.ptt.length >= 2, 'exported set boots in the foxlib-c host sim: ' + (rec.prints.match(/FOX [^\n]*/) || [''])[0]);
  } catch (e) { check(false, 'foxlib-c host sim: ' + e.message.split('\n')[0]); }
  // SSTV on the foxlib-c target: images.bin is part of the set and the C runner sends the image
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'morse-sstv'); await settle(500);
  await tab('deploy');
  check(/images\.bin/.test(await text('#tab-deploy')), 'SSTV deploy lists images.bin for the foxlib-c target');
  page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  const [dls] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export files")')]);
  const sEntries = zipEntries(new Uint8Array(await (await import('node:fs/promises')).readFile(await dls.path())));
  check(sEntries.some(e => e.name === 'images.bin'), 'SSTV zip carries images.bin');
  page.on('dialog', d => d.dismiss());
  try {
    const rec = JSON.parse(await bootInFoxlibC(sEntries, 'foxlib-c sstv export'));
    check(/sstv: /.test(rec.prints) && rec.tones.some(([, , hz]) => hz === 1200) && rec.tones.filter(([, , hz]) => hz >= 1500 && hz <= 2300).length > 200, 'exported SSTV set boots in the C runner and sends an image: ' + (rec.prints.match(/sstv: [^\n]*/) || [''])[0]);
  } catch (e) { check(false, 'foxlib-c sstv host sim: ' + e.message.split('\n')[0]); }
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'morse-songs'); await settle(400);
  const rowC = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.board === 'picofox-foxlibc' && r.action === 'deploy').pop());
  check(rowC && rowC.result === 'written' && /dBm/.test(rowC.power), 'fleet row for the foxlib-c deploy');
  await page.click('#demoBtn'); await settle(300);
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(400);
  eq(await app(() => window.foxbench.family), 'foxlib', 'back to the C3: family foxlib');
  check(await page.isVisible('.rail button[data-tab="bench"]'), 'Bench tab back');
  await tab('behavior');
  check((await page.$$eval('#tab-behavior select option', els => els.length)) >= 7, 'template dropdown back to the foxlib set');
  await page.click('#demoBtn'); await settle(600);

  console.log('kitsune (compiled family)');
  await tab('board');
  const optsDefault = await page.$$eval('#tab-board select option', els => els.map(e => e.value));
  check(!optsDefault.some(v => v.endsWith('-kitsune')) && optsDefault.includes('picofox-foxlibc') && optsDefault.includes('seeed_xiao_esp32c3'), 'experimental (kitsune) targets are hidden from the picker by default; the verified ones are listed');
  const nExp = await app(() => Object.values(window.foxbench.catalog.boards).filter(b => b.status === 'experimental').length);
  check(/Show experimental targets/.test(await text('#tab-board')) && new RegExp(nExp + ' hidden').test(await text('#tab-board')), `the picker says how many targets are hidden (${nExp})`);
  await page.check('#tab-board .card:first-child input[type=checkbox]'); await settle(300);   // the picker card's checkbox, not the flash card's erase box
  const optsAll = await page.$$eval('#tab-board select option', els => els.map(e => e.value));
  check(optsAll.filter(v => v.endsWith('-kitsune')).length === nExp, `the checkbox lists the ${nExp} kitsune targets`);
  await page.selectOption('#tab-board select', 'seeed_xiao_esp32c5-kitsune'); await settle(400);
  eq(await app(() => window.foxbench.family), 'compiled', 'family switches to compiled');
  eq(await app(() => window.foxbench.templateId), 'wifi-ap', 'first kitsune template selected');
  check(await page.isDisabled('#connectBtn') && await page.isDisabled('#demoBtn'), 'no Connect / demo for the compiled family yet');
  check(/kitsune is the work of its authors/.test(await text('#tab-board')) && /github\.com\/rfhs\/kitsune/.test(await text('#tab-board')), 'Board tab attributes kitsune to its repository');
  check(await page.isHidden('.rail button[data-tab="payload"]') && await page.isHidden('.rail button[data-tab="bench"]'), 'Payload and Bench tabs hidden for the family');
  await tab('behavior');
  const kOpts = await page.$$eval('#tab-behavior select option', els => els.map(e => e.value));
  check(kOpts.includes('wifi-ap') && kOpts.includes('zigbee-coordinator') && !kOpts.includes('bt-classic') && !kOpts.includes('morse-songs'), 'C5 offers Wi-Fi/BLE/Zigbee challenges, not BT Classic or the FM templates (' + kOpts.join(',') + ')');
  await tab('id');
  check(/Key phrase/.test(await text('#tab-id')) && /placeholder MAC/.test(await text('#tab-id')), 'ID tab shows the challenge card and flags the placeholder MAC');
  await page.click('#tab-id button:has-text("roll")'); await settle(300);
  const mac = await app(() => window.foxbench.cfg.wifi.mac);
  check(/^F2(:[0-9A-F]{2}){5}$/.test(mac), 'roll gives a locally administered MAC: ' + mac);
  await tab('plan');
  check(/Band/.test(await text('#tab-plan')) && /random at every wake/.test(await text('#tab-plan')), 'Plan tab: band and channel for the AP on the C5');
  await tab('schedule');
  check(/Duty cycle/.test(await text('#tab-schedule')) && /wakes in 10 min/.test(await text('#tab-schedule')), 'Schedule tab draws the duty cycle');
  await tab('deploy');
  check(/#if defined\(AP\)/.test(await text('#tab-deploy')) && /#define FSSID/.test(await text('#tab-deploy')) && /RFHS_CHALLENGE_NAME/.test(await text('#tab-deploy')), 'Deploy tab previews the header block');
  const [dlh] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export header block")')]);
  check(/\.h$/.test(dlh.suggestedFilename()), 'header block downloads: ' + dlh.suggestedFilename());
  const hdr = (await import('node:fs/promises')).readFile(await dlh.path(), 'utf8');
  check(/#define MAC_ADDR \{0xf2,/.test(await hdr) && /#define TIME_TO_WAKE 15/.test(await hdr), 'the exported block carries the rolled MAC and the duty cycle');
  const rowK = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'export-header').pop());
  check(rowK && rowK.board === 'seeed_xiao_esp32c5-kitsune' && rowK.mac === mac && /WiFi AP/.test(rowK.challenge), 'fleet row for the export carries MAC and challenge');
  // import a block of another tier back in
  await app(async () => { const v = window.foxbench.vendor; const b = v.parseHeader('#if defined(AP)\n#if defined(HARD)\n// RFHS_CHALLENGE_NAME "Imported Fox"\n// FOX_KEYWORDS "Hunter should ask \'Imported?\'"\n#define FSSID "Imported SSID"\n#define PSK "0123456789"\n#define MAC_ADDR {0xF2, 0x01, 0x02, 0x03, 0x04, 0x05}\n#define CHANNEL 0\n#define SSID_HIDDEN 1\n#define MAX_CLIENTS 2\n#define TIME_TO_WAKE 30\n#define TIME_TO_SLEEP 45\n#define TXPOWER WIFI_POWER_7dBm\n#endif\n#endif\n'); const part = v.cfgFromBlock(b[0], 'wifi-ap'); const m = structuredClone(window.foxbench.cfg); for (const [k, x] of Object.entries(part)) m[k] = { ...m[k], ...x }; await window.foxbench.loadCfg(m, { source: 'import' }); });
  await settle(300);
  const imp = await app(() => ({ ssid: window.foxbench.cfg.wifi.ssid, tier: window.foxbench.cfg.challenge.tier, hidden: window.foxbench.cfg.wifi.hidden, sleep: window.foxbench.cfg.schedule.sleep_s, p: window.foxbench.cfg.wifi.tx_power_dbm }));
  check(imp.ssid === 'Imported SSID' && imp.tier === 'hard' && imp.hidden === true && imp.sleep === 45 && imp.p === 7, 'a parsed header block loads into the form: ' + JSON.stringify(imp));
  // the firmware card: no hosted images on a checkout; a locally built merged image flashes through esptool (simulated),
  // the chip is checked against the descriptor before anything is erased, the fleet row carries the efuse MAC as UID
  await tab('board');
  check(/No kitsune images are hosted on this site/.test(await text('#tab-board')) && /Load merged \.bin/.test(await text('#tab-board')), 'firmware card says no hosted images and takes a merged .bin');
  await page.setInputFiles('#tab-board input[type=file][accept=".bin"]', { name: 'merged.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(8192, 0xe9) }); await settle(300);
  await app(() => { window.foxbenchFlash.simulate = true; window.foxbenchFlash.simulateChip = 'ESP32-C3 (QFN32) (revision v0.4)'; });
  await page.click('#tab-board button:has-text("Flash")'); await untilFleet("r.action === 'flash' && r.board === 'seeed_xiao_esp32c5-kitsune'");
  const badRow = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'flash' && r.board === 'seeed_xiao_esp32c5-kitsune').pop());
  check(badRow && /^fail: the port belongs to an ESP32-C3/.test(badRow.result), 'a C3 on the port with the C5 target selected is refused before the erase: ' + (badRow && badRow.result));
  await app(() => { window.foxbenchFlash.simulateChip = 'ESP32-C5'; });
  await page.click('#tab-board button:has-text("Flash")'); await untilFleet("r.action === 'flash' && r.board === 'seeed_xiao_esp32c5-kitsune' && r.result === 'ok'");
  const okRow = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'flash' && r.board === 'seeed_xiao_esp32c5-kitsune').pop());
  check(okRow && okRow.result === 'ok' && okRow.uid === '84f703123456' && /merged\.bin/.test(okRow.notes), 'the right chip flashes; fleet row keyed on the efuse MAC: ' + JSON.stringify(okRow && [okRow.result, okRow.uid]));
  const lastWrite = await app(() => window.foxbenchFlash.lastWrite?.());
  check(lastWrite && lastWrite.address === 0 && lastWrite.length === 8192, 'a merged image is written at 0x0 even though the C5\'s bootloader offset is 0x2000: ' + JSON.stringify(lastWrite));
  check(/rebooting into the kitsune firmware/.test(await text('#tab-board')), 'the result text is the kitsune one');
  await app(() => { window.foxbenchFlash.simulate = false; window.foxbenchFlash.simulateChip = ''; });
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(400);
  eq(await app(() => window.foxbench.family), 'foxlib', 'back to the C3 after kitsune');
  check(await page.isVisible('.rail button[data-tab="payload"]'), 'Payload tab back');

  console.log('catalog pack');
  await page.goto(url + '?pack=/tests/fixtures/pack/'); await page.waitForFunction(() => window.foxbench?.catalog); await settle(400);
  const pk = await app(() => window.foxbench.catalog.packs);
  check(pk.length === 1 && pk[0].name === 'example-pack' && pk[0].counts.boards === 1 && !pk[0].error, 'the example pack loads: ' + JSON.stringify(pk));
  check(await app(() => !!window.foxbench.catalog.boards['example_atom_clone-kitsune'] && window.foxbench.catalog.boards['example_atom_clone-kitsune']._pack === 'example-pack'), 'the pack\'s target is in the catalog, marked with the pack');
  await tab('board'); await page.selectOption('#tab-board select', 'example_atom_clone-kitsune'); await settle(500);
  eq(await app(() => window.foxbench.boardId), 'example_atom_clone-kitsune', 'the pack target can be selected');
  eq(await app(() => window.foxbench.defaults.board), 'example_atom_clone-kitsune', 'its defaults come from the pack (for a built-in template)');
  check(/catalog pack/.test(await text('#tab-board')) && /example-pack/.test(await text('#tab-board')), 'Board tab names the pack');
  await page.goto(url); await page.waitForFunction(() => window.foxbench?.catalog); await settle(400);
  check(await app(() => !window.foxbench.catalog.boards['example_atom_clone-kitsune']), 'without ?pack= the pack is gone, and the saved form for its target falls back');
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(400);
  await page.click('#demoBtn'); await settle(600);

  console.log('real transports over a fake Web Serial port (serial-link.js, connect/listen/follow/swap/drop, touch, UF2 copy)');
  await app(() => window.foxbench.disconnect()); await settle(200);
  await page.addScriptTag({ type: 'module', url: url + 'tests/page/fake-serial.mjs' }); await page.waitForFunction(() => !!window.__fakeSerial);
  // 1. Connect to a CircuitPython board over the REPL, deploy a template through it, then unplug it.
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(300);
  await app(() => window.__fakeSerial.install('board', { running: true, noise: true, noiseMs: 50, ansi: true, chunk: 17, latency: 2, files: { 'foxlib/__init__.py': '# old\n', 'foxlib/VERSION': '0.9.0\n' } }));
  await page.click('#connectBtn'); await until(() => window.foxbench.connected && window.foxbench.info.uid === '85c818eae840', 'the REPL connect to finish', 20000);
  eq(await app(() => window.foxbench.device?.kind), 'repl', 'a ReplDevice on a SerialLink');
  eq(await app(() => window.__fakeSerial.port.baud), 115200, 'port opened at 115200');
  check(/foxlib/.test(await text('#tab-board')), 'Board tab read the board\'s foxlib version over the real link');
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'morse-songs'); await settle(200);
  await tab('id'); await page.fill('#tab-id input[type=text]', 'W1ABC FOX DE W1ABC'); await settle(200);
  await tab('deploy'); await page.check('#tab-deploy .gate input'); await settle(200);
  const why = await app(() => ({ blocker: window.foxbench.deployBlocker(), errs: window.foxbench.issues.filter(i => i.level === 'err').map(i => i.msg), last: window.foxbench.lastDeploy }));
  check(!why.blocker && !why.errs.length, 'nothing blocks the deploy over the fake REPL: ' + JSON.stringify(why));
  await app(() => { window.foxbench.lastDeploy = null; });
  await page.click('#tab-deploy button.btn.primary'); await until(() => !!window.foxbench.lastDeploy, 'the deploy over the fake REPL to finish', 30000); await settle(200);
  const fsAfter = await app(() => window.__fakeSerial.files());
  check('code.py' in fsAfter && 'fox.json' in fsAfter && /morse-songs/.test(fsAfter['fox.json'] || ''), 'deploy wrote code.py and fox.json through the REPL protocol onto the fake board: ' + Object.keys(fsAfter).filter(k => !k.startsWith('foxlib/')).join(', '));
  check((fsAfter['foxlib/VERSION'] || '').trim() !== '0.9.0', 'foxlib on the board was updated from 0.9.0');
  check(await untilFleet("r.action === 'deploy' && r.uid === '85c818eae840'"), 'fleet row carries the board\'s uid');
  await app(() => window.__fakeSerial.port.drop()); await settle(500);
  eq(await app(() => window.foxbench.connected), false, 'unplugging the port disconnects the page');
  check(/serial port dropped/.test(await text('#log')), 'the console says the port dropped');
  // 2. Listen only with a fox-bench PicoFox on the port while the XIAO is selected: the banner is followed, the device swapped.
  await app(() => window.__fakeSerial.install('console', { uid: 'e4654c16431b2321', callsign: 'KY4ZR TEST', vid: 0x2e8a, pid: 0x000a }));
  await page.click('#listenBtn'); await until(() => window.foxbench.boardId === 'picofox-foxlibc' && window.foxbench.device?.kind === 'console', 'the banner to be followed and the device swapped', 15000);
  eq(await app(() => window.foxbench.family), 'foxlib-c', 'family followed the banner');
  check(/banner says picofox-foxlibc: selecting that board/.test(await text('#log')), 'console explains the switch');
  check(await app(() => window.foxbench.device.listening === true), 'still listening after the swap');
  await tab('board'); await page.selectOption('#tab-board select', 'picofox-vendor'); await settle(400);
  eq(await app(() => window.foxbench.connected), true, 'selecting the vendor target keeps the listen-only port');
  check(/same serial port, still listening/.test(await text('#log')), 'console says the port was kept');
  eq(await app(() => window.foxbench.device?.kind), 'repl', 'the vendor target listens with the line device');
  await page.selectOption('#tab-board select', 'picofox-foxlibc'); await settle(400);
  eq(await app(() => window.foxbench.device?.kind), 'console', 'and back to the console device for the fox-bench target');
  await page.fill('#sendInput', 'status'); await page.press('#sendInput', 'Enter'); await untilTextArgs('#log', /revision=3/, 5000);
  eq(((await text('#log')).match(/> status/g) || []).length, 1, 'a typed console command is shown once');
  eq(await app(() => window.__fakeSerial.link.sent.filter(l => l === 'status').length), 1, 'and sent once');
  await app(() => window.foxbench.disconnect()); await settle(200);
  // 3. The 1200-baud touch: the fox's port (ids match, the port goes away) and a wrong port (ids differ, stays).
  await app(() => window.__fakeSerial.install('dumb', { vid: 0x2e8a, pid: 0x000a, disappearOnTouch: true }));
  await tab('board'); await page.click('#tab-board button:has-text("1. Reboot into bootloader")'); await untilTextArgs('#log', /1200-baud touch sent, port gone/, 8000);
  check(/touching port USB 2e8a:000a \(AI6YM PicoFox, fox-bench firmware\) at 1200 baud/.test(await text('#log')), 'touch names the matched USB id');
  const sig = await app(() => window.__fakeSerial.port.signals);
  check(sig.length === 2 && sig[0].baud === 1200 && sig[0].dataTerminalReady === true && sig[1].dataTerminalReady === false, 'DTR raised then dropped at 1200 baud: ' + JSON.stringify(sig));
  check(await app(() => window.__fakeSerial.port.closedByPage), 'the port was closed after the touch');
  await app(() => window.__fakeSerial.install('dumb', { vid: 0x1a86, pid: 0x7523, disappearOnTouch: false }));
  await page.click('#tab-board button:has-text("1. Reboot into bootloader")'); await untilTextArgs('#log', /still there after 4 s/, 10000);
  check(/the port picked is USB 1a86:7523, not one of the AI6YM PicoFox/.test(await text('#log')), 'a wrong port is named before the touch and the verdict says the board did not reboot');
  // 4. A UF2 loaded by hand: version tag read; untagged flagged as old. Then the copy onto a fake RPI-RP2 drive, and onto the wrong drive.
  const mkUf2 = tag => { const n = 3, out = Buffer.alloc(512 * n); for (let i = 0; i < n; i++) { const o = i * 512; out.writeUInt32LE(0x0A324655, o); out.writeUInt32LE(0x9E5D5157, o + 4); out.writeUInt32LE(0x2000, o + 8); out.writeUInt32LE(0x10000000 + i * 256, o + 12); out.writeUInt32LE(256, o + 16); out.writeUInt32LE(i, o + 20); out.writeUInt32LE(n, o + 24); out.writeUInt32LE(0xe48bff56, o + 28); out.writeUInt32LE(0x0AB16F30, o + 508); } if (tag) out.write(tag + '\0', 32 + 100, 'latin1'); return out; };
  await page.setInputFiles('#tab-board input[type=file][accept=".uf2"]', { name: 'old.uf2', mimeType: 'application/octet-stream', buffer: mkUf2('') }); await settle(300);
  check(/old\.uf2 is an untagged build; this site builds/.test(await text('#log')) && /untagged build/.test(await text('#tab-board')), 'an untagged (pre-0.1.9) UF2 is flagged as older than the site\'s build');
  await page.setInputFiles('#tab-board input[type=file][accept=".uf2"]', { name: 'cur.uf2', mimeType: 'application/octet-stream', buffer: mkUf2('FOXLIBC-VERSION:9.9.9') }); await settle(300);
  check(/foxlib-c 9\.9\.9/.test(await text('#tab-board')) && !/untagged build/.test(await text('#tab-board')), 'a tagged UF2 shows its version');
  await app(() => {
    const mk = (files, { vanishAfterWrite = false } = {}) => { let written = false; const fh = n => ({ kind: 'file', name: n, getFile: async () => new File([files[n] || ''], n), createWritable: async () => ({ write: async () => { written = true; }, close: async () => { if (vanishAfterWrite) throw new DOMException('gone', 'NotFoundError'); } }) });
      return { kind: 'directory', name: '\\', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        values: async function* () { if (vanishAfterWrite && written) throw new DOMException('gone', 'NotFoundError'); for (const n of Object.keys(files)) yield fh(n); },
        getFileHandle: async (n, o) => { if (!(n in files) && !o?.create) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } files[n] = files[n] || ''; return fh(n); } }; };
    window.__drives = { rpi: mk({ 'INFO_UF2.TXT': 'UF2 Bootloader v3.0\nModel: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n', 'INDEX.HTM': '' }, { vanishAfterWrite: true }), fox: mk({ 'fox.json': '{}', 'settings.txt': '' }) };
    window.showDirectoryPicker = async () => window.__drives.fox;
  });
  await page.click('#tab-board button:has-text("2. Copy to RPI-RP2")'); await untilTextArgs('#log', /UF2 copy failed/, 5000);
  check(/not the RPI-RP2 bootloader drive \(no INFO_UF2\.TXT; it holds FOX\.JSON, SETTINGS\.TXT\) — it is the fox's own drive/.test(await text('#log')), 'copying onto the fox\'s own drive is refused by content');
  await app(() => { window.showDirectoryPicker = async () => window.__drives.rpi; });
  await page.click('#tab-board button:has-text("2. Copy to RPI-RP2")'); await untilFleet("r.action === 'flash' && r.result === 'ok' && /cur\\.uf2/.test(r.notes)", 15000);
  check(/cur\.uf2 flashed .*the RPI-RP2 drive went away, so the board rebooted into it/.test(await text('#log')), 'the copy succeeds when the bootloader drive vanishes mid-close (the close() error is tolerated)');
  check(/close\(\) said "gone"/.test(await text('#log')), 'the close() error is reported, not treated as failure');
  await app(() => { delete window.__drives; });
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(400);
  await page.click('#demoBtn'); await settle(600);

  console.log('hosted images: the CI-written fingerprint and kitsune manifest, served by the test server');
  const { createHash } = await import('node:crypto');
  const sha = b => createHash('sha256').update(b).digest('hex');
  const hostedUf2 = mkUf2('FOXLIBC-VERSION:9.9.9'), kImage = Buffer.alloc(8192, 0xe9);
  overrides.set('/firmware/foxlib-c/picofox/foxbench-picofox.uf2', { body: hostedUf2 });
  overrides.set('/firmware/foxlib-c/picofox/foxbench-picofox.json', { body: JSON.stringify({ name: 'foxbench-picofox.uf2', version: '9.9.9', version_tag: '9.9.9', commit: 'abc1234def', pico_sdk: 'bddd20f9', gcc: 'arm-none-eabi-gcc 15.2.1', sha256: sha(hostedUf2), size: hostedUf2.length, text: 1, bss: 1, built: '2026-10-22T00:00:00Z' }), type: 'application/json' });
  overrides.set('/firmware/kitsune/manifest.json', { body: JSON.stringify({ project: 'kitsune', source: 'https://github.com/rfhs/kitsune', commit: '0123456789abcdef0123456789abcdef01234567', built: '', tools: { platformio: '6.1.18', esptool: '4.8.1' }, note: 'smoke fixture',
    images: [{ board: 'm5stack_atom_lite-kitsune', template: 'wifi-ap', tier: 'easy', mode: 'AP', env: 'm5atom-easy-ap', file: 'm5atom-easy-ap.bin', sha256: sha(kImage), size: kImage.length, chip: 'esp32', offset: '0x0' }] }), type: 'application/json' });
  overrides.set('/firmware/kitsune/m5atom-easy-ap.bin', { body: kImage });
  await page.goto(url); await page.waitForFunction(() => window.foxbench?.catalog); await settle(400);   // the cards cache "no file on this site" per page load
  await tab('board'); await page.selectOption('#tab-board select', 'picofox-foxlibc'); await untilTextArgs('#tab-board', /Hosted build: c-9\.9\.9 · commit abc1234/, 5000);
  check(/Hosted build: c-9\.9\.9 · commit abc1234 · arm-none-eabi-gcc 15\.2\.1 · pico-sdk bddd20f/.test(await text('#tab-board')), 'the Board tab shows the fingerprint CI wrote');
  await page.click('#tab-board button:has-text("Get fox-bench firmware")'); await untilTextArgs('#log', /fetched foxbench-picofox\.uf2 .*= pinned/, 5000);
  check(/= pinned\) — fox-bench firmware c-9\.9\.9 built from this site's source at abc1234/.test(await text('#log')), 'a fetched image that matches the fingerprint is accepted and labelled with the build');
  check(/foxbench-picofox\.uf2 .*fox-bench firmware · foxlib-c 9\.9\.9/.test(await text('#tab-board')), 'the card shows the image with its in-image version');
  overrides.set('/firmware/foxlib-c/picofox/foxbench-picofox.uf2', { body: mkUf2('FOXLIBC-VERSION:9.9.8') });   // the site mid-deploy: a different UF2 under the same fingerprint
  await page.click('#tab-board button:has-text("Get fox-bench firmware")'); await untilTextArgs('#log', /firmware fetch failed: foxbench-picofox\.uf2 rejected/, 5000);
  check(/rejected: .*sha256 .*mid-deploy: reload the page and try again/.test(await text('#log')), 'an image whose sha256 differs from the fingerprint is refused with the mid-deploy hint');
  await page.selectOption('#tab-board select', 'm5stack_atom_lite-kitsune'); await settle(300);
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'wifi-ap'); await settle(300);
  await tab('board'); await untilTextArgs('#tab-board', /Get easy wifi-ap/, 5000);
  check(/Images for the M5Stack ATOM Lite \(kitsune firmware\) and the Wi-Fi access point/.test(await text('#tab-board')) && /built from kitsune at 0123456/.test(await text('#tab-board')), 'the firmware card lists the manifest\'s image for this board × template');
  await page.click('#tab-board button:has-text("Get easy wifi-ap")'); await untilTextArgs('#log', /fetched m5atom-easy-ap\.bin .*= manifest/, 5000);
  check(/m5atom-easy-ap\.bin · 8 kB · from this site/.test(await text('#tab-board')), 'the fetched kitsune image is loaded and marked as the site\'s');
  overrides.set('/firmware/kitsune/m5atom-easy-ap.bin', { body: Buffer.alloc(8192, 0xea) });
  await page.click('#tab-board button:has-text("Get easy wifi-ap")'); await untilTextArgs('#log', /image fetch failed: sha256 .* does not match the manifest's/, 5000);
  check(/does not match the manifest's .*a deploy may be in progress/.test(await text('#log')), 'a kitsune image whose sha256 differs from the manifest is refused');
  await app(() => { window.foxbenchFlash.simulate = true; window.foxbenchFlash.simulateChip = 'ESP32-PICO-D4 (revision v1.0)'; });
  await tab('board'); await page.selectOption('#tab-board select', 'm5stack_atom_lite-kitsune'); await settle(200);
  await page.click('#tab-board button:has-text("Get easy wifi-ap")');   // re-fetch the bad one fails; the good image from before is still loaded
  await settle(500);
  overrides.set('/firmware/kitsune/m5atom-easy-ap.bin', { body: kImage });
  await page.click('#tab-board button:has-text("Get easy wifi-ap")'); await untilTextArgs('#log', /fetched m5atom-easy-ap\.bin .*= manifest/, 5000);
  await page.click('#tab-board button:has-text("Flash")'); await untilFleet("r.action === 'flash' && r.board === 'm5stack_atom_lite-kitsune' && r.result === 'ok'", 15000);
  const kw = await app(() => window.foxbenchFlash.lastWrite?.());
  check(kw && kw.address === 0 && kw.length === 8192, 'the site\'s merged image is written at 0x0 on the ATOM Lite (bootloader offset 0x1000 is inside it): ' + JSON.stringify(kw));
  check(/SIMULATED flash \(test mode\)/.test(await text('#log')), 'a simulated flash says so in the log');
  await app(() => { window.foxbenchFlash.simulate = false; window.foxbenchFlash.simulateChip = ''; });
  for (const k of [...overrides.keys()]) overrides.delete(k);

  console.log('local artifact manifest; the bench\'s three stand-in targets (C5 FireBeetle, S3-Nano, C6)');
  await page.goto(url); await page.waitForFunction(() => window.foxbench?.catalog); await settle(400);   // no hosted manifest now
  await tab('board'); await page.selectOption('#tab-board select', 'dfrobot_firebeetle2_esp32c5-kitsune'); await settle(300);
  await tab('behavior'); await page.selectOption('#tab-behavior select', 'wifi-ap'); await settle(300);
  await tab('board'); await untilTextArgs('#tab-board', /No kitsune images are hosted on this site/, 5000);
  check(/Open artifact folder…/.test(await text('#tab-board')), 'the card offers the CI artifact folder when nothing is hosted');
  // the artifact as a fake directory handle: manifest.json + images for the three stand-ins
  const c5img = Buffer.alloc(16384, 0xc5), s3img = Buffer.alloc(12288, 0x53), c6img = Buffer.alloc(8192, 0xc6);
  const localMan = { project: 'kitsune', source: 'https://github.com/rfhs/kitsune', commit: 'cdfc0ce39d3d68e44041a3c356c889631d48ade3', built: '2026-10-23T00:00:00Z', tools: { platformio: '6.1.18', esptool: '4.8.1' },
    conference: 'fox-bench bench values (firmware/kitsune/bench), not any event\'s configuration', images: [
      { board: 'dfrobot_firebeetle2_esp32c5-kitsune', template: 'wifi-ap', tier: 'easy', mode: 'AP', env: 'seeed-xiao-esp32c5-easy-ap', file: 'seeed-xiao-esp32c5-easy-ap.bin', sha256: sha(c5img), size: c5img.length, chip: 'esp32c5', offset: '0x0' },
      { board: 'waveshare_esp32s3_nano-kitsune', template: 'wifi-ap', tier: 'easy', mode: 'AP', env: 'arduino-nano-esp32-easy-ap', file: 'arduino-nano-esp32-easy-ap.bin', sha256: sha(s3img), size: s3img.length, chip: 'esp32s3', offset: '0x0' },
      { board: 'seeed_xiao_esp32c6-kitsune', template: 'wifi-ap', tier: 'easy', mode: 'AP', env: 'fb-seeed-xiao-esp32c6-easy-ap', file: 'fb-seeed-xiao-esp32c6-easy-ap.bin', sha256: sha(c6img), size: c6img.length, chip: 'esp32c6', offset: '0x0' },
      { board: 'seeed_xiao_esp32c6-kitsune', template: 'wifi-client', tier: 'easy', mode: 'CLIENT', env: 'fb-seeed-xiao-esp32c6-easy-client', file: 'missing.bin', sha256: sha(c6img), size: c6img.length, chip: 'esp32c6', offset: '0x0' } ] };
  await app(({ man, files }) => {
    const bytes = Object.fromEntries(Object.entries(files).map(([n, hex]) => [n, Uint8Array.from(hex.match(/../g).map(x => parseInt(x, 16)))]));
    const all = { 'manifest.json': new TextEncoder().encode(JSON.stringify(man)), ...bytes };
    const fh = n => ({ kind: 'file', name: n, getFile: async () => new File([all[n]], n) });
    window.showDirectoryPicker = async () => ({ kind: 'directory', name: 'kitsune-images', values: async function* () { for (const n of Object.keys(all)) yield fh(n); } });
  }, { man: localMan, files: { 'seeed-xiao-esp32c5-easy-ap.bin': c5img.toString('hex'), 'arduino-nano-esp32-easy-ap.bin': s3img.toString('hex'), 'fb-seeed-xiao-esp32c6-easy-ap.bin': c6img.toString('hex') } });
  await page.click('#tab-board button:has-text("Open artifact folder…")'); await untilTextArgs('#log', /local kitsune manifest: 4 image\(s\), kitsune at cdfc0ce/, 5000);
  check(/1 image file\(s\) not among the files picked: missing\.bin/.test(await text('#log')), 'a manifest entry whose file is absent is named');
  check(/local artifact kitsune-images/.test(await text('#tab-board')) && /Get easy wifi-ap/.test(await text('#tab-board')), 'the card lists the local artifact\'s image for the C5 stand-in');
  await app(() => { window.foxbenchFlash.simulate = true; });
  const stand = [['dfrobot_firebeetle2_esp32c5-kitsune', 'ESP32-C5', 'ESP32-C3 (QFN32) (revision v0.4)', 16384], ['waveshare_esp32s3_nano-kitsune', 'ESP32-S3 (QFN56) (revision v0.2)', 'ESP32-C6 (QFN40)', 12288], ['seeed_xiao_esp32c6-kitsune', 'ESP32-C6 (QFN40)', 'ESP32-S3 (QFN56) (revision v0.2)', 8192]];
  for (const [id, rightChip, wrongChip, size] of stand) {
    await tab('board'); await page.selectOption('#tab-board select', id); await settle(300);
    await untilTextArgs('#tab-board', /Get easy wifi-ap/, 5000);
    await page.click('#tab-board button:has-text("Get easy wifi-ap")'); await untilTextArgs('#log', new RegExp(`loaded \\S+\\.bin .*= manifest.*local artifact`), 5000);
    await app(c => { window.foxbenchFlash.simulateChip = c; }, wrongChip);
    await page.click('#tab-board button:has-text("Flash")'); await untilFleet(`r.action === 'flash' && r.board === '${id}'`, 15000);
    const bad = await app(i => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'flash' && r.board === i).pop(), id);
    check(/^fail: the port belongs to an ESP32-/.test(bad.result), `${id}: the wrong chip on the port is refused before the erase (${bad.result.slice(0, 60)})`);
    await app(c => { window.foxbenchFlash.simulateChip = c; }, rightChip);
    await page.click('#tab-board button:has-text("Flash")'); await untilFleet(`r.action === 'flash' && r.board === '${id}' && r.result === 'ok'`, 15000);
    const w = await app(() => window.foxbenchFlash.lastWrite?.());
    check(w && w.address === 0 && w.length === size, `${id}: the merged image is written at 0x0 (${JSON.stringify(w)})`);
  }
  await app(() => { window.foxbenchFlash.simulate = false; window.foxbenchFlash.simulateChip = ''; delete window.showDirectoryPicker; });
  // a page whose saved working form is a kitsune target must boot (every tab renders at boot, before the ID tab's init)
  const savedKitsune = await app(() => window.foxbench.boardId);
  for (const t of ['radio', 'plan', 'schedule', 'deploy']) {
    await tab(t);
    await page.goto(url); const booted = await until(id => window.foxbench?.catalog && window.foxbench.boardId === id, `boot with a saved kitsune form on the ${t} tab`, 5000, savedKitsune);
    check(booted, `reload with a kitsune target saved and the ${t} tab open boots`);
  }
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(400);
  await page.click('#demoBtn'); await settle(600);

  console.log('two tabs; undo a banner-follow');
  // a second tab saving its form makes this one stop overwriting the saved form until it is edited here
  const page2 = await page.context().newPage(); await page2.goto(url); await page2.waitForFunction(() => window.foxbench?.catalog); await page2.waitForTimeout(300);
  await page2.click('.rail button[data-tab="id"]'); await page2.fill('#tab-id input[type=text]', 'W9XYZ OTHER TAB'); await page2.waitForTimeout(300);
  check(await untilTextArgs('#log', /another fox-bench tab just saved its form/, 5000), 'this tab noticed the other tab\'s save');
  eq(await app(() => window.foxbench._yieldSave), true, 'and yields the saved form');
  await tab('id'); await page.fill('#tab-id input[type=text]', 'KY4ZR BACK'); await settle(300);
  eq(await app(() => window.foxbench._yieldSave), false, 'an edit here takes the saved form back');
  eq(await app(() => JSON.parse(localStorage.getItem('fox-bench.working')).cfg.id.callmessage), 'KY4ZR BACK', 'and the saved form is this tab\'s again');
  await page2.close();
  // W6: following a banner keeps the form that was there; undoFollow() restores it
  await app(() => window.foxbench.disconnect()); await settle(200);
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(300);
  if (!(await app(() => !!window.__fakeSerial))) await page.addScriptTag({ type: 'module', url: url + 'tests/page/fake-serial.mjs' });   // the page was reloaded since the fixture was loaded
  await page.waitForFunction(() => !!window.__fakeSerial);
  await app(() => window.__fakeSerial.install('console', { uid: 'e4654c16431b2321', callsign: 'KY4ZR TEST', vid: 0x2e8a, pid: 0x000a }));
  await page.click('#listenBtn'); await until(() => window.foxbench.boardId === 'picofox-foxlibc', 'banner follow', 10000);
  check(/the form you had is kept: window\.foxbench\.undoFollow\(\)/.test(await text('#log')), 'the follow says how to get the form back');
  await app(() => window.foxbench.disconnect()); await settle(200);
  await app(() => window.foxbench.undoFollow()); await settle(400);
  eq(await app(() => window.foxbench.boardId), 'seeed_xiao_esp32c3', 'undoFollow restores the board');
  eq(await app(() => window.foxbench.cfg.id.callmessage), 'KY4ZR BACK', 'and the config');
  await page.click('#demoBtn'); await settle(600);   // the last section expects the demo to be connected

  console.log('theme, disconnect');
  await page.click('#themeBtn'); await settle(100);
  check(['light', 'dark'].includes(await page.getAttribute('html', 'data-theme')), 'theme toggles');
  await page.click('#demoBtn'); await settle(400);
  eq(await app(() => window.foxbench.connected), false, 'demo disconnects');
  for (const t of TABS) await tab(t);
} catch (e) {
  failures++; console.log('  FAIL exception: ' + (e.stack || e));
} finally {
  const real = [...new Set(errors)].filter(e => !/^error: Failed to load resource/.test(e))   // those are reported with their URL by the response/requestfailed listeners
    .filter(e => !/http 404 .*(foxbench-picofox\.json|firmware\/kitsune\/manifest\.json)$/.test(e));   // the build fingerprint and the kitsune manifest exist only on a deployed site (CI writes them); the page says so
  if (real.length) { failures += real.length; console.log('console errors:\n  ' + real.join('\n  ')); } else console.log('  ok   no console errors or warnings');
  await browser.close(); await close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
}
