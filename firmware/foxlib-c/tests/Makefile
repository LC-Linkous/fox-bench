# SPDX-License-Identifier: GPL-3.0-or-later
# Host build of the portable core + the parity harness. `make check` runs parity.py.
CC ?= gcc
CFLAGS ?= -std=gnu11 -O1 -g -Wall -Wextra -Werror -Wno-unused-parameter -D_GNU_SOURCE
# The host builds run the JSON parser and the validator on files anyone can put on the drive: AddressSanitizer and
# UBSan catch what -Wall cannot. SANITIZE= (empty) turns them off for a compiler without them.
SANITIZE ?= -fsanitize=address,undefined -fno-sanitize-recover=undefined
CFLAGS += $(SANITIZE)
CORE := ../core/json.c ../core/morse.c ../core/melody.c ../core/schedule.c ../core/synth.c ../core/sstv.c ../core/cfg.c
BUILD ?= build

PF := ../picofox
SIMSRC := host_sim/sim_main.c host_sim/stubs.c $(PF)/fox.c

CONSRC := host_sim/console_main.c host_sim/stubs.c $(PF)/fox.c $(PF)/console.c

all: $(BUILD)/core_dump $(BUILD)/host_sim $(BUILD)/console_sim $(BUILD)/si5351_sim

# the real si5351.c over a fake I2C controller with a register image; si5351_ref.py checks the math
$(BUILD)/si5351_sim: host_sim/si5351_main.c $(PF)/si5351.c $(PF)/si5351.h host_sim/hardware/*.h host_sim/pico.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -Ihost_sim -I$(PF) -o $@ host_sim/si5351_main.c $(PF)/si5351.c -lm

# the real console.c (command parser, reply text, 1200-touch callbacks) over the same fox.c and stubs
$(BUILD)/console_sim: $(CONSRC) $(CORE) $(BUILD)/builtin_defaults.h ../core/*.h $(PF)/*.h host_sim/*.h
	$(CC) $(CFLAGS) -DFOXLIBC_VERSION='"host"' -DSIM_REAL_CONSOLE -Ihost_sim -I$(BUILD) -I$(PF) -I../core -o $@ $(CONSRC) $(CORE) -lm

# compiled-in defaults, same file the firmware embeds
$(BUILD)/builtin_defaults.h: ../../templates/morse-songs/defaults/picofox-foxlibc.json
	@mkdir -p $(BUILD)
	python3 -c "import sys;b=open(sys.argv[1],'rb').read();print('#pragma once\nstatic const unsigned char BUILTIN_DEFAULTS[] = {'+','.join(str(x) for x in b)+',0};\nstatic const unsigned BUILTIN_DEFAULTS_LEN = sizeof(BUILTIN_DEFAULTS) - 1;')" $< > $@

$(BUILD)/host_sim: $(SIMSRC) $(CORE) $(BUILD)/builtin_defaults.h ../core/*.h $(PF)/*.h
	$(CC) $(CFLAGS) -DFOXLIBC_VERSION='"host"' -Ihost_sim -I$(BUILD) -I$(PF) -I../core -o $@ $(SIMSRC) $(CORE) -lm

$(BUILD)/core_dump: core_dump.c $(CORE) ../core/*.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ core_dump.c $(CORE) -lm

# a deterministic mutational fuzzer for the parser + validator, run under the sanitizers (F12)
$(BUILD)/json_fuzz: json_fuzz.c $(CORE) ../core/*.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ json_fuzz.c $(CORE) -lm

FUZZ_ITERS ?= 20000
fuzz: $(BUILD)/json_fuzz
	$(BUILD)/json_fuzz ../../templates/morse-songs/defaults/picofox-foxlibc.json 1 $(FUZZ_ITERS) ../../templates/*/defaults/picofox-foxlibc.json

check: $(BUILD)/core_dump $(BUILD)/host_sim $(BUILD)/console_sim $(BUILD)/si5351_sim fuzz
	python3 parity.py --bin $(BUILD)/core_dump
	python3 sim.py --bin $(BUILD)/host_sim
	python3 console_test.py --bin $(BUILD)/console_sim
	python3 si5351_ref.py --bin $(BUILD)/si5351_sim

clean:
	rm -rf $(BUILD)

.PHONY: all check clean fuzz
