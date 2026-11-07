#!/usr/bin/env python3
"""Check a fleet CSV before importing it: the same rules the page's Import CSV applies, so a file edited by hand
in a spreadsheet can be checked first.

    python3 tools/check_fleet.py flash_log.csv

Exit 1 with line numbers on: an unknown column, a missing uid or timestamp column, a row with the wrong number
of cells, a row with no timestamp, a timestamp that is not ISO 8601, a duplicate (uid, timestamp). A BOM, CRLF
line endings and a trailing blank line are fine (spreadsheets add all three).
"""
import csv, io, re, sys

FLEET_FIELDS = ['board_number', 'timestamp', 'uid', 'mac', 'board', 'chip_type', 'revision', 'features', 'crystal', 'usb_mode', 'action', 'template', 'profile', 'callsign', 'freq', 'power', 'seed', 'result', 'challenge', 'keyphrase', 'notes']
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d")

def check(text):
    problems = []
    text = text.lstrip("\ufeff")
    rdr = csv.reader(io.StringIO(text, newline=""))
    rows = list(rdr)
    while rows and all(c == "" for c in rows[-1]): rows.pop()
    if not rows: return ["empty file"]
    header = [h.strip() for h in rows[0]]
    unknown = [h for h in header if h not in FLEET_FIELDS]
    if unknown: return ["line 1: unknown column(s) %s — expected some of %s" % (", ".join(repr(u) for u in unknown), ", ".join(FLEET_FIELDS))]
    for need in ("uid", "timestamp"):
        if need not in header: return ["line 1: no %s column" % need]
    seen = {}
    # line numbers: csv may span lines inside quotes; count newlines in each record's raw text approximately by re-reading
    line = 2
    for cells in rows[1:]:
        ln = line; line += 1 + sum(c.count("\n") for c in cells)
        if all(c == "" for c in cells): continue
        if len(cells) != len(header): problems.append("line %d: %d cells, header has %d" % (ln, len(cells), len(header))); continue
        r = dict(zip(header, cells))
        if not r.get("timestamp"): problems.append("line %d: no timestamp" % ln); continue
        if not ISO.match(r["timestamp"]): problems.append("line %d: timestamp %r is not ISO 8601 (YYYY-MM-DDTHH:MM:SS…) — a spreadsheet may have reformatted it" % (ln, r["timestamp"]))
        k = (r.get("uid", ""), r["timestamp"])
        if k in seen: problems.append("line %d: same uid and timestamp as line %d" % (ln, seen[k]))
        else: seen[k] = ln
    return problems

def main():
    if len(sys.argv) != 2: sys.exit(__doc__)
    text = open(sys.argv[1], encoding="utf-8", newline="").read()
    p = check(text)
    if p:
        for x in p: print(x)
        sys.exit(1)
    rows = len([l for l in list(csv.reader(io.StringIO(text.lstrip("\ufeff"), newline="")))[1:] if any(c != "" for c in l)])
    print("%s: ok (%d data row(s))" % (sys.argv[1], rows))

if __name__ == "__main__": main()
