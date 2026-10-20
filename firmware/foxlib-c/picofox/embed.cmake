# SPDX-License-Identifier: GPL-3.0-or-later
# cmake -DIN=file -DOUT=header -P embed.cmake : embed a text file as `static const char BUILTIN_DEFAULTS[]`.
file(READ ${IN} CONTENT HEX)
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," BYTES "${CONTENT}")
file(WRITE ${OUT} "/* generated from ${IN} -- do not edit */\n#pragma once\nstatic const unsigned char BUILTIN_DEFAULTS[] = { ${BYTES} 0x00 };\nstatic const unsigned BUILTIN_DEFAULTS_LEN = sizeof(BUILTIN_DEFAULTS) - 1;\n")
