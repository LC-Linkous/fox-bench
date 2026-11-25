# SPDX-License-Identifier: GPL-3.0-or-later
# `make -C firmware/foxlib-c/esp32/host_check`: the application compiled with -fsyntax-only against stand-in ESP-IDF
# headers, so a typo or a bad call shape is caught without the SDK (the real build is CI's idf.py job). Not a test of
# behaviour: the stand-ins declare what the code uses and nothing else.
CC ?= gcc
CFLAGS ?= -std=gnu11 -Wall -Wextra -Werror -Wno-unused-parameter -fsyntax-only
APP := ../main
CORE := ../../core
# TEMPLATE_VERSIONS comes from a generated header in the real build (main/CMakeLists.txt); written here the same way.
# The toolchain's <sys/syslimits.h> names (LINE_MAX, PATH_MAX, ...) are included so a clash is caught here, not by idf.py.
DEFS := -DFOXLIBC_VERSION='"host"' -DBOARD_ID='"esp32c3-foxlibc"' -include limits.h
check:
	@mkdir -p build && printf '#define TEMPLATE_VERSIONS "ble-beacon=1.0.1,wifi-beacon=1.0.0"\n' > build/template_versions.h
	$(CC) $(CFLAGS) $(DEFS) -I. -Ibuild -I$(APP) -I$(CORE) $(APP)/main.c $(APP)/console.c $(APP)/fs.c $(APP)/netfox.c $(APP)/led.c
	@echo "esp32 application: syntax ok"
