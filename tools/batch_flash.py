#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# fox-bench tools/batch_flash.py — headless batch flasher. Same CSV columns as the Fleet tab (plus the Fleet tab adds uid/action/template/profile/callsign/freq/seed/result).
"""
ESP32-C3 batch flasher.
Detects a newly-connected board, erases, flashes, logs chip info to CSV.

Connect fox and run. This is designed for flashing a batch of foxes back to default CircuitPython.
This does NOT install the fox firmware, so it can be used with other boards too.

If firmware is already flashed and TXing, then hold down the B button on the esp32s when plugging in the 
USB. This will out the fox in bootloader mode.

Ctrl + C to stop program. 
A 'flash_log.csv' data with board data has been created to log MAC addresses and board info.

pip install pyserial esptool
"""

import csv
import os
import re
import subprocess
import sys
import time
from datetime import datetime

import serial.tools.list_ports  # pip install pyserial

# ---------------- CONFIG ----------------
EXCLUDE_PORTS = ["COM1", "COM3", "COM4"]          # known/permanent devices
CHIP = "esp32c3"
FIRMWARE = "adafruit-circuitpython-seeed_xiao_esp32c3-en_US-10.2.1.bin"   # download from circuitpython.org/board/seeed_xiao_esp32c3
LOG_FILE = "flash_log.csv"
FLASH_ADDR = "0x0"
# ----------------------------------------

FIELDS = ["board_number", "timestamp", "port", "chip_type", "revision",
          "features", "crystal", "usb_mode", "mac", "erase_ok", "flash_ok", "notes"]


def candidate_ports():
    return [p.device for p in serial.tools.list_ports.comports()
            if p.device not in EXCLUDE_PORTS]


def wait_for_board(timeout=300):
    """Wait until exactly one non-excluded port appears."""
    baseline = set(candidate_ports())
    if baseline:
        print(f"Ports already present: {sorted(baseline)}")
        if len(baseline) == 1:
            return baseline.pop()
        print("Unplug extras or add them to EXCLUDE_PORTS.")

    print("Waiting for board...", end="", flush=True)
    start = time.time()
    while time.time() - start < timeout:
        now = set(candidate_ports())
        new = now - baseline
        if len(new) == 1:
            port = new.pop()
            print(f" found {port}")
            time.sleep(1.0)  # let the port settle
            return port
        if len(new) > 1:
            print(f"\nMultiple new ports {sorted(new)} - unplug one.")
            baseline = now
        time.sleep(0.4)
    print(" timeout.")
    return None


def run_esptool(port, *args):
    cmd = [sys.executable, "-m", "esptool", "--chip", CHIP, "--port", port, *args]
    print(f"\n> {' '.join(cmd)}\n")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    print(out)
    return proc.returncode == 0, out


def parse_chip_info(output):
    patterns = {
        "chip_type": r"Chip type:\s*(.+?)(?:\s*\(revision\s*(\S+?)\))?\s*$",
        "features": r"Features:\s*(.+)",
        "crystal": r"Crystal frequency:\s*(.+)",
        "usb_mode": r"USB mode:\s*(.+)",
        "mac": r"MAC:\s*([0-9a-fA-F:]{17})",
    }
    info = {k: "" for k in ["chip_type", "revision", "features", "crystal", "usb_mode", "mac"]}
    for line in output.splitlines():
        line = line.strip()
        m = re.match(patterns["chip_type"], line)
        if m:
            info["chip_type"] = m.group(1).strip()
            info["revision"] = (m.group(2) or "").strip()
            continue
        for key in ("features", "crystal", "usb_mode", "mac"):
            m = re.match(patterns[key], line)
            if m:
                info[key] = m.group(1).strip()
    return info


def append_log(row):
    new = not os.path.exists(LOG_FILE)
    with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        w.writerow(row)


def next_board_number():
    if not os.path.exists(LOG_FILE):
        return 1
    with open(LOG_FILE, newline="", encoding="utf-8") as f:
        nums = [int(r["board_number"]) for r in csv.DictReader(f)
                if r["board_number"].isdigit()]
    return max(nums, default=0) + 1


def main():
    if not os.path.exists(FIRMWARE):
        sys.exit(f"Firmware not found: {FIRMWARE}")

    board_no = next_board_number()
    print(f"Excluded ports: {EXCLUDE_PORTS}")
    print(f"Firmware: {FIRMWARE}")
    print(f"Starting at board #{board_no}. Ctrl-C to quit.\n")

    while True:
        print("=" * 60)
        print(f"BOARD #{board_no} - plug it in now")
        port = wait_for_board()
        if not port:
            if input("Retry? [Y/n] ").strip().lower() == "n":
                break
            continue

        row = {f: "" for f in FIELDS}
        row.update(board_number=board_no,
                   timestamp=datetime.now().isoformat(timespec="seconds"),
                   port=port)

        erase_ok, erase_out = run_esptool(port, "erase-flash")
        row.update(parse_chip_info(erase_out))
        row["erase_ok"] = erase_ok

        if erase_ok:
            flash_ok, _ = run_esptool(port, "write-flash", "-z", FLASH_ADDR, FIRMWARE)
            row["flash_ok"] = flash_ok
        else:
            row["flash_ok"] = False
            print("!! Erase failed - skipping flash.")

        append_log(row)

        status = "OK" if row["erase_ok"] and row["flash_ok"] else "FAILED"
        print(f"\n### BOARD #{board_no}: {status}  MAC={row['mac'] or 'unknown'}")
        print(f"Logged to {LOG_FILE}\n")

        if status == "OK":
            board_no += 1
        else:
            note = input("Note (blank = retry same number): ").strip()
            if note:
                row["notes"] = note
                board_no += 1

        input("Unplug board, then press Enter for the next one...")
        while candidate_ports():
            time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")