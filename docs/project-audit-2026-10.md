# Project audit — October 2026

A critical review of fox-bench's workflow, process and stability at commit
`6b1e0b8` (page 0.6.0, foxlib 1.0.3, foxlib-c 0.1.4), done before any release
is tagged. Three independent reads — firmware, page/device layer,
process/CI/tests — each by a reviewer who had not written the code, every
claim spot-checked against the tree (and the Pico SDK source where it
mattered). Nothing here is fixed yet; this document is the worklist.

Severity: **critical** = can harm a user, a board or the air without warning;
**high** = a real failure on a realistic path; **medium** = fails under
specific but plausible conditions; **low** = debt.

## Verdict in one paragraph

The code quality is good where it has been exercised: write verification on
every transport, no XSS sink, a sound core-to-core mailbox, careful Si5351
arithmetic, honest validators with parity tests. The project's weakness is
everything *around* that: the tests do not gate the deploy, there is no
release or rollback, two different firmware binaries circulate under one
name, the page can talk the wrong protocol to a board after a dropdown
change, and the transmitter has several paths (flash writes during
modulation, `bootsel`/`reboot`, a stalled core 1) where it can be left on
the air at the wrong frequency or indefinitely. The highest-leverage fixes
are small; the list below is in the order they should be done.

## Do these first (ordered)

1. **Unkey before any reset and recover the I²C bus** (F1, F2). Firmware:
   `bootsel`, the 1200-baud touch and `reboot` must `player_stop(); player_key(false)`
   first; `si5351_init` must disable outputs even when the status read fails;
   bit-bang a 9-clock bus clear before `i2c_init`; make `wr()` failures
   visible and rewrite regs 26–33 after one. Flashable in a day; fixes the
   only findings that put RF where it should not be.
2. **Wall-clock keydown guard + watchdog** (F3). Core 0 enforces
   `max_keydown_s` with the clock, not the sample count, and can drive AEN
   high itself if core 1 stops answering; hardware watchdog fed from the loop.
3. **Gate the deploy on the tests** (P1). One workflow: `page`, `sim`,
   `foxlib-c` jobs, then `deploy` with `needs:` on all three, shipping the
   UF2 artifact the tests built — never rebuilding in the deploy job.
4. **Refuse to deploy over the wrong transport** (W1, W5). Switching board
   or loading a profile while connected disconnects first; each deploy module
   asserts the device kind it expects; `deploy.js` requires `!listening`.
5. **Tag and release** (P2). `v0.6.0` + `foxlib-c-0.1.4` once 1–4 land, a
   release workflow attaching the UF2 and a site zip, `CHANGELOG.md`, and the
   previous site kept under `/prev/`. Until then there is no way back from a
   bad push.
6. **One firmware build, pinned toolchain, published fingerprint** (P4).
   Arm GCC by URL+sha256, pico-sdk by commit SHA, a `foxbench-picofox.json`
   beside the UF2 (version, git SHA, gcc, sha256, text/bss), a bss budget
   assertion. Stop handing out locally built UF2s once CI produces this.
7. **Validate the page's restore and the foxlib-c limits** (W2, W3, F6).
   Run the saved working config through the validator at boot with a
   fallback; enforce the C firmware's counts (songs ≤16, notes ≤256, name
   ≤31 B, freqs ≤16, ranges ≤4) and estimate the JSON node budget in
   `schema.js` for the pinless family; compact-serialise `fox.json` and
   report `default(too_large)` instead of `default(parse)`.
8. **Firmware/page compatibility signal** (P3). Compare `board.json.foxlib`
   with the hosted `VERSION`, badge it on the Board tab, gate deploy on a
   per-key `since` in the schema. Extend the bump lint to `foxlib-c/VERSION`,
   `js/main.js VERSION` and the compiled-in defaults file.
9. **Pin and hash the vendor UF2s** (W/P shared). Commit-SHA raw URLs and a
   sha256 in `boards/picofox-vendor.json`, verified before Copy; check the
   RP2040 family ID in the UF2 header; offline → "download it and use Load .uf2".
