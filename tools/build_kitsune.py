#!/usr/bin/env python3
"""build_kitsune.py — fox-bench's build of kitsune images for the compiled family's firmware card.

    python3 tools/build_kitsune.py <kitsune checkout> <out dir> --commit <sha> [--only board1,board2]

kitsune (https://github.com/rfhs/kitsune) belongs to its authors; this builds it unchanged, from the commit named,
with PlatformIO, and merges each environment's pieces into one image at the board's flash offsets with esptool's
merge_bin, so the page can write it in one go. The output is <out>/<env>.bin plus manifest.json:

    { "project": "kitsune", "source": "...", "commit": "<sha>", "built": "...", "images": [
        { "board": "<fox-bench target id>", "template": "<fox-bench template id>", "tier": "easy", "mode": "AP",
          "env": "m5atom-easy-ap", "file": "m5atom-easy-ap.bin", "sha256": "...", "size": 123456, "chip": "esp32", "offset": "0x1000" } ] }

Which environments are built, and how they map to targets and templates, comes from the compiled-family target
descriptors (boards/*-kitsune.json, "firmware.envs") — the mapping lives in the catalog, not here. Runs only in the
CI job gated by the repository variable KITSUNE_BUILD (see .github/workflows/ci.yml): nothing of kitsune is hosted
without the project's agreement.
"""
import argparse, datetime, glob, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = "https://github.com/rfhs/kitsune"

def run(cmd, cwd=None):
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)

def flash_args(project, env):
    """The offsets and files PlatformIO would flash for an env, from its own verbose upload command."""
    # `pio run -t upload -v` would need a port; the build prints FLASH_EXTRA_IMAGES in the build env instead
    out = subprocess.run(["pio", "run", "-e", env, "-t", "envdump"], cwd=project, capture_output=True, text=True).stdout
    m = re.search(r"'FLASH_EXTRA_IMAGES':\s*(\[.*?\])", out, re.S)
    extra = []
    if m:
        for off, path in re.findall(r"\(\s*'(0x[0-9a-fA-F]+)'\s*,\s*'([^']+)'\s*\)", m.group(1)): extra.append((off, path))
    app_off = re.search(r"'ESP32_APP_OFFSET':\s*'(0x[0-9a-fA-F]+)'", out)
    return extra, app_off.group(1) if app_off else "0x10000"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("checkout"); ap.add_argument("out"); ap.add_argument("--commit", required=True); ap.add_argument("--only", default="")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    only = set(x for x in a.only.split(",") if x)
    targets = []
    for f in sorted(glob.glob(os.path.join(ROOT, "boards", "*.json"))):
        t = json.load(open(f))
        if t.get("family") == "compiled" and t.get("firmware", {}).get("envs"): targets.append(t)
    hardware = {h["id"]: h for h in (json.load(open(f)) for f in glob.glob(os.path.join(ROOT, "hardware", "*.json")) if not f.endswith("index.json"))}
    images = []
    for t in targets:
        if only and t["id"] not in only: continue
        hw = hardware[t["hardware"]]
        for e in t["firmware"]["envs"]:      # { "env", "project", "template", "tier", "mode" }
            project = os.path.join(a.checkout, e["project"])
            run(["pio", "run", "-e", e["env"]], cwd=project)
            build = os.path.join(project, ".pio", "build", e["env"])
            extra, app_off = flash_args(project, e["env"])
            pieces = [(off, path if os.path.isabs(path) else os.path.join(project, path)) for off, path in extra] + [(app_off, os.path.join(build, "firmware.bin"))]
            out_bin = os.path.join(a.out, e["env"] + ".bin")
            cmd = ["python3", "-m", "esptool", "--chip", hw["flash"]["chip"], "merge_bin", "-o", out_bin, "--flash_mode", "keep", "--flash_size", "keep"]
            for off, path in pieces: cmd += [off, path]
            run(cmd)
            data = open(out_bin, "rb").read()
            images.append({"board": t["id"], "template": e.get("template"), "tier": e.get("tier"), "mode": e.get("mode"), "env": e["env"], "file": os.path.basename(out_bin),
                           "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "chip": hw["flash"]["chip"], "offset": hw["flash"]["offset"]})
    manifest = {"project": "kitsune", "source": SOURCE, "commit": a.commit, "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "note": "fox-bench's build of kitsune at this commit, unchanged; kitsune belongs to its authors. Not an official kitsune release.", "images": images}
    json.dump(manifest, open(os.path.join(a.out, "manifest.json"), "w"), indent=2)
    print(json.dumps({k: v for k, v in manifest.items() if k != "images"}, indent=2)); print(f"{len(images)} image(s)")
    return 0 if images else 1

if __name__ == "__main__": sys.exit(main())
