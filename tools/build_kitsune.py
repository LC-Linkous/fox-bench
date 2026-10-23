#!/usr/bin/env python3
"""build_kitsune.py — fox-bench's build of kitsune images for the compiled family's firmware card.

    python3 tools/build_kitsune.py <kitsune checkout> <out dir> --commit <sha> [--only board1,board2]

kitsune (https://github.com/rfhs/kitsune) belongs to its authors; this builds it unchanged, from the commit named,
with PlatformIO, and merges each environment's pieces into one image at the board's flash offsets with esptool's
merge_bin, so the page can write it in one go. The output is <out>/<env>.bin plus manifest.json:

    { "project": "kitsune", "source": "...", "commit": "<sha>", "built": "...", "images": [
        { "board": "<fox-bench target id>", "template": "<fox-bench template id>", "tier": "easy", "mode": "AP",
          "env": "m5atom-easy-ap", "file": "m5atom-easy-ap.bin", "sha256": "...", "size": 123456, "chip": "esp32", "offset": "0x0",
          "pieces": [{"offset": "0x1000", "file": "bootloader.bin"}, ...], "bootloader_offset": "0x1000" } ] }

"offset" is always 0x0: the merged file is a whole-flash image padded from address 0 (merge_bin --target-offset 0x0), and the
page writes it there; the chip's bootloader offset is recorded for the record, not for flashing. The build tools are pinned
(PIO_VERSION / ESPTOOL_VERSION below) and recorded in the manifest, so "fox-bench's build at commit X" means one thing.

Which environments are built, and how they map to targets and templates, comes from the compiled-family target
descriptors (boards/*-kitsune.json, "firmware.envs") — the mapping lives in the catalog, not here. Runs only in the
CI job gated by the repository variable KITSUNE_BUILD (see .github/workflows/ci.yml): nothing of kitsune is hosted
without the project's agreement.
"""
import argparse, datetime, glob, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = "https://github.com/rfhs/kitsune"
# Pinned in ci.yml's kitsune job (pip install platformio==… esptool==…); the manifest records what actually ran.
PIO_VERSION = "6.1.18"
ESPTOOL_VERSION = "4.8.1"

def tool_versions():
    out = {}
    for mod, key in (("platformio", "platformio"), ("esptool", "esptool")):
        try: out[key] = subprocess.run([sys.executable, "-m", "pip", "show", mod], capture_output=True, text=True).stdout.split("Version:")[1].split()[0]
        except Exception: out[key] = "?"
    return out

def run(cmd, cwd=None):
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)

def flash_args(project, env):
    """The offsets and files PlatformIO would flash for an env, from its own verbose upload command."""
    # `pio run -t upload -v` would need a port; the build prints FLASH_EXTRA_IMAGES in the build env instead
    out = subprocess.run(["pio", "run", "-e", env, "-t", "envdump"], cwd=project, capture_output=True, text=True).stdout
    extra, app_off = parse_envdump(out)
    if not extra: raise SystemExit(f"{env}: envdump printed no FLASH_EXTRA_IMAGES — PlatformIO's output changed; the merge offsets cannot be trusted")
    return extra, app_off

ENVDUMP_SAMPLE = """'ESP32_APP_OFFSET': '0x10000',
 'FLASH_EXTRA_IMAGES': [('0x1000', '/home/u/.platformio/packages/framework-arduinoespressif32/tools/sdk/esp32/bin/bootloader_dio_40m.bin'),
                        ('0x8000', '/home/u/kitsune/wifi/.pio/build/m5atom-easy-ap/partitions.bin'),
                        ('0xe000', '/home/u/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin')],"""

def parse_envdump(out):
    m = re.search(r"'FLASH_EXTRA_IMAGES':\s*(\[.*?\])", out, re.S)
    extra = []
    if m:
        for off, path in re.findall(r"\(\s*'(0x[0-9a-fA-F]+)'\s*,\s*'([^']+)'\s*\)", m.group(1)): extra.append((off, path))
    app_off = re.search(r"'ESP32_APP_OFFSET':\s*'(0x[0-9a-fA-F]+)'", out)
    return extra, app_off.group(1) if app_off else "0x10000"

def selftest():
    """--selftest: the envdump parser against a captured sample, and the merge command shape. No PlatformIO needed."""
    extra, app = parse_envdump(ENVDUMP_SAMPLE)
    assert [o for o, _ in extra] == ["0x1000", "0x8000", "0xe000"], extra
    assert extra[0][1].endswith("bootloader_dio_40m.bin") and app == "0x10000", (extra, app)
    extra2, app2 = parse_envdump("nothing useful")
    assert extra2 == [] and app2 == "0x10000"
    print("build_kitsune selftest ok"); return 0

def main():
    if "--selftest" in sys.argv: return selftest()
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
            # --target-offset 0x0 (esptool's default, stated): the merged file is a whole-flash image padded from address 0, and
            # the page writes it at 0x0 — the bootloader lands at hw.flash.offset inside it. manifest "offset" says 0x0 for that reason.
            cmd = ["python3", "-m", "esptool", "--chip", hw["flash"]["chip"], "merge_bin", "-o", out_bin, "--flash_mode", "keep", "--flash_size", "keep", "--target-offset", "0x0"]
            for off, path in pieces: cmd += [off, path]
            run(cmd)
            data = open(out_bin, "rb").read()
            images.append({"board": t["id"], "template": e.get("template"), "tier": e.get("tier"), "mode": e.get("mode"), "env": e["env"], "file": os.path.basename(out_bin),
                           "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "chip": hw["flash"]["chip"], "offset": "0x0",
                           "pieces": [{"offset": off, "file": os.path.basename(path)} for off, path in pieces], "bootloader_offset": hw["flash"]["offset"]})
    manifest = {"project": "kitsune", "source": SOURCE, "commit": a.commit, "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "tools": tool_versions(), "note": "fox-bench's build of kitsune at this commit, unchanged; kitsune belongs to its authors. Not an official kitsune release.", "images": images}
    json.dump(manifest, open(os.path.join(a.out, "manifest.json"), "w"), indent=2)
    print(json.dumps({k: v for k, v in manifest.items() if k != "images"}, indent=2)); print(f"{len(images)} image(s)")
    return 0 if images else 1

if __name__ == "__main__": sys.exit(main())
