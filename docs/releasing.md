# Releasing

A release is a git tag `vX.Y.Z` where `X.Y.Z` is the page version in
`js/main.js`. CI (`.github/workflows/ci.yml`, job `release`) runs the three
test jobs for that commit and, when they pass, creates a GitHub Release with:

- `foxbench-picofox-<fw>.uf2` — the foxlib-c firmware built from that commit
  with the pinned toolchain (the same bytes the site serves);
- `foxbench-picofox-<fw>.json` — its fingerprint (commit, SDK, GCC, sha256,
  size, RAM);
- `fox-bench-site-vX.Y.Z.zip` — the page as deployed (serve over http to run
  it offline or to go back to this version);
- `SHA256SUMS`, and notes taken from `CHANGELOG.md`.

## Before tagging

1. Hardware has run the firmware this tag ships: Deploy while keyed →
   `status` shows `i2c_errors=0 core1=ok`; `bootsel` while keyed goes silent
   before RPI-RP2 appears; a soak long enough to trust the watchdog
   (`status` → `reset=` is not `watchdog(timeout)` after a power cycle).
2. The live site's Board tab says **matches this site** for a fox flashed
   with the site's UF2 (the fingerprint chain works end to end).
3. `CHANGELOG.md`: rename `## Unreleased` to `## X.Y.Z — date · foxlib a.b.c
   · foxlib-c d.e.f` and start a new empty `## Unreleased` above it.
4. Versions agree: `python3 tools/check_catalog.py` passes (README's `v0.x`
   equals the page version; `--since` has been satisfied by the push).

## Tagging

```
git tag -a v0.6.2 -m "fox-bench 0.6.2"
git push origin v0.6.2
```

The release job refuses a tag that does not equal the page version. A
mistake can be undone by deleting the release and the tag; the next tag
must be a new number (firmware fingerprints name commits, and a moved tag
would name two).

## After

Tell the Behavior tab's `boards_tested` and `docs/hardware-log.md` what
this release was verified on, in the next commit, not by editing the
release.
