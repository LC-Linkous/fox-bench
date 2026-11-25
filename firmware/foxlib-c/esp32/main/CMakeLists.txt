# SPDX-License-Identifier: GPL-3.0-or-later
set(CORE ${CMAKE_CURRENT_LIST_DIR}/../../core)
set(TEMPLATES ${CMAKE_CURRENT_LIST_DIR}/../../../templates)
file(READ ${CMAKE_CURRENT_LIST_DIR}/../../VERSION FOXLIBC_VERSION)
string(STRIP "${FOXLIBC_VERSION}" FOXLIBC_VERSION)
set(BOARD_ID "${IDF_TARGET}-foxlibc")

# the compiled-in defaults: the wifi-beacon defaults for this target (a fox with no defaults.json runs these)
configure_file(${TEMPLATES}/wifi-beacon/defaults/${BOARD_ID}.json ${CMAKE_CURRENT_BINARY_DIR}/builtin_defaults.json COPYONLY)
# template versions for the banner (template=<id>/<version>), read from the catalog at build time
# (a generated header, not a -D: the string's ';' is CMake's list separator and would split it into stray defines)
execute_process(COMMAND python3 -c "import json,glob,os;print(','.join('%s=%s'%(os.path.basename(os.path.dirname(p)),json.load(open(p))['version']) for p in sorted(glob.glob('${TEMPLATES}/*/template.json')) if json.load(open(p)).get('contract')=='net'))"
                OUTPUT_VARIABLE TEMPLATE_VERSIONS OUTPUT_STRIP_TRAILING_WHITESPACE)
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/template_versions.h "#define TEMPLATE_VERSIONS \"${TEMPLATE_VERSIONS}\"\n")

idf_component_register(SRCS main.c console.c fs.c netfox.c led.c ${CORE}/json.c ${CORE}/report.c ${CORE}/netcfg.c ${CORE}/filexfer.c
                       INCLUDE_DIRS . ${CORE} ${CMAKE_CURRENT_BINARY_DIR}
                       EMBED_TXTFILES ${CMAKE_CURRENT_BINARY_DIR}/builtin_defaults.json
                       REQUIRES esp_wifi nvs_flash esp_event spiffs driver esp_timer esp_netif)
target_compile_definitions(${COMPONENT_LIB} PRIVATE FOXLIBC_VERSION="${FOXLIBC_VERSION}" BOARD_ID="${BOARD_ID}")
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Wno-unused-parameter)
