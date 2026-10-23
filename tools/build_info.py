#!/usr/bin/env python3
"""Write the fingerprint of a foxlib-c build beside its UF2, and enforce the RAM budget.

    python3 tools/build_info.py <build-dir> [--out <json>] [--bss-budget <bytes>]

The JSON ({version, commit, pico_sdk, gcc, sha256, size, text, bss, built}) is what the site serves next to
foxbench-picofox.uf2 (boards/picofox-foxlibc.json firmware.build_info): the Board tab shows it and refuses a
fetched image whose sha256/size differ, and a release attaches it. Two builds that differ only in this file's
`built` time are the same binary if their sha256 agree. Exits 1 when static RAM (bss) exceeds the budget.
"""
import argparse, datetime, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run(*cmd, **kw):
    try: return subprocess.run(cmd, capture_output=True, text=True, check=True, **kw).stdout.strip()
    except Exception: return ""

def uf2_payload(data):
    """The flash payload of a UF2, block headers stripped (same walk as js/model/uf2.js uf2Payload)."""
    out = bytearray()
    for o in range(0, len(data) - 511, 512):
        n = min(int.from_bytes(data[o + 16:o + 20], "little"), 476)
        out += data[o + 32:o + 32 + n]
    return bytes(out)

def version_tag(data):
    """'FOXLIBC-VERSION:<v>' inside the image (console.c VERSION_TAG, 0.1.9+), or None."""
    m = re.search(rb"FOXLIBC-VERSION:(\d+\.\d+\.\d+)", uf2_payload(data))
    return m.group(1).decode() if m else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build_dir")
    ap.add_argument("--out", default=None)
    ap.add_argument("--bss-budget", type=int, default=220_000, help="RP2040 has 264 KB SRAM; stacks, the USB task and FatFs live outside bss")
    ap.add_argument("--size-tool", default=os.environ.get("ARM_SIZE", "arm-none-eabi-size"))
    a = ap.parse_args()
    uf2 = os.path.join(a.build_dir, "foxbench-picofox.uf2"); elf = os.path.join(a.build_dir, "foxbench-picofox.elf")
    data = open(uf2, "rb").read()
    info = {
        "name": "foxbench-picofox.uf2",
        "version": open(os.path.join(ROOT, "firmware/foxlib-c/VERSION")).read().strip(),
        "commit": os.environ.get("GITHUB_SHA") or run("git", "-C", ROOT, "rev-parse", "HEAD"),
        "pico_sdk": run("git", "-C", os.environ.get("PICO_SDK_PATH", ""), "rev-parse", "HEAD") if os.environ.get("PICO_SDK_PATH") else "",
        "gcc": "",
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "text": None, "bss": None,
        "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    gcc = run(a.size_tool.replace("size", "gcc"), "--version")
    if gcc: info["gcc"] = gcc.splitlines()[0]
    sz = run(a.size_tool, elf)
    if sz:
        cols = sz.splitlines()[-1].split()
        info["text"], info["bss"] = int(cols[0]), int(cols[2])
    # The image must say what VERSION says: a stale configure (CMake read VERSION once), a dropped VERSION_TAG symbol
    # or a mis-staged artifact would otherwise ship a UF2 labelled with a version it is not.
    tag = version_tag(data)
    if tag != info["version"]:
        print(f"build_info: the UF2 carries FOXLIBC-VERSION:{tag} but firmware/foxlib-c/VERSION is {info['version']} — stale build dir? (reconfigure)", file=sys.stderr)
        return 1
    info["version_tag"] = tag
    out = a.out or os.path.join(a.build_dir, "foxbench-picofox.json")
    json.dump(info, open(out, "w"), indent=2); open(out, "a").write("\n")
    print(json.dumps(info, indent=2))
    if info["bss"] is not None and info["bss"] > a.bss_budget:
        print(f"RAM budget exceeded: bss {info['bss']} > {a.bss_budget}", file=sys.stderr); return 1
    return 0

if __name__ == "__main__": sys.exit(main())