10. **Make the tests honest** (P5–P7). DOM-condition waits instead of 62
    fixed sleeps, delete the `|| true` check, smoke the staged `_site` with
    the real UF2 in it, C-family variants of the power scenarios instead of
    56 silent skips, ASan/UBSan on `make check`, a root `make check`.

---

## Firmware (foxlib-c / PicoFox)

### F1 — HIGH: a flash write during modulation can leave the I²C transfer open; the next sample's bytes land in the wrong Si5351 registers
`picofox/si5351.c:25-28` (`wr` → `i2c_write_timeout_us(…, 2000)`, return
value ignored), `picofox/player.c:98`, `picofox/flash_disk.c:32`
(`flash_safe_execute` parks core 1 for the erase+program, 45–100 ms+).
Confirmed in the SDK (`hardware_i2c/i2c.c:178-205`): on a timeout the
remaining bytes — including the one carrying STOP — are never queued, so the
DW master holds the transfer open. The next `wr(28, …)` is appended without a
START: register address and P1/P2 bytes go in as *data* to the registers after
the aborted write (29–36: PLLA P1/P2 and PLLB) — the carrier can move by MHz.
During a Morse gap or bench `key`, the fraction bytes do not change
(`last_regs` skip, `si5351.c:102`), so the wrong frequency persists.
Trigger: every Deploy with the default `tx_while_mounted=true`; macOS
metadata churn; an `images.bin` copy does it dozens of times.
Fix: `wr` returns failure; on failure abort the controller (or
`i2c_deinit/init`), set `restart_on_next`, invalidate `last_regs`, rewrite
26–33 in full. Better still: a mailbox "hold" so core 1 is idle on the bus
before `flash_disk_flush`.

### F2 — HIGH: `bootsel`, the 1200-baud touch and `reboot` never unkey
`picofox/console.c:90-91,102`, `picofox/si5351.c:44-49` (returns before
`wr1(3, 0xFF)` when the SYS_INIT read fails), `picofox/player.c:57`
(AEN latch is 0 = amp enabled for an instant at init). An RP2040 reset does
not touch the Si5351: CLK0 stays enabled at the last carrier for as long as
the board sits on RPI-RP2. A reset mid-transaction can leave SDA held low;
the next boot's `rd1(0)` fails, `si5351_init` returns early, the banner says
`radio=nosi5351` and the carrier stays on. There is no bus-clear anywhere.
Fix: stop + unkey + wait for the ack in all three paths; attempt `wr1(3,
0xFF)` even when the status read fails; 9-clock bus clear before `i2c_init`;
drive AEN high before setting the pin to output.

### F3 — MEDIUM-HIGH: keydown is enforced in samples, keyed state is released only by core 1, no watchdog
`picofox/fox.c:179,194,285`, `picofox/player.c:96,132,157`, `picofox/main.c`.
Flash parks and I²C timeouts stretch wall-clock keydown without bound while
core 0 believes the limit holds; a faulted core 1 leaves the amp enabled and
the first `stop`/`reload` spins forever in `player_stop`, taking USB with it.
Fix: wall-clock budget check in `fox_poll` that unkeys from core 0; timeouts
on `call1`/`player_stop` after which core 0 drives AEN high and reports
`radio=core1_dead`; hardware watchdog.

### F4 — MEDIUM: console `freq` bypasses the 20 kHz band-edge margin
`picofox/fox.c:354` uses the bare range (`cfg_freq_in_ranges`) while
`setup_radio` (`fox.c:100`) requires ±20 kHz clearance, then sets
`radio_status="ok"` and resumes the cycle at that frequency, rewriting
`cfg.plan`. Fix: factor the margin test out and use it in both places; do not
overwrite `radio_status` on a failed retune.

### F5 — MEDIUM: an ejected drive never returns until power-cycle
`picofox/msc_disk.c:10-40`: `ejected` is cleared only by START UNIT;
`msc_reset_eject()` is never called; no `tud_mount_cb`/`tud_umount_cb`. The
board is battery powered, so Eject → unplug → replug leaves "medium not
present". Fix: clear the flag in `tud_umount_cb`/`tud_mount_cb`.

