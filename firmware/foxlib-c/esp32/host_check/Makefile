# SPDX-License-Identifier: GPL-3.0-or-later
# `make -C firmware/foxlib-c/esp32/host_check`: the application compiled with -fsyntax-only against stand-in ESP-IDF
# headers, so a typo or a bad call shape is caught without the SDK (the real build is CI's idf.py job). Not a test of
# behaviour: the stand-ins declare what the code uses and nothing else.
CC ?= gcc
CFLAGS ?= -std=gnu11 -Wall -Wextra -Werror -Wno-unused-parameter -fsyntax-only
APP := ../main
CORE := ../../core
DEFS := -DFOXLIBC_VERSION='"host"' -DBOARD_ID='"esp32c3-foxlibc"' -DTEMPLATE_VERSIONS='"wifi-beacon=1.0.1"'
check:
	$(CC) $(CFLAGS) $(DEFS) -I. -I$(APP) -I$(CORE) $(APP)/main.c $(APP)/console.c $(APP)/fs.c $(APP)/netfox.c $(APP)/led.c
	@echo "esp32 application: syntax ok"
