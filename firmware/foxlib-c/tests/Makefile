# SPDX-License-Identifier: GPL-3.0-or-later
# Host build of the portable core + the parity harness. `make check` runs parity.py.
CC ?= gcc
CFLAGS ?= -std=c11 -O1 -g -Wall -Wextra -Werror -Wno-unused-parameter -D_GNU_SOURCE
CORE := ../core/json.c ../core/morse.c ../core/melody.c ../core/schedule.c ../core/synth.c ../core/cfg.c
BUILD ?= build

all: $(BUILD)/core_dump

$(BUILD)/core_dump: core_dump.c $(CORE) ../core/*.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ core_dump.c $(CORE) -lm

check: $(BUILD)/core_dump
	python3 parity.py --bin $(BUILD)/core_dump

clean:
	rm -rf $(BUILD)

.PHONY: all check clean