### F6 — MEDIUM: `fox.json` capacity is far below what the page allows, and overflow reads as `default(parse)`
`picofox/fox.c:34` (`filebuf[12288]`), `picofox/fs.c:56` (truncates
silently), `core/json.h` (`JSON_MAX_NODES 4096`). The page writes
`JSON.stringify(cfg, null, 1)` (~1.3 KB per bundled song); ~9 songs or
~1 300 notes exhaust it → defaults → placeholder callsign → silent fox, with
the page showing `cfg=ok`. The host stub truncates identically, so the
simulator agrees with the bug. Pairs with W3.
Fix: report `default(too_large)` when `n == cap-1`; raise `filebuf` (RAM
allows ~32 KB); compact serialisation and a size/node estimate on the page.

### F7 — MEDIUM: banner can exceed `con_printf`'s 320 B buffer and lose its CRLF
`picofox/console.c:38` vs the 400 B banner (`fox.c:120`); the host stub
uses 400 B so tests cannot see it. A freq-rotator with many frequencies plus
a `partial(…)` list glues the next line onto the banner, which Listen keys on.
Fix: `con_puts(banner); con_puts("\r\n")`; align the stub buffer.

### F8 — MEDIUM-LOW: any host write (including OS metadata) cuts the transmission and re-seeds the schedule
`picofox/main.c:42-47`, `fox.c:306-320`. `.DS_Store`, `.fseventsd`,
`System Volume Information`, Spotlight — each restarts the deterministic
popcorn/resurrection timeline the fleet log reconstructs from the seed.
Fix: compare `fox.json`/`defaults.json`/`images.bin` against the last load
on settle and skip unchanged reloads; keep schedule state when the schedule
block is unchanged.

### Low
- F9 `radio.correction_ppm` is validated and stored but never applied
  (`si5351.c:19` keeps 25 MHz); `ranges_mhz` has no compiled-in hardware
  envelope, so a hand-edited `[[100,200]]` passes every check.
- F10 Attenuator: code clocks an 8-bit word (`player.c:33-54`), the hardware
  notes describe a 16-bit word with address bits; `fox.c:104` writes
  attenuation on every reload including 0, contrary to the README; `atten`
  during a stream is refused by core 1 but the console prints `ok`.
- F11 I²C at 1 MHz is outside the Si5351's 400 kHz spec, with no readback.
- F12 `core/json.c:50,117` one-byte over-read on truncated input (benign
  today because inputs are NUL-terminated); `json_int` casts any double
  (UB on `1e30`); invalid low surrogates accepted.
- F13 `sched_*` take `int64_t` but receive the 32-bit `now_ms()`
  (`fox.c:220,266`): a resurrection fox's `until` becomes unreachable after
  49.7 days of uptime.
- F14 Si5351 probed once at boot (100 ms window); a slow TCXO/LDO ramp means
  `radio=nosi5351` until reboot. Re-probe in `setup_radio`.
- F15 Bench `key`/`tone`/`id` check only `radio_status`, not the callsign
  gate; a `reload` during a bench action stops it without the `ok` the host
  waits for; VID/PID `2E8A:000A` is the SDK's generic CDC-only PID reused for
  a composite device (Windows INF caching risk).

### Test blind spots (firmware)
The host simulation replaces `player_play` with a synchronous event list, so
the mailbox, `player_stop` spin, late-resync, per-segment sample budgets and
SSTV on core 1 never execute; `msc_host_writes()` returns 0 (settle/reload
untested); `fs_seed` is a no-op (`board.json` unexercised); `player_set_carrier`
never fails; `fs_read` truncation is mirrored; console dispatch,
`fox_bench_freq`, bootsel/touch, the flash cache and FAT coherency have no
test at all. Findings F1–F5, F7, F10, F11 are invisible to the suite.

