#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""build_mpy.py -- foxlib precompiled to .mpy, one set per CircuitPython major.

    python3 tools/build_mpy.py                 # build every major in firmware/mpy/pins.json (fetches mpy-cross)
    python3 tools/build_mpy.py --major 10      # one major
    python3 tools/build_mpy.py --mpy-cross P   # use this mpy-cross binary instead of fetching (its version is recorded)
    python3 tools/build_mpy.py --check         # exit 1 when a pinned set is missing or older than foxlib/

The set is build output, not source: CI builds it in the sim job and stages it into the site beside the PicoFox
UF2 (firmware/mpy/<major>/ and index.json are gitignored). The hosted page always has it; a checkout has it after
this tool has run, and until then Deploy's checkbox is disabled and says so.

Why: a CircuitPython board compiles a .py on import, and the compiler's peak heap is several times the source. On the
ESP32-C3 that peak, on top of the Wi-Fi and BLE stacks, was more than the board had (foxlib 1.10.7: MemoryError in
netcfg.py). A .mpy is bytecode: no compile, and about a third of the source size on flash. Deploy's "Precompiled
(.mpy)" writes this set instead of the sources (page 0.18.13).

Which mpy-cross: CircuitPython's own, not MicroPython's from PyPI (a different dialect). A .mpy loads on any build of
the same CircuitPython major (bytecode only, no native code); each major gets its own set, compiled with the pinned
tag's mpy-cross, fetched from Adafruit's S3 as the library bundle builder does
(https://adafruit-circuit-python.s3.amazonaws.com/bin/mpy-cross/). The pins: firmware/mpy/pins.json {"10": "10.3.2"}.

Output: firmware/mpy/<major>/foxlib/<module>.mpy and firmware/mpy/<major>/manifest.json (the tag, the mpy-cross
version line, foxlib's version, each source's sha256) and firmware/mpy/index.json (the majors built), which the page
reads.
"""
import hashlib, json, os, platform, stat, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "firmware", "foxlib")
OUT = os.path.join(ROOT, "firmware", "mpy")
PINS = os.path.join(OUT, "pins.json")
S3 = "https://adafruit-circuit-python.s3.amazonaws.com/bin/mpy-cross"
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "fox-bench")


def s3_url(tag):
    sysname, arch = platform.system(), platform.machine().lower()
    if sysname == "Linux" and arch in ("x86_64", "amd64"):
        return "%s/linux-amd64/mpy-cross-linux-amd64-%s.static" % (S3, tag)
    if sysname == "Linux" and arch.startswith("armv7"):
        return "%s/linux-raspbian/mpy-cross-linux-raspbian-%s.static-raspbian" % (S3, tag)
    if sysname == "Darwin":
        return "%s/macos/mpy-cross-macos-%s-universal" % (S3, tag)
    if sysname == "Windows" and arch in ("x86_64", "amd64"):
        return "%s/windows/mpy-cross-windows-%s.static.exe" % (S3, tag)
    return None


def fetch_mpy_cross(tag):
    """The prebuilt mpy-cross for `tag`, cached under ~/.cache/fox-bench. Raises with the URL when it cannot be had."""
    url = s3_url(tag)
    if url is None:
        raise SystemExit("no prebuilt mpy-cross for %s %s: build CircuitPython %s's mpy-cross and pass --mpy-cross" % (platform.system(), platform.machine(), tag))
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "mpy-cross-" + tag + (".exe" if os.name == "nt" else ""))
    if not os.path.exists(path):
        print("fetching %s" % url)
        import time
        for attempt in range(3):                      # a CI run should not go red on one dropped S3 connection
            try:
                with urllib.request.urlopen(url, timeout=60) as r, open(path + ".part", "wb") as f:
                    f.write(r.read())
                break
            except Exception as e:
                if attempt == 2:
                    raise SystemExit("could not fetch mpy-cross %s (%s): download it from %s and pass --mpy-cross" % (tag, e, url))
                print("  retrying (%s)" % e); time.sleep(5)
        os.replace(path + ".part", path)
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
    return path


def sources():
    return sorted(n for n in os.listdir(LIB) if n.endswith(".py"))


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def build(major, tag, mpy_cross):
    ver = subprocess.run([mpy_cross, "--version"], capture_output=True, text=True).stdout.strip()
    out = os.path.join(OUT, major, "foxlib")
    os.makedirs(out, exist_ok=True)
    for stale in os.listdir(out):
        os.remove(os.path.join(out, stale))
    files = {}
    for name in sources():
        src = os.path.join(LIB, name)
        dst = os.path.join(out, name[:-3] + ".mpy")
        subprocess.run([mpy_cross, "-o", dst, "-s", "foxlib/" + name, src], check=True)
        files[name] = {"sha256": sha(src), "mpy_size": os.path.getsize(dst), "mpy_sha256": sha(dst)}
    foxlib_version = open(os.path.join(LIB, "VERSION")).read().strip()
    man = {"circuitpython": tag, "mpy_cross": ver, "foxlib": foxlib_version, "files": files,
           "_": "built by tools/build_mpy.py; CI rebuilds with the same mpy-cross and compares (mpy-cross output is deterministic)"}
    json.dump(man, open(os.path.join(OUT, major, "manifest.json"), "w"), indent=1)
    open(os.path.join(OUT, major, "manifest.json"), "a").write("\n")
    total = sum(f["mpy_size"] for f in files.values())
    print("firmware/mpy/%s: %d modules, %d bytes of .mpy (%s, foxlib %s)" % (major, len(files), total, ver, foxlib_version))
    return man


def write_index(pins):
    idx = {"sets": {}, "_": "precompiled foxlib sets by CircuitPython major (tools/build_mpy.py); the page offers 'Precompiled (.mpy)' on Deploy for a board whose CircuitPython major has one"}
    for major in sorted(pins):
        mp = os.path.join(OUT, major, "manifest.json")
        if os.path.exists(mp):
            m = json.load(open(mp))
            idx["sets"][major] = {"circuitpython": m["circuitpython"], "foxlib": m["foxlib"], "files": sorted(n[:-3] + ".mpy" for n in m["files"])}
    json.dump(idx, open(os.path.join(OUT, "index.json"), "w"), indent=1)
    open(os.path.join(OUT, "index.json"), "a").write("\n")


def check(pins):
    """0 when every pinned major has a set built from the current sources and foxlib version; the reasons otherwise."""
    bad = []
    foxlib_version = open(os.path.join(LIB, "VERSION")).read().strip()
    for major, tag in sorted(pins.items()):
        mp = os.path.join(OUT, major, "manifest.json")
        if not os.path.exists(mp):
            bad.append("firmware/mpy/%s: no set built for CircuitPython %s (python3 tools/build_mpy.py)" % (major, tag)); continue
        m = json.load(open(mp))
        if m.get("circuitpython") != tag:
            bad.append("firmware/mpy/%s: built for %s, pin says %s" % (major, m.get("circuitpython"), tag))
        if tag not in (m.get("mpy_cross") or ""):
            bad.append("firmware/mpy/%s: built with '%s', not CircuitPython %s's mpy-cross (rebuild without --mpy-cross, or with the right one)" % (major, m.get("mpy_cross"), tag))
        if m.get("foxlib") != foxlib_version:
            bad.append("firmware/mpy/%s: built from foxlib %s, repo has %s (rebuild)" % (major, m.get("foxlib"), foxlib_version))
        for name in sources():
            f = m["files"].get(name)
            if f is None:
                bad.append("firmware/mpy/%s: %s not in the set (rebuild)" % (major, name)); continue
            if f["sha256"] != sha(os.path.join(LIB, name)):
                bad.append("firmware/mpy/%s: %s changed since the set was built (rebuild)" % (major, name))
            dst = os.path.join(OUT, major, "foxlib", name[:-3] + ".mpy")
            if not os.path.exists(dst) or sha(dst) != f["mpy_sha256"]:
                bad.append("firmware/mpy/%s: %s.mpy missing or not the manifest's" % (major, name[:-3]))
        for extra in set(m["files"]) - set(sources()):
            bad.append("firmware/mpy/%s: %s in the set but not in foxlib/ (rebuild)" % (major, extra))
    ip = os.path.join(OUT, "index.json")
    if not os.path.exists(ip) or sorted(json.load(open(ip))["sets"]) != sorted(k for k in pins if os.path.exists(os.path.join(OUT, k, "manifest.json"))):
        bad.append("firmware/mpy/index.json: not the built sets (rebuild)")
    return bad


def main():
    args = sys.argv[1:]
    pins = {k: v for k, v in json.load(open(PINS)).items() if not k.startswith("_")}
    if "--check" in args:
        bad = check(pins)
        for b in bad:
            print(b)
        print("mpy sets: %s" % ("ok, %d major(s)" % len(pins) if not bad else "%d problem(s)" % len(bad)))
        return 1 if bad else 0
    majors = [args[args.index("--major") + 1]] if "--major" in args else sorted(pins)
    given = args[args.index("--mpy-cross") + 1] if "--mpy-cross" in args else None
    if given and len(majors) > 1:
        raise SystemExit("--mpy-cross is one binary for one major: add --major")
    for major in majors:
        tag = pins[major]
        build(major, tag, given or fetch_mpy_cross(tag))
    write_index(pins)
    return 0


if __name__ == "__main__":
    sys.exit(main())
