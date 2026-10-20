# SPDX-License-Identifier: GPL-3.0-or-later
# Host build of the portable core + the parity harness. `make check` runs parity.py.
CC ?= gcc
CFLAGS ?= -std=c11 -O1 -g -Wall -Wextra -Werror -Wno-unused-parameter -D_GNU_SOURCE
CORE := ../core/json.c ../core/morse.c ../core/melody.c ../core/schedule.c ../core/synth.c ../core/cfg.c
BUILD ?= build

PF := ../picofox
SIMSRC := host_sim/sim_main.c host_sim/stubs.c $(PF)/fox.c

all: $(BUILD)/core_dump $(BUILD)/host_sim

# compiled-in defaults, same file the firmware embeds
$(BUILD)/builtin_defaults.h: ../../templates/morse-songs/defaults/picofox-foxlibc.json
	@mkdir -p $(BUILD)
	python3 -c "import sys;b=open(sys.argv[1],'rb').read();print('#pragma once\nstatic const unsigned char BUILTIN_DEFAULTS[] = {'+','.join(str(x) for x in b)+',0};\nstatic const unsigned BUILTIN_DEFAULTS_LEN = sizeof(BUILTIN_DEFAULTS) - 1;')" $< > $@

$(BUILD)/host_sim: $(SIMSRC) $(CORE) $(BUILD)/builtin_defaults.h ../core/*.h $(PF)/*.h
	$(CC) $(CFLAGS) -DFOXLIBC_VERSION='"host"' -Ihost_sim -I$(BUILD) -I$(PF) -I../core -o $@ $(SIMSRC) $(CORE) -lm

$(BUILD)/core_dump: core_dump.c $(CORE) ../core/*.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ core_dump.c $(CORE) -lm

check: $(BUILD)/core_dump $(BUILD)/host_sim
	python3 parity.py --bin $(BUILD)/core_dump
	python3 sim.py --bin $(BUILD)/host_sim

clean:
	rm -rf $(BUILD)

.PHONY: all check clean