### Found sound
Mailbox seq/ack ordering with `__dmb`, static request objects, no flash op
from an IRQ; unkey on every *normal* path incl. segment carry-over of the
budget; `cfg=fatal`/parse failure/placeholder callsign stay silent; `key()`
ordering; Si5351 register encoding and PLL-reset policy; flash-disk cache
coherency, identical-sector skip, `board.json` rewritten only on change;
JSON pools, depth limit, validated divisors; console ring buffer never
blocks a closed port.

---

## Page and device layer

### W1 — HIGH: changing board/family while connected keeps the old transport → deploy to the wrong board
`js/main.js:125-143` (`setBoard`), `:148-155` (`loadCfg`), the three deploy
modules never check `device.kind`. Connect a XIAO over the REPL, pick the
PicoFox (fox-bench firmware) target or load a PicoFox profile: Deploy writes
a pinless `fox.json` and `defaults.json` onto the CircuitPython board (silent
fox, fleet row says `picofox-foxlibc`). Reverse direction throws a cryptic
TypeError after `code.py` may already be on the drive.
Fix: `setBoard`/`loadCfg` disconnect first when the family changes (and say
so); each deploy module asserts the device kinds it can write to.

### W2 — HIGH: the saved working config is restored unvalidated
`js/main.js:346-350`. One missing sub-object throws in the first `changed()`,
`boot()` aborts before `showTab`, and the page is wedged on every reload until
site data is cleared. No version stamp on the stored object; any future key
rename triggers it. Fix: restore through `mergeAndValidate` with a
try/catch fallback to template defaults; store `{version, …}`.

### W3 — HIGH: `schema.js` accepts what the C firmware truncates or cannot parse
No count limits on the page (`schema.js:84,111-116`) vs `CFG_MAX_FREQS 16`,
`CFG_MAX_RANGES 4`, `PLAYLIST_MAX 16`, `SONG_MAX_NOTES 256`, name 31 B,
`JSON_MAX_NODES 4096`. The parity corpus has **zero** `picofox-foxlibc`
cases and the JS↔C comparison checks only status, not effective values.
Fix: enforce the limits for the pinless family, estimate nodes, add
foxlib-c cases to the corpus and compare effective cfg.

### W4 — HIGH: `connect()` has no in-flight guard and unhandled rejection paths
`js/main.js:168-210`. `link.open()` outside the try (port held by another
program — the most common real failure — prints nothing); `readBoard()`
outside the try (top bar says connected, tabs say disconnected); a second
click during a slow interrupt (~28 s worst case) starts a second connect
that leaks the first port and cross-wires `onDrop`.
Fix: a `_connecting` promise, one try/catch around the body with a
`NetworkError` hint, buttons disabled while connecting.

### Medium
- W5 `deploy.js:104` allows Deploy during Listen-only (`deploy-foxlibc.js:66`
  gets it right): writes to an unidentified board, logs `board:'?'`, bypasses
  the board-id check.
- W6 Following a banner or connecting silently rewrites the working form
  (`setBoard:135,140-141`) and persists it at once; no undo.
- W7 `profiles.js:6,12,21` swallow localStorage failures; "profile saved" /
  fleet append are reported as success past the quota (SSTV pixels as number
  arrays, ~35 kB each).
- W8 `flash.js:181`: `w.close()` is in the same try as the write; the
  bootloader often reboots before the rename, so a successful flash can be
  reported as a failure with no fleet row (OS-dependent — likely Windows).
- W9 Vendor UF2 from a mutable branch, only the `UF2\n` magic checked, no
  RP2040 family-ID check, offline error gives no hint (shared with P-list).
- W10 A mis-picked folder still "connects" (`drive-device.js:32-40` only
  logs); Deploy will write `settings.txt`/`fox.json` into Documents.
- W11 Port drop mid-operation surfaces as a timeout 10–30 s later; a clean
  `done` on the read stream fires no `onDrop`.
- W12 UI handlers that await device calls without a catch (`board.js:60-62`,
  `deploy.js:140`, `bench.js:42`, `fleet.js:52`): the button does nothing.
- W13 Flasher erases before comparing the detected chip with `board.flash.chip`
  or blocking on an image/board mismatch.
- W14 `payload.images_file` is an unrestricted path in all three validators;
  `"images_file": "code.py"` makes Deploy overwrite firmware with image data.

