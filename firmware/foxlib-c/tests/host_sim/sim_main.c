/* SPDX-License-Identifier: GPL-3.0-or-later
 * host_sim: boot fox.c against the stubs on a virtual clock and dump what the "hardware" saw.
 *   host_sim DIR [--cap-ms N] [--stop-after-unkeys N] [--host-drive] */
#include <stdlib.h>
#include <string.h>
#include "fox.h"

extern uint64_t sim_now_us; extern const char *sim_dir; extern int sim_host_drive, sim_unkeys, sim_charging;
void sim_player_tick(void); void sim_dump(void);

/* Under AddressSanitizer (tests/Makefile): the core has no heap, and this harness's own file buffers are not worth
 * freeing before exit; leak detection would only report those. Harmless without ASan. */
const char *__asan_default_options(void) { return "detect_leaks=0"; }

int main(int argc, char **argv) {
    uint64_t cap_ms = 180000; int stop = 2;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--cap-ms")) cap_ms = strtoull(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--stop-after-unkeys")) stop = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--host-drive")) sim_host_drive = 1;
        else if (!strcmp(argv[i], "--charging")) sim_charging = 1;
        else sim_dir = argv[i];
    }
    fox_init();
    while (sim_now_us < cap_ms * 1000 && sim_unkeys < stop) {
        sim_player_tick();
        fox_poll();
        sim_now_us += 10000;      /* 10 ms steps */
    }
    sim_dump();
    return 0;
}
