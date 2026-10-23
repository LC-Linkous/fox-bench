/* SPDX-License-Identifier: GPL-3.0-or-later
 * host_sim: boot fox.c against the stubs on a virtual clock and dump what the "hardware" saw.
 *   host_sim DIR [--cap-ms N] [--stop-after-unkeys N] [--host-drive] */
#include <stdlib.h>
#include <string.h>
#include "fox.h"

extern uint64_t sim_now_us; extern const char *sim_dir; extern int sim_host_drive, sim_unkeys, sim_charging, sim_si5351_absent_until_reprobe, sim_reprobes;
void sim_player_tick(void); void sim_dump(void);

/* Under AddressSanitizer (tests/Makefile): the core has no heap, and this harness's own file buffers are not worth
 * freeing before exit; leak detection would only report those. Harmless without ASan. */
const char *__asan_default_options(void) { return "detect_leaks=0"; }

int main(int argc, char **argv) {
    uint64_t cap_ms = 180000, reload_at = 0; int stop = 2;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--cap-ms")) cap_ms = strtoull(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--stop-after-unkeys")) stop = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--host-drive")) sim_host_drive = 1;
        else if (!strcmp(argv[i], "--charging")) sim_charging = 1;
        else if (!strcmp(argv[i], "--si5351-late")) sim_si5351_absent_until_reprobe = atoi(argv[++i]);   /* absent at boot; answers after N re-probes (F14) */
        else if (!strcmp(argv[i], "--reload-at-ms")) reload_at = strtoull(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--start-ms")) sim_now_us = strtoull(argv[++i], NULL, 10) * 1000;   /* boot the clock late: the 32-bit ms wrap at 49.7 days */
        else sim_dir = argv[i];
    }
    fox_init();
    uint64_t end_us = sim_now_us + cap_ms * 1000;
    while (sim_now_us < end_us && sim_unkeys < stop) {
        sim_player_tick();
        if (reload_at && sim_now_us >= reload_at * 1000) { reload_at = 0; fox_reload("console"); }
        fox_poll();
        sim_now_us += 10000;      /* 10 ms steps */
    }
    sim_dump();
    return 0;
}
