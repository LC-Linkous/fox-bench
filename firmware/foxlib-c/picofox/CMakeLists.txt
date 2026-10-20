# SPDX-License-Identifier: GPL-3.0-or-later
# fox-bench firmware for the AI6YM PicoFox hardware (RP2040 + Si5351).
#
#   export PICO_SDK_PATH=/path/to/pico-sdk        (2.1.x, with the tinyusb submodule)
#   cmake -S firmware/foxlib-c/picofox -B build -G Ninja && cmake --build build
#   -> build/foxbench-picofox.uf2 (copy to the RPI-RP2 drive)
cmake_minimum_required(VERSION 3.13)

set(PICO_BOARD picofox CACHE STRING "board")
list(APPEND PICO_BOARD_HEADER_DIRS ${CMAKE_CURRENT_LIST_DIR}/boards)
include(pico_sdk_import.cmake)

project(foxbench_picofox C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()

file(STRINGS ${CMAKE_CURRENT_LIST_DIR}/../VERSION FOXLIBC_VERSION LIMIT_COUNT 1)

# Compiled-in defaults: the morse-songs template's defaults for this board, embedded as a C string.
set(DEFAULTS_JSON ${CMAKE_CURRENT_LIST_DIR}/../../templates/morse-songs/defaults/picofox-foxlibc.json)
set(DEFAULTS_H ${CMAKE_CURRENT_BINARY_DIR}/builtin_defaults.h)
add_custom_command(OUTPUT ${DEFAULTS_H}
    COMMAND ${CMAKE_COMMAND} -DIN=${DEFAULTS_JSON} -DOUT=${DEFAULTS_H} -P ${CMAKE_CURRENT_LIST_DIR}/embed.cmake
    DEPENDS ${DEFAULTS_JSON} ${CMAKE_CURRENT_LIST_DIR}/embed.cmake)

set(CORE ${CMAKE_CURRENT_LIST_DIR}/../core)
set(FATFS ${CMAKE_CURRENT_LIST_DIR}/../third_party/fatfs)

add_executable(foxbench-picofox
    main.c console.c fox.c player.c si5351.c flash_disk.c msc_disk.c fatfs_diskio.c fs.c usb_descriptors.c
    ${CORE}/json.c ${CORE}/morse.c ${CORE}/melody.c ${CORE}/schedule.c ${CORE}/synth.c ${CORE}/sstv.c ${CORE}/cfg.c
    ${FATFS}/ff.c ${FATFS}/ffunicode.c
    ${DEFAULTS_H})

target_include_directories(foxbench-picofox PRIVATE ${CMAKE_CURRENT_LIST_DIR} ${CMAKE_CURRENT_BINARY_DIR} ${CORE} ${FATFS})
target_compile_definitions(foxbench-picofox PRIVATE
    FOXLIBC_VERSION="${FOXLIBC_VERSION}"
    JSON_MAX_NODES=4096 JSON_STR_BYTES=8192
    PICO_FLASH_ASSUME_CORE1_SAFE=0)
target_compile_options(foxbench-picofox PRIVATE -Wall -Wextra -Wno-unused-parameter)

target_link_libraries(foxbench-picofox
    pico_stdlib pico_multicore pico_unique_id pico_flash hardware_i2c hardware_gpio hardware_adc hardware_flash hardware_timer
    tinyusb_device tinyusb_board)

pico_add_extra_outputs(foxbench-picofox)
pico_set_program_name(foxbench-picofox "fox-bench PicoFox")
pico_set_program_version(foxbench-picofox "${FOXLIBC_VERSION}")
pico_set_program_url(foxbench-picofox "https://github.com/LC-Linkous/fox-bench")
pico_set_program_description(foxbench-picofox "fox-bench firmware for the PicoFox hardware (GPL-3.0-or-later)")
