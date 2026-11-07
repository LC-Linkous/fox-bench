#!/usr/bin/env python3
"""Stamp the page version onto index.html's own asset links so a deploy is picked up by browsers that cached the
last one: css/*.css and js/main.js become css/x.css?v=<VERSION>. GitHub Pages serves these files with long cache
lifetimes under names that never change, so without this a browser can run yesterday's main.js against today's
page for up to ten minutes after a deploy (project audit, "mixed-version page"). The ES-module graph behind
js/main.js is fetched relative to it, so one stamp on the entry covers every import.

    python3 tools/stamp_assets.py _site            # rewrite _site/index.html in place (the deploy and release jobs)
    python3 tools/stamp_assets.py --check _site    # exit 1 unless every link carries ?v=<VERSION>

The checkout's own index.html is left alone: plain links work from python -m http.server and from file://.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = re.search(r"const VERSION = '([^']*)'", (ROOT / "js/main.js").read_text()).group(1)
LINK = re.compile(r'((?:href|src)=")((?:css/[\w.-]+\.css|js/main\.js))(\?v=[^"]*)?(")')

def stamp(html): return LINK.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={VERSION}{m.group(4)}', html)

def main():
    check = "--check" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    site = Path(args[0]) if args else ROOT
    p = site / "index.html"
    html = p.read_text()
    links = LINK.findall(html)
    if not links: print(f"{p}: no asset links found"); sys.exit(1)
    if check:
        missing = [l[1] for l in links if l[2] != f"?v={VERSION}"]
        if missing: print(f"{p}: not stamped with ?v={VERSION}: {', '.join(missing)}"); sys.exit(1)
        print(f"{p}: {len(links)} asset links carry ?v={VERSION}"); return
    p.write_text(stamp(html))
    print(f"{p}: stamped {len(links)} asset links with ?v={VERSION}")

if __name__ == "__main__": main()
