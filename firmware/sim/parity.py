#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# sim/parity.py -- emit event streams from the Python encoders for a fixed corpus.
# parity.mjs does the same from js/audio; CI diffs the two. Run: python3 parity.py > py.json
import importlib.util, json, os, sys
FW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(FW, "foxlib", name + ".py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
morse, melody, sstv, schedule = load("morse"), load("melody"), load("sstv"), load("schedule")
corpus = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "parity_corpus.json")))
out = {}
for c in corpus["morse"]:
    out["morse:" + c["text"] + ":%s" % c.get("wpm", 12)] = [[round(h, 6), round(ms, 6)] for h, ms in morse.events(c["text"], wpm=c.get("wpm", 12), tone_hz=c.get("tone_hz", 800), dit_ms=c.get("dit_ms"))]
for s in corpus["songs"]:
    out["song:" + s["name"]] = [[round(h, 6), round(ms, 6)] for h, ms in melody.events(s, s.get("articulation", 0.875))]
img = sstv.test_card()
out["sstv:test_card"] = [[round(h, 6), round(ms, 6)] for h, ms in sstv.events(img)]
for seed in corpus["seeds"]:
    st, seq = seed, []
    for _ in range(50):
        v, st = schedule.rand_int(st, 0, 1000000)
        seq.append(v)
    out["lcg:%d" % seed] = seq
json.dump(out, sys.stdout, sort_keys=True)