### Low
CSV cells beginning with `= + - @` exported raw (banner text reaches Excel);
`__proto__` as a banner board id freezes the page until reload (`Object.hasOwn`);
`NotAllowedError` unmapped; Safari/Firefox notice talks only about serial;
cancelling the port chooser logs a `fail` fleet row; `_list` splits on spaces
(NaN sizes); callmessage length counted in UTF-16 units / code points / bytes
across JS / Python / C; Google Fonts and a jsDelivr fallback on a
"nothing to install" page; two tabs clobber `fox-bench.fleet`/`working`;
console `entries` grows unbounded; `schema.js:99` message still says
`subset of ["batt"]`.

### Code health
Seven hand-built `fleet.append({...})` literals with inconsistent fields
(`freq` joined vs first-only, `power` computed three ways, `uid` sometimes
omitted) — a `fleetRow()` helper would make the CSV a contract. `connect()`
and `_followBanner` are untestable as written (DOM + transport in one
function); `schema.js pageChecks`, `profiles.js toCsv`, `zip.js`, `airtime.js`,
`wav.js` have no unit tests. Dead: `PROBE_FREQS`, `ReplDevice.verify/_readText`,
`fmtHz`, `DriveDevice.mkdir/remove` stubs.

### Found sound
No XSS sink (`h()` uses text nodes; the `html:` path is unused); every write
read back (CRC32 on-board over the REPL, byte-for-byte on drives); REPL
protocol layer and its fake; `ConsoleDevice` queueing; stale-handle mapping;
UF2 flow's content-based bootloader detection and per-target image memory;
JS↔Python parity compares effective config on the XIAO corpus; the vendor
model's silent-failure checks; no `eval`, no credentials.

---

## Process, CI, tests, release

### P1 — CRITICAL: a red test suite does not stop the Pages deploy
`pages.yml` has no `needs:`/`workflow_run` on `page.yml` or `firmware.yml`;
it rebuilds and deploys on every push to `main`. The README's "three test
layers in CI" are observers. Fix: one workflow, `deploy` with
`needs: [page, sim, foxlib-c]`, shipping the tested UF2 artifact.

### P2 — HIGH: no way back from a regression
No tags, releases, CHANGELOG or versioned URL; the hosted UF2 is overwritten
on every push; the 90-day CI artifact is a *different* binary. Fix: tag,
release workflow on tag (UF2 + site zip), CHANGELOG seeded from the commit
messages, `/prev/` on the site.

### P3 — HIGH: firmware/page compatibility for foxlib-c is unchecked
The page reads `board.json.foxlib` but never compares it with the hosted
`VERSION`; `id.telemetry: ["chg"]` already exists in 0.1.3+ only. The
version-bump lint covers foxlib and templates but not `foxlib-c/VERSION`,
`js/main.js VERSION` (unchanged at 0.6.0 through 13 feature commits) or the
defaults file compiled into the UF2. Fix: badge + per-key `since`; extend
`check_catalog.py --since`; assert README's version.

### P4 — HIGH: two different firmware binaries under one name, unpinned toolchain
CI uses apt `gcc-arm-none-eabi` on `ubuntu-latest` (drifts silently) and a
mutable SDK tag; the maintainer's and this session's builds use xpack GCC
15.2.1. The site's UF2 is reproducible by nobody. bss is 198.7 KB of 264 KB
with no assertion. Fix: one build job, pinned toolchain + SDK SHA, build-info
JSON beside the UF2, bss budget.

### P5 — MEDIUM: the deployed site is never what the smoke test ran against
`page.yml` serves the checkout; `pages.yml` stages an allow-list and deletes
`firmware/sim`; the dev server lacks `.uf2/.wav/.bin` MIME types. Jekyll
underscores already bit once. Fix: stage `_site` in the test job, smoke it
with the real UF2 inside, upload that directory.

