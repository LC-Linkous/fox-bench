#pragma once
#include <stdio.h>
#define PICO_UNIQUE_BOARD_ID_SIZE_BYTES 8
static inline void pico_get_unique_board_id_string(char *buf, unsigned n) { snprintf(buf, n, "%s", "E66138935F0A1B2C"); }
