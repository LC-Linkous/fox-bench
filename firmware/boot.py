# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench boot.py -- for boards that show up on the computer as a CIRCUITPY drive (ESP32-S3, nRF52840).
#
# CircuitPython lets one side write the board's files: the computer, through the drive, or the board's own code.
# Out of the box it is the computer, also when no computer is attached. A fox writes its own files (finds.csv,
# near.csv), and the fox-bench page and tools/hw_smoke.py write through the serial port, which is the board's code
# doing the writing. So this file gives the filesystem to the board. The CIRCUITPY drive is then read-only on the
# computer; everything still reads.
#
# To give it back to the computer: at the page's console (or any serial terminal), after Ctrl-C,
#     import os; os.remove("boot.py")
# and press reset. If the board will not take that either, start it in safe mode (reset, then reset again while the
# LED blinks): boot.py is not run there.
# Distributed under GPL-3.0-or-later, WITHOUT ANY WARRANTY; see firmware/LICENSE.
import storage
storage.remount("/", readonly=False)
