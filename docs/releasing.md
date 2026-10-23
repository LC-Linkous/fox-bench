# Releasing

A release is a git tag `vX.Y.Z` where `X.Y.Z` is the page version in
`js/main.js`. The `release` job in `.github/workflows/ci.yml` creates a
GitHub Release titled `fox-bench vX.Y.Z` carrying:

- `foxbench-picofox-<fw>.uf2` — the foxlib-c firmware built from that commit
  with the pinned toolchain (the same bytes the site serves; `<fw>` is
  `firmware/foxlib-c/VERSION`);
- `foxbench-picofox-<fw>.json` — its fingerprint (commit, SDK, GCC, sha256,
  size, RAM, the `FOXLIBC-VERSION:` tag read out of the image);
- `fox-bench-site-vX.Y.Z.zip` — the page as deployed (serve it over http to
  run offline or to go back to this version);
- `SHA256SUMS` over the three, and notes taken from `CHANGELOG.md`
  (`tools/release_notes.py`: the `## X.Y.Z` section if there is one, else
  `## Unreleased`, prefixed with the three version numbers).

## Prerequisites

1. Hardware has run the firmware this tag ships, and `docs/hardware-log.md`
   has the row: Deploy while keyed → `status` shows `i2c_errors=0 core1=ok`;
   `bootsel` while keyed goes silent before RPI-RP2 appears; power cycles
   show `reset=power_on`, never `watchdog`.
2. The live site's Board tab says **matches this site** for a fox flashed
   with the site's UF2 (the fingerprint chain works end to end), and a
   pre-current UF2 loaded by hand is flagged as older.
3. `CHANGELOG.md`: rename `## Unreleased` to
   `## X.Y.Z — date · foxlib a.b.c · foxlib-c d.e.f` and start a new empty
   `## Unreleased` above it. A changelog-only commit needs no version bump.
4. The push that bumped `js/main.js` VERSION was green: CI ran
   `check_catalog.py --since <base>` on it (the version-bump lint), so
   README's `v0.x`, the page version and the firmware version agree. Locally
   the same check is `python3 tools/check_catalog.py --since origin/main`.

## What CI does on a tag

A tag push is a push: the three test jobs (`page`, `sim`, `foxlib-c`) run
again from scratch on that commit — the UF2 the release carries is the one
*this* run built, not the one the site deployed earlier (same commit date,
same toolchain → same bytes; the fingerprint's sha256 is the proof). The
`deploy` job does not run for a tag (it is `main` only). The `release` job
needs the three test jobs, checks that `vX.Y.Z` equals the page version,
stages the files, cuts the notes, and then **either creates the release or
fills one that already exists** for that tag.

## Three ways to start one

1. **Tag from the command line** (the usual way):
   ```
   git tag -a v0.7.9 -m "fox-bench 0.7.9"
   git push origin v0.7.9
   ```
2. **GitHub → Releases → "Draft a new release"**, choosing a new tag name:
   GitHub creates the tag, the tag push runs CI, and the job fills the
   release you drafted (title, notes and assets are overwritten with CI's).
3. **Actions → CI → "Run workflow"** on `main` with the **release** box
   ticked: the job tags `main` at the page version itself and releases. It
   refuses if that tag already exists at another commit ("bump VERSION in
   js/main.js first").

## What to check on the release page

- Title `fox-bench vX.Y.Z`; notes begin with `page X.Y.Z · foxlib … ·
  foxlib-c …`.
- Four assets: `foxbench-picofox-<fw>.uf2`, `.json`, `fox-bench-site-vX.Y.Z.zip`,
  `SHA256SUMS`.
- The `.json`'s `sha256` equals the sha the live site's Board tab shows for
  its hosted image (same commit → same bytes). If it does not, the site is
  serving an older deploy: check the `deploy` job of the commit.

## If the release job fails

- **Re-run it.** Actions → the tag's run → "Re-run failed jobs". The tag and
  the commit are unchanged, so the job builds the same bytes; if a release
  already exists for the tag (route 2, or a previous partial run), the job
  fills it rather than failing on "already exists". Do **not** delete the
  tag to retry a failed job.
- **No run at all** after a push means the workflow file did not parse
  (GitHub shows "Invalid workflow file" under Actions, and nothing else). A
  duplicate key is the usual cause; `python3 tools/check_ci.py` catches it
  locally and in the `sim` job once the file parses at all.
- **"tag vX.Y.Z but js/main.js VERSION is …"**: the tag names the wrong
  commit or the version was not bumped. Delete the tag (`git push origin
  :refs/tags/vX.Y.Z` and locally), fix, and tag again — this is the one case
  where a tag moves, and it is fine because nothing was released under it.
- A release that went out and is wrong is not moved: fix forward and tag the
  next number. Firmware fingerprints name commits; a moved tag would name
  two.

## After

Tell the Behavior tab's `boards_tested` and `docs/hardware-log.md` what
this release was verified on, in the next commit, not by editing the
release. Then start the next `## Unreleased`.
