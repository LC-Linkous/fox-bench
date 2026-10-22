#!/usr/bin/env python3
"""release_notes.py — the release body for a tag, from CHANGELOG.md.

    python3 tools/release_notes.py vX.Y.Z > notes.md

Takes the CHANGELOG section headed `## X.Y.Z` (else the `## Unreleased` one) and prefixes the three
component versions and the live URL; names the attached files. Used by the release job in ci.yml.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tag = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GITHUB_REF_NAME", "")).lstrip("v")
page = re.search(r"const VERSION = '([^']+)'", open(os.path.join(ROOT, "js/main.js")).read()).group(1)
fw = open(os.path.join(ROOT, "firmware/foxlib-c/VERSION")).read().strip()
foxlib = open(os.path.join(ROOT, "firmware/foxlib/VERSION")).read().strip()
text = open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8").read()
secs = re.split(r"^## ", text, flags=re.M)[1:]
pick = next((s for s in secs if s.startswith(tag)), None) or next((s for s in secs if s.startswith("Unreleased")), secs[0])
body = pick.split("\n", 1)[1].strip()
print(f"page {page} · foxlib {foxlib} · foxlib-c {fw}\n\nLive page: https://lc-linkous.github.io/fox-bench/\n\n{body}\n")
print(f"`foxbench-picofox-{fw}.uf2` is the firmware CI built and tested from this commit; `foxbench-picofox-{fw}.json` is its fingerprint (the Board tab checks a fetched image against the same sha256). `fox-bench-site-v{page}.zip` is the page as deployed — serve it over http to run it offline. `SHA256SUMS` covers all three.")
