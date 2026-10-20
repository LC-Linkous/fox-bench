#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""foxlib-c core parity: the C encoders/scheduler/config must match foxlib (Python).

Compares, through the host-built core_dump harness:
  - Morse event streams for a set of texts/speeds (incl. QRSS dit_ms, odd spacing, unknown chars)
  - song event streams for every template's default playlist
  - schedule wait/phase sequences for every template's default schedule (seeded LCG)
  - cfg status lines for the simulator's deploy set (fox.json over defaults.json)
  - synth sanity: sample count == event length, peak within level, no clipping
Exit status non-zero on the first mismatch. Run from anywhere: paths are repo-relative."""
import argparse, importlib.util, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FOXLIB = os.path.join(REPO, "firmware", "foxlib")
TEMPLATES = os.path.join(REPO, "firmware", "templates")


def load(name):
    spec = importlib.util.spec_from_file_location("foxlib_" + name, os.path.join(FOXLIB, name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


morse, melody, schedule, sstv = load("morse"), load("melody"), load("schedule"), load("sstv")
fails = 0


def run(binary, *args):
    r = subprocess.run([binary, *map(str, args)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("core_dump %s: rc=%d %s" % (" ".join(map(str, args)), r.returncode, r.stderr))
    return r.stdout


def parse_events(text):
    return [(float(a), float(b)) for a, b in (ln.split() for ln in text.strip().splitlines() if ln.strip())]


def same(a, b, tol=0.01):
    return len(a) == len(b) and all(abs(x[0] - y[0]) <= max(tol, 1e-5 * abs(x[0])) and abs(x[1] - y[1]) <= tol for x, y in zip(a, b))


def check(name, ok, detail=""):
    global fails
    print(("  ok   " if ok else "  FAIL ") + name + (("  " + detail) if detail and not ok else ""))
    if not ok:
        fails += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", default=os.path.join(HERE, "build", "core_dump"))
    a = ap.parse_args()
    b = a.bin

    print("morse")
    cases = [("KY4ZR FOX DE KY4ZR", 12, 800, 0), ("n0call decoy decoy n0call", 20, 600, 0), ("e", 12, 800, 0),
             ("QSY 147.420", 15, 700, 0), ("  double  spaces  ", 12, 800, 0), ("KY4ZR/P BAT 3V7", 12, 800, 0),
             ("hello? #$% world", 12, 800, 0), ("KY4ZR", 12, 800, 3000), ("", 12, 800, 0), ("   ", 12, 800, 0), ("abc@=+-,.", 25, 1000, 0)]
    for text, wpm, tone, dit in cases:
        py = [(float(h), float(ms)) for h, ms in morse.events(text, wpm=wpm, tone_hz=tone, dit_ms=dit or None)]
        c = parse_events(run(b, "morse", wpm, tone, dit, *text.split(" ")) if text.strip() else run(b, "morse", wpm, tone, dit, text))
        check("%-28r wpm=%d dit=%s: %d events" % (text, wpm, dit, len(py)), same(py, c), "py=%s c=%s" % (py[:6], c[:6]))

    print("songs")
    for t in sorted(os.listdir(TEMPLATES)):
        ddir = os.path.join(TEMPLATES, t, "defaults")
        if not os.path.isdir(ddir):
            continue
        for f in sorted(os.listdir(ddir)):
            path = os.path.join(ddir, f)
            d = json.load(open(path))
            if d["payload"].get("kind") != "songs":
                continue
            for art in (0.875, 0.5, 1.0):
                py = [(float(h), float(ms)) for h, ms in melody.events(d["payload"]["playlist"][0], art)]
                c = parse_events(run(b, "song", path, art))
                check("%s/%s art=%s: %d events" % (t, f, art, len(py)), same(py, c, 0.02))

    print("schedules")
    for t in sorted(os.listdir(TEMPLATES)):
        ddir = os.path.join(TEMPLATES, t, "defaults")
        if not os.path.isdir(ddir):
            continue
        for f in sorted(os.listdir(ddir)):
            path = os.path.join(ddir, f)
            d = json.load(open(path))
            if d["schedule"].get("kind") not in ("fixed", "popcorn", "resurrection"):
                continue
            s = schedule.make(d["schedule"])
            now, py = 0, []
            steps = 40
            for _ in range(steps):
                ph = s.phase(now)
                wake = ""
                if ph == "dead":
                    wake = " " + s.dead_wake()
                w = s.wait_ms(now)
                py.append("%s%s %d" % (ph, wake, w))
                now += w + 5000
            c = run(b, "sched", path, steps).strip().splitlines()
            check("%s/%s %s: %d steps" % (t, f, d["schedule"]["kind"], steps), py == c, "py=%s c=%s" % (py[:4], c[:4]))
    # a resurrection schedule whose alive phase is short enough to go dead within the run
    import tempfile
    short = {"schema": 1, "template": "x", "board": "y", "plan": {"frequencies_mhz": [146.565]}, "id": {"callmessage": "A B", "placeholder": "N0CALL"},
             "schedule": {"kind": "resurrection", "seed": 7, "delay_ms": 10000, "alive_min_ms": 20000, "alive_max_ms": 40000, "dead_ms": 90000, "dit_min_ms": 5000, "dit_max_ms": 15000, "id_every": 3, "dead_song": False}}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump(short, tf)
    s = schedule.make(short["schedule"])
    now, py = 0, []
    for _ in range(60):
        ph = s.phase(now)
        wake = (" " + s.dead_wake()) if ph == "dead" else ""
        w = s.wait_ms(now)
        py.append("%s%s %d" % (ph, wake, w))
        now += w + 5000
    c = run(b, "sched", tf.name, 60).strip().splitlines()
    check("resurrection short alive/dead cycling: %d dead wakes" % sum(1 for x in py if x.startswith("dead")), py == c and any(x.startswith("dead") for x in py), "py=%s c=%s" % (py[:8], c[:8]))
    os.unlink(tf.name)

    print("sstv")
    import random, struct
    tc = sstv.test_card()
    py = [(float(h), float(ms)) for h, ms in sstv.events(tc)]
    out = run(b, "sstv", "testcard").splitlines()
    c = parse_events("\n".join(out[1:]))
    check("test card: %d events, %.1f s" % (len(py), sum(ms for _, ms in py) / 1000), same(py, c, 0.001) and out[0] == "# test_card 40 240", "py=%d c=%d first=%s" % (len(py), len(c), c[:3]))
    check("duration_ms agrees", abs(sstv.duration_ms() - sum(ms for _, ms in c)) < 0.5)
    # an images.bin with three images: random noise, a short image (padded with black), a 1-px-wide one
    rnd = random.Random(7)
    imgs = [{"name": "noise", "width": 40, "height": 240, "pixels": bytes(rnd.randrange(256) for _ in range(40 * 240))},
            {"name": "short-img", "width": 40, "height": 100, "pixels": bytes((x * 6) & 255 for x in range(40 * 100))},
            {"name": "thin", "width": 1, "height": 240, "pixels": bytes(range(240))}]
    blob = bytes([len(imgs)])
    for im in imgs:
        nm = im["name"].encode(); blob += bytes([im["width"], im["height"], len(nm)]) + nm + im["pixels"]
    with tempfile.NamedTemporaryFile("wb", suffix=".bin", delete=False) as tf:
        tf.write(blob)
    loaded = sstv.load_images(tf.name)
    for i, im in enumerate(imgs):
        py = [(float(h), float(ms)) for h, ms in sstv.events(loaded[i])]
        out = run(b, "sstv", tf.name, i).splitlines()
        c = parse_events("\n".join(out[1:]))
        check("images.bin[%d] %s %dx%d: %d events" % (i, im["name"], im["width"], im["height"], len(py)), same(py, c, 0.001) and out[0] == "# %s %d %d" % (im["name"], im["width"], im["height"]), "hdr=%s py=%d c=%d" % (out[0], len(py), len(c)))
    os.unlink(tf.name)

    print("cfg")
    sim = os.path.join(REPO, "firmware", "sim")
    sys.path.insert(0, sim)
    sys.path.insert(0, os.path.join(REPO, "firmware"))
    cfgmod = load("cfg")
    deploy = os.path.join(sim, "deploy_set")
    scenarios = []
    if os.path.isdir(deploy):
        for name in sorted(os.listdir(deploy)):
            p = os.path.join(deploy, name)
            if os.path.isfile(os.path.join(p, "fox.json")) and os.path.isfile(os.path.join(p, "defaults.json")):
                scenarios.append((name, os.path.join(p, "defaults.json"), os.path.join(p, "fox.json")))
    # plus: every template's defaults as its own fox.json, and a few hand-made bad files
    for t in sorted(os.listdir(TEMPLATES)):
        ddir = os.path.join(TEMPLATES, t, "defaults")
        if os.path.isdir(ddir):
            for f in sorted(os.listdir(ddir)):
                scenarios.append((t + "/" + f, os.path.join(ddir, f), os.path.join(ddir, f)))
    bad = {
        "schema2": {"schema": 2}, "wrong-template": {"template": "nope"}, "wrong-board": {"board": "other"},
        "bad-wpm": {"id": {"wpm": 99, "callmessage": "KY4ZR FOX"}}, "bad-freq": {"plan": {"frequencies_mhz": [430.0]}},
        "mixed": {"plan": {"frequencies_mhz": [146.565, 500]}, "schedule": {"kind": "popcorn", "seed": 3, "cluster": 99}, "payload": {"kind": "songs", "playlist": []}, "zzz": 1},
        "null-payload": {"payload": None, "limits": {"max_keydown_s": 60}}, "int-float": {"id": {"wpm": 15.0, "tone_hz": 700.0}, "schedule": {"kind": "fixed", "delay_ms": 20000.0}},
        "battery": {"battery": {"low_v": 3.0, "critical_v": 3.4, "recovery_v": 3.5}},
    }
    base = os.path.join(TEMPLATES, "morse-songs", "defaults", "seeed_xiao_esp32c3.json")
    tmpfiles = []
    for name, u in bad.items():
        tf = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(u, tf)
        tf.close()
        tmpfiles.append(tf.name)
        scenarios.append(("bad/" + name, base, tf.name))
    for name, dpath, upath in scenarios:
        defaults = json.load(open(dpath))
        board = defaults.get("board")
        try:
            user = json.load(open(upath))
        except Exception:
            user = None
        if user is None:
            status = "default(parse)"
            items = []
        else:
            cfg, rep = cfgmod.validate(user, defaults, ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"], board)
            # the C family has no pins: drop pin complaints from the Python side before comparing
            rep.items = [(k, r) for k, r in rep.items if not k.startswith("pins")]
            if rep.fatal and rep.fatal.startswith("pins"):
                rep.fatal = None
            if not rep.items and rep.mode == "partial":
                rep.mode = "ok"
            status = rep.status()
            items = ["  cfg: %s -> default (%s)" % (k, r) for k, r in rep.items]
        out = run(b, "cfg", dpath, upath, board).splitlines()
        c_status = out[0].split("=", 1)[1]
        c_items = [ln for ln in out if ln.startswith("  cfg:")]
        check("%-44s %s" % (name, status), c_status == status and c_items == items, "c=%s %s" % (c_status, c_items))
    for f in tmpfiles:
        os.unlink(f)

    print("cfg: JS validator (js/model/schema.js, pinless board) vs C")
    import shutil
    node = shutil.which("node")
    if not node:
        print("  skip: node not installed")
    else:
        js_cases = []
        for t in sorted(os.listdir(TEMPLATES)):
            dp = os.path.join(TEMPLATES, t, "defaults", "picofox-foxlibc.json")
            if os.path.exists(dp):
                js_cases.append((t + "/defaults", dp, dp))
        base_c = os.path.join(TEMPLATES, "morse-songs", "defaults", "picofox-foxlibc.json")
        bad_c = dict(bad)
        bad_c.update({
            "si5351-bad": {"radio": {"attenuation": 200, "tone_shape": "square", "sample_rate": 100, "preemphasis": "yes", "itu_zone": 9, "id_deviation_hz": 20000, "correction_ppm": 1000, "tx_while_mounted": 1}},
            "si5351-ok": {"radio": {"attenuation": 40, "tone_shape": "sine", "sample_rate": 5000, "preemphasis": False, "itu_zone": 1, "id_deviation_hz": 2500, "audio_deviation_hz": 7000, "correction_ppm": -1.5, "tx_while_mounted": False}, "id": {"callmessage": "KY4ZR FOX"}},
            "pins-ignored": {"pins": {"ptt": "GP99"}, "id": {"callmessage": "KY4ZR FOX"}},
            "rotator": {"plan": {"frequencies_mhz": [146.565, 147.42, 147.445], "announce_qsy": True}, "schedule": {"kind": "resurrection", "seed": 5, "id_every": 2, "alive_min_ms": 5, "alive_max_ms": 1}},
        })
        tmp2 = []
        for name, u in bad_c.items():
            tf = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False); json.dump(u, tf); tf.close(); tmp2.append(tf.name)
            js_cases.append(("bad/" + name, base_c, tf.name))
        script = """
