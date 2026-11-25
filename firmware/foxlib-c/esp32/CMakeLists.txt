# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench firmware for the Espressif boards (ESP-IDF). One source tree, four targets:
#   idf.py set-target esp32c3 build      (also esp32c6, esp32c5, esp32s3)
# The board id in the banner is "<target>-foxlibc" (boards/<target>-foxlibc.json); the image is build/foxbench-<target>.bin.
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(foxbench-${IDF_TARGET})
