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
const TABS = ['connect', 'board', 'radio', 'plan', 'id', 'payload', 'schedule', 'deploy', 'bench', 'fleet', 'about'];

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
/** Unpack a deploy-set zip into a temp dir and boot it in the firmware simulator. Returns the sim's stdout, or throws. */
async function bootInSimulator(entries, label) {
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { execFile } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'fox-export-'));
  for (const e of entries) { await mkdir(dirname(join(dir, e.name)), { recursive: true }); await writeFile(join(dir, e.name), e.data); }
  return new Promise((res, rej) => execFile('python3', [join(ROOT, 'firmware/sim/run.py'), '--deploy-set', dir], { timeout: 120000 }, (err, stdout, stderr) => err ? rej(new Error(`${label}: simulator failed\n${stdout}${stderr}`)) : res(stdout)));
}

const { url, close } = await serve(ROOT);
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
const tab = async name => { await page.click(`.rail button[data-tab="${name}"]`); await settle(150); if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const text = sel => page.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim());
const app = fn => page.evaluate(fn);

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
  check(await page.isDisabled('#tab-deploy button.btn.primary'), 'deploy disabled while callsign unset');
  await tab('id');
  await page.fill('#tab-id input[type=text]', 'W1ABC FOX DE W1ABC'); await settle(200);
  eq(await app(() => window.foxbench.cfg.id.callmessage), 'W1ABC FOX DE W1ABC', 'callsign stored without losing focus');
  check(await page.evaluate(() => document.activeElement && document.activeElement.type === 'text'), 'focus kept in the callsign input after re-render');

  console.log('every template deploys on the demo board');
  for (const id of templates) {
    await tab('connect');
    await page.selectOption('#tab-connect select', id); await settle(300);
    for (const t of TABS) await tab(t);
    await tab('deploy');
    await page.check('#tab-deploy .gate input');
    await page.click('#tab-deploy button.btn.primary'); await settle(2500);
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
  await page.click('#tab-bench button:has-text("Read RSSI")'); await settle(500);
  check(/rssi\s+\d+/.test(await text('#tab-bench pre.out')), 'RSSI logged');
  await page.click('#tab-bench button:has-text("Key")'); await settle(3600);   // demo keys for the configured 3 s
  check(/key\s+ok/.test(await text('#tab-bench pre.out')), 'key test logged ok');
  await tab('radio');
  await page.click('#tab-radio button:has-text("Probe")'); await settle(500);
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
  await settle(2500);
  check(/Flashed in .* ESP32-C3.*MAC 84:f7:03:12:34:56/.test(await text('#tab-board')), 'demo flash reports chip and MAC');
  let flashRows = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'flash'));
  check(flashRows.length === 1 && flashRows[0].uid === '84f703123456' && /10\.2\.1\.bin/.test(flashRows[0].notes) && flashRows[0].result === 'ok', 'fleet row for the flash keyed on the MAC');
  await tab('fleet');
  check(/Flash board #1/.test(await text('#tab-fleet')), 'batch card starts at board #1');
  await page.click('#tab-fleet button:has-text("Flash board #1")'); await settle(3000);
  check(/Flash board #2/.test(await text('#tab-fleet')), 'batch number advances after a flash');
  flashRows = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.action === 'flash'));
  check(flashRows.length === 2 && String(flashRows[1].board_number) === '1', 'batch row carries the board number');
  check(/flash/.test(await text('#tab-fleet table')), 'fleet table shows the flash rows');

  console.log('payload: library, SSTV, spectrum');
  await tab('connect'); await page.selectOption('#tab-connect select', 'morse-songs'); await settle(300);
  await tab('payload');
  const before = await app(() => window.foxbench.cfg.payload.playlist.length);
  await page.fill('#tab-payload input[placeholder="filter…"]', 'yank'); await settle(200);
  await page.click('#tab-payload ul.list li button:has-text("+ add")'); await settle(200);
  eq(await app(() => window.foxbench.cfg.payload.playlist.length), before + 1, 'library song added to the playlist');
  check(await page.$('#tab-payload canvas'), 'trace canvas drawn');
  await tab('connect'); await page.selectOption('#tab-connect select', 'composite'); await settle(300);
  await tab('payload'); await page.selectOption('#tab-payload select', 'sstv'); await settle(600);
  check((await page.$$('#tab-payload canvas')).length >= 2, 'SSTV preview draws decode canvases');
  const xs = await page.$$('#tab-payload button[title="remove"]');
  if (xs.length) { await xs[0].click(); await settle(200); }
  check(/no images/i.test(await text('#tab-payload')) || (await app(() => window.foxbench.images.length)) > 0, 'removing the only SSTV card warns instead of refusing');
  await tab('schedule'); await page.selectOption('#tab-schedule select', 'resurrection'); await settle(300);
  check(await page.$('#tab-schedule canvas'), 'schedule timeline drawn');

  console.log('out-of-band override');
  await tab('connect'); await page.selectOption('#tab-connect select', 'morse-songs'); await settle(300);
  await tab('plan');
  await page.click('#tab-plan button.btn.small:has-text("+ Add frequency")'); await settle(150);
  const inputs = await page.$$('#tab-plan .list input[type=number]');
  await inputs.at(-1).fill('150'); await inputs.at(-1).dispatchEvent('change'); await settle(200);
  badges = await page.$$eval('#tab-plan .list .badge', els => els.map(e => e.textContent));
  check(badges.some(b => /outside the US bands/.test(b)), 'out-of-band entry flagged red, not refused');
  await tab('deploy');
  check(!(await page.isDisabled('#tab-deploy button.btn.primary')) || !(await page.isChecked('#tab-deploy .gate input')), 'out-of-band does not block deploy');
  page.removeAllListeners('dialog');
  let dialog = null; page.once('dialog', async d => { dialog = d.message(); await d.accept(); });
  await page.check('#tab-deploy .gate input'); await page.click('#tab-deploy button.btn.primary'); await settle(2500);
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
  await tab('connect'); await page.selectOption('#tab-connect select', 'morse-sstv'); await settle(300);
  await tab('payload'); await page.click('#tab-payload button:has-text("Add test card")'); await settle(400);
  await tab('deploy'); page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export deploy set")')]);
  const entries2 = zipEntries(new Uint8Array(await (await import('node:fs/promises')).readFile(await dl2.path())));
  check(entries2.some(e => e.name === 'images.bin' && e.data.length > 100), 'SSTV export contains images.bin');
  try { const sim = await bootInSimulator(entries2, 'morse-sstv export'); check(/deploy set boots/.test(sim), 'SSTV export boots in the simulator'); }
  catch (e) { check(false, e.message.split('\n').slice(0, 6).join(' | ')); }
  await tab('connect'); await page.selectOption('#tab-connect select', 'morse-songs'); await settle(300); await tab('deploy');
  page.on('dialog', d => d.dismiss());

  console.log('profiles');
  await page.fill('#tab-deploy input[type=text]', 'smoke profile');
  await page.click('#tab-deploy button:has-text("Save profile")'); await settle(200);
  await tab('fleet');
  check(/smoke profile/.test(await text('#tab-fleet ul.list')), 'profile saved from Deploy appears in Fleet');
  await page.click('#tab-fleet ul.list li:has-text("smoke profile") button:has-text("Load")'); await settle(300);
  eq(await app(() => window.foxbench.cfg.fleet.profile), 'smoke profile', 'profile loads back');

  console.log('diagnostics');
  const diag = await app(() => window.foxbench.diagnostics());
  check(diag.page.version && diag.catalog.foxlib && diag.cfg && diag.device?.kind === 'demo', 'diagnostics carries page, catalog, cfg, device');
  check(diag.lastDeploy && diag.lastDeploy.banner && diag.bench.length >= 2 && diag.console.length > 10, 'diagnostics carries last deploy, bench events, console');
  check(JSON.stringify(diag).length < 2_000_000, 'diagnostics is a reasonable size');
  await tab('connect');
  const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-connect button:has-text("Download diagnostics")')]);
  check(/fox-bench-diagnostics-.*\.json/.test(dl3.suggestedFilename()), 'diagnostics downloads as JSON');

  console.log('PicoFox (drive family)');
  await page.click('#demoBtn'); await settle(300);                       // leave the C3 demo
  await tab('board');
  await page.selectOption('#tab-board select', 'picofox'); await settle(400);
  eq(await app(() => window.foxbench.family), 'drive', 'family switches with the board');
  eq(await app(() => window.foxbench.templateId), 'picofox', 'template switched to the board\'s only template');
  eq(await app(() => window.foxbench.cfg.id.callmessage), 'W1ABC FOX DE W1ABC', 'callsign carried across the board switch');
  check(/does not run CircuitPython/.test(await text('#tab-board')), 'Board tab says no CircuitPython');
  check(!(await page.$('#tab-board button:has-text("Flash CircuitPython")')), 'no Flash CircuitPython button for the PicoFox');
  check(/silently dropped/.test(await text('#tab-board')) && /DUTY_CYCLE of 0/.test(await text('#tab-board')), 'firmware quirks listed on the Board tab');
  check(await page.isHidden('.rail button[data-tab="bench"]'), 'Bench tab hidden');
  eq(await text('#connectBtn'), 'Open PicoFox', 'Connect button names the drive');
  await tab('connect');
  const opts = await page.$$eval('#tab-connect select option', els => els.map(e => e.value));
  check(opts.length === 1 && opts[0] === 'picofox', 'template dropdown filtered to the board\'s templates (' + opts.join(',') + ')');
  for (const t of ['radio', 'plan', 'id', 'payload', 'schedule', 'deploy', 'fleet', 'about']) await tab(t);
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
  await tab('connect');
  check(/no callsign — silent/.test(await text('#tab-connect')), 'factory drive shows an empty callsign');
  await tab('deploy');
  check(/settings\.txt/.test(await text('#tab-deploy')) && /\.callsign\.wav/.test(await text('#tab-deploy')) && /\.settings_crc\.bin/.test(await text('#tab-deploy')), 'deploy lists the four files');
  await page.check('#tab-deploy .gate input'); await page.click('#tab-deploy button.btn.primary'); await settle(1500);
  check(/files written and read back/.test(await text('#tab-deploy')), 'files written to the demo drive');
  const onDrive = await app(async () => { const d = window.foxbench.device; const l = await d.list(''); const s = await d.readText('settings.txt'); return { names: Object.keys(l).sort(), s, markerOk: window.foxbench.onBoard.markerOk }; });
  check(onDrive.names.join() === '.callsign.wav,.settings_crc.bin,audio.wav,settings.txt' && /CALLSIGN=KY4ZR\n/.test(onDrive.s) && /DUTY_CYCLE=50\n/.test(onDrive.s) && onDrive.markerOk === true, 'drive holds the four files, settings as configured, marker matching');
  page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#tab-deploy button:has-text("Export files")')]);
  const pfNames = zipEntries(new Uint8Array(await (await import('node:fs/promises')).readFile(await dlp.path()))).map(e => e.name);
  check(['settings.txt', 'audio.wav', '.callsign.wav', '.settings_crc.bin', 'README.txt'].every(n => pfNames.includes(n)), 'PicoFox zip has the four files + README');
  page.on('dialog', d => d.dismiss());
  const row = await app(() => JSON.parse(localStorage.getItem('fox-bench.fleet') || '[]').filter(r => r.board === 'picofox' && r.action === 'deploy').pop());
  check(row && row.result === 'written' && /dBm/.test(row.power), 'fleet row for the PicoFox deploy');
  await page.click('#demoBtn'); await settle(300);
  await tab('board'); await page.selectOption('#tab-board select', 'seeed_xiao_esp32c3'); await settle(400);
  eq(await app(() => window.foxbench.family), 'foxlib', 'back to the C3: family foxlib');
  check(await page.isVisible('.rail button[data-tab="bench"]'), 'Bench tab back');
  check((await page.$$eval('#tab-connect select option', els => els.length)) >= 7, 'template dropdown back to the foxlib set');
  await page.click('#demoBtn'); await settle(600);

  console.log('theme, disconnect');
  await page.click('#themeBtn'); await settle(100);
  check(['light', 'dark'].includes(await page.getAttribute('html', 'data-theme')), 'theme toggles');
  await page.click('#demoBtn'); await settle(400);
  eq(await app(() => window.foxbench.connected), false, 'demo disconnects');
  for (const t of TABS) await tab(t);
} catch (e) {
  failures++; console.log('  FAIL exception: ' + (e.stack || e));
} finally {
  const real = [...new Set(errors)].filter(e => !/^error: Failed to load resource/.test(e));   // those are reported with their URL by the response/requestfailed listeners
  if (real.length) { failures += real.length; console.log('console errors:\n  ' + real.join('\n  ')); } else console.log('  ok   no console errors or warnings');
  await browser.close(); await close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
}