import { mergeAndValidate } from %r;
import fs from 'node:fs';
const [dp, up] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(dp, 'utf8'));
let u; try { u = JSON.parse(fs.readFileSync(up, 'utf8')); } catch { console.log(JSON.stringify({ status: 'default(parse)', keys: [] })); process.exit(0); }
const r = mergeAndValidate(u, d, { id: d.board, family: 'foxlib-c', pins: [] });
console.log(JSON.stringify({ status: r.status, keys: r.report.map(x => x.key) }));
""" % os.path.join(REPO, "js", "model", "schema.js")
        sp = tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False); sp.write(script); sp.close()
        for name, dpath, upath in js_cases:
            board = json.load(open(dpath)).get("board")
            cout = run(b, "cfg", dpath, upath, board).splitlines()
            c_status = cout[0].split("=", 1)[1]
            c_keys = [ln.split("cfg: ", 1)[1].split(" ->")[0] for ln in cout if ln.startswith("  cfg:")]
            r = subprocess.run([node, sp.name, dpath, upath], capture_output=True, text=True)
            try:
                js = json.loads(r.stdout.strip().splitlines()[-1])
            except Exception:
                js = {"status": "node-error: " + r.stderr[-200:], "keys": []}
            js_status = js["status"]
            # JS reports 'default(...)' with a single-item report and the C side with none; compare status + keys for partial only
            ok = js_status == c_status and (not c_status.startswith("partial") or js["keys"] == c_keys)
            check("%-44s %s" % (name, c_status), ok, "js=%s %s c=%s" % (js_status, js["keys"], c_keys))
        for f in tmp2 + [sp.name]:
            os.unlink(f)

    print("synth")
    for sr, shape, pre, level, tone in ((8000, "bright", 1, 0.5, 800), (8000, "sine", 0, 0.5, 800), (5000, "bright", 1, 0.7, 600), (8000, "bright", 1, 1.0, 2400), (8000, "sine", 1, 0.3, 300)):
        out = run(b, "synth", sr, shape, pre, level, 12, tone, "KY4ZR", "FOX", "DE", "KY4ZR").split()
        kv = dict(x.split("=") for x in out)
        n, exp, peak = int(kv["samples"]), int(kv["expected"]), float(kv["peak"])
        check("sr=%d %s pre=%d level=%.1f tone=%d: %d samples peak %.3f" % (sr, shape, pre, level, tone, n, peak), n == exp and level * 0.85 <= peak <= level * 1.001, kv)

    print("\n%s" % ("ALL OK" if not fails else "%d FAILURE(S)" % fails))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
