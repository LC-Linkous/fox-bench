#!/usr/bin/env python3
"""Write the fingerprint of a foxlib-c ESP32 build beside its .bin.

    python3 tools/build_info_esp.py <idf build dir> <target> [--out <json>]

The JSON ({version, commit, idf, gcc, target, sha256, size, built}) is what the site serves next to
foxbench-<target>.bin (boards/<target>-foxlibc.json firmware.build_info): the Board tab shows it and refuses a fetched
image whose sha256/size differ. `version` is the FOXLIBC-VERSION: tag read out of the image itself (console.c), so an
old download loaded by hand cannot pass for the current build.
"""
import argparse, datetime, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run(*cmd):
    try: return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()
    except Exception: return ""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build_dir"); ap.add_argument("target"); ap.add_argument("--out", default=None)
    a = ap.parse_args()
    binp = os.path.join(a.build_dir, f"foxbench-{a.target}.bin")
    if not os.path.exists(binp):
        # idf.py names the app after the project; the merged, flash-at-0x0 image is what the page writes
        sys.exit(f"{binp} missing: run `idf.py merge-bin -o foxbench-{a.target}.bin` (or esptool merge_bin) first")
    data = open(binp, "rb").read()
    m = re.search(rb"FOXLIBC-VERSION:(\d+\.\d+\.\d+)", data)
    version = m.group(1).decode() if m else None
    repo_version = open(os.path.join(ROOT, "firmware", "foxlib-c", "VERSION")).read().strip()
    if version != repo_version:
        sys.exit(f"the image says FOXLIBC-VERSION:{version}, the repository {repo_version}")
    info = {
        "version": version, "target": a.target,
        "commit": run("git", "-C", ROOT, "rev-parse", "--short=12", "HEAD") or None,
        "idf": run("idf.py", "--version") or os.environ.get("IDF_VERSION") or None,
        "gcc": (run(f"xtensa-{a.target}-elf-gcc" if a.target == "esp32s3" else "riscv32-esp-elf-gcc", "--version").split("\n") or [""])[0] or None,
        "sha256": hashlib.sha256(data).hexdigest(), "size": len(data),
        "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    out = a.out or os.path.join(a.build_dir, f"foxbench-{a.target}.json")
    json.dump(info, open(out, "w"), indent=1); open(out, "a").write("\n")
    print(f"{out}: {version} {info['size']} bytes sha256 {info['sha256'][:12]} idf {info['idf']}")

if __name__ == "__main__": main()