### P6 — MEDIUM: test honesty
62 fixed `settle()` sleeps and one `try` in a 387-line smoke script (first
failure hides every later section); `smoke.mjs:319` is `… || true`, a
permanently green check; unit tests use real timers (60 tests = 49 s);
56 of 109 C-runner scenarios skipped — including the power scenarios a field
fox actually fails on; `parity.py` skips the JS comparison and exits 0 when
node is missing; the lint silently passes when the C validator fails to
*build*; `boards_tested` in every template still lists only the XIAO, so
the Behavior tab tells PicoFox users "Tested on seeed_xiao_esp32c3" while
`picofox-foxlibc.json` says `stable`. No recorded real-board transcript is
replayed anywhere — the fakes are page code testing page code.

### P7 — MEDIUM: workflow hygiene and dependencies
No `permissions:` in `page.yml`/`firmware.yml`; floating action tags; no
Dependabot (Playwright 1.49.1 / Chromium 131 from Dec 2024 will age
silently); `pip install pyserial` unpinned; pty board started with `& sleep 2`;
no caching (pico-sdk cloned twice per push); `npm run smoke` fails out of the
box without an undocumented `playwright install --with-deps` plus `gcc`/`make`.
Good: no `pull_request_target`, no secrets, `pages.yml` least-privilege.

### P8 — MEDIUM: licences and docs drift
`LICENSES.md` says all of `firmware/` is GPL-3.0-or-later, but
`firmware/sim/parity.mjs` and `schema_parity.mjs` are (correctly) GPL-2.0-only.
Larger: `js/ui/flash.js` imports `flasher/flasher.js` (Apache-2.0) into the
GPL-2.0-only page as a runtime ES module — DESIGN §9 calls it aggregation; a
module import into one program is the textbook combined work and Apache-2.0
is GPLv2-incompatible. Relicensing the page to GPL-3.0-or-later removes the
conflict and the two-GPL split in one move; worth a deliberate decision.
`esptool-js` has no recorded provenance (tarball sha256 / upstream commit).
`DESIGN.md §2` names 13 files that do not exist; §8 describes a manifest
check that is not implemented; README's hardware-report claim has no
committed report; the firmware README never names a compiler version.

### Low
Mixed-version page for ≤10 min after a deploy (`max-age=600`, unhashed
imports — stamp `?v=<sha>` or a `version.json` "reload" toast); Google
Fonts; `_shots/` not ignored; three same-subject commits applied unsquashed;
host C tests without ASan/UBSan or a fuzzer on a parser that reads a volume
anyone can write.

---

## The workflow itself

Sixty commits in five days came from one session as patches, applied by the
maintainer without a PR or a second reader, onto `main`, which deploys. That
loop moved fast and the hardware feedback was excellent, but it means:

- Review happened only now, after the fact. A branch-and-PR per topic (CI
  already triggers on `pull_request`) costs little and gives a place for the
  catalog lint and smoke test to say no *before* the site changes.
- Two artefact paths exist: the UF2 CI builds into the site, and UF2s built
  elsewhere and copied over by hand. Once P4's build-info file exists, only
  the CI one should be flashed, and the Board tab can show which one a fox
  is running.
- Hardware verification lives in chat logs and commit messages, not in the
  repo. A `docs/hardware-log.md` (date, board, firmware sha, what was checked,
  by ear / S-meter / scope) and `boards_tested` kept current would make the
  "stable" label mean something to the next person.
- Single maintainer, single board of each kind, fakes written from memory of
  those boards: `tools/hw_smoke.py --record` fixtures replayed in CI are the
  cheapest insurance against drift.
- No CONTRIBUTING, SECURITY or CODEOWNERS; no one-command local run
  (`npm test` covers `tests/` only; the sim, the lint, the C tests and the
  firmware build are four more commands with undocumented prerequisites).

## What the next audit should find different

Tests gating the deploy; a tagged release with a changelog; one reproducible
UF2 with a fingerprint; the firmware unkeying on every exit path with a
wall-clock keydown guard and a watchdog; the page refusing to deploy over the
wrong transport; the foxlib-c limits enforced in `schema.js` with parity
cases; the vendor image pinned and hashed; `DESIGN.md §2` generated from the
tree.
