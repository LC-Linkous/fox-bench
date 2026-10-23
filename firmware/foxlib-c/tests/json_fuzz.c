/* SPDX-License-Identifier: GPL-3.0-or-later
 * json_fuzz: mutate real fox.json files and feed them to the parser and the validator, under ASan/UBSan (tests/Makefile).
 * The parser reads a volume anyone can write; this is the cheapest way to find an over-read or an undefined cast.
 *   json_fuzz <defaults.json> <seed> <iterations> [more seed files...]
 * Deterministic (xorshift from <seed>): a failure reproduces with the same arguments. Prints the mutation that broke
 * when the sanitizer does not abort first (it will). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../core/json.h"
#include "../core/cfg.h"

static json_doc DOC, DEFDOC; static fox_cfg_t DEF, CFG; static cfg_report_t REP;
static uint64_t rng;
static uint32_t rnd(void) { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; return (uint32_t)rng; }
static char *slurp(const char *path, size_t *n) { FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(2); } fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET); char *b = malloc((size_t)len + 1); *n = fread(b, 1, (size_t)len, f); b[*n] = 0; fclose(f); return b; }
const char *__asan_default_options(void) { return "detect_leaks=0"; }

static const char *interesting[] = { "\"", "\\", "\\u", "\\uD800", "\\uDC00\\uD800", "\\uD83D\\uDE00", "1e30", "-1e30", "1e-400", "0x10", "[", "{", "]", "}", ",", ":", "true", "nul", "\"\\u0000\"", "99999999999999999999", "-", ".", "\"images_file\":\"../x\"", "\"callmessage\":\"", "\r\n", "\t", "\x7f", "\xff\xfe", "\xc3\x28", "\xe2\x82", "\"", "{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":{\"a\":1}}}}}}}}}}}}}}}}}" };

int main(int argc, char **argv) {
    if (argc < 4) { fprintf(stderr, "json_fuzz <defaults.json> <seed> <iterations> [seeds...]\n"); return 2; }
    size_t dn; char *dt = slurp(argv[1], &dn);
    int droot = json_parse(&DEFDOC, dt, dn); if (droot < 0 || !cfg_load_defaults(&DEF, &DEFDOC, droot)) { fprintf(stderr, "defaults do not load\n"); return 2; }
    rng = strtoull(argv[2], NULL, 10) * 2654435761ull + 1; long iters = atol(argv[3]);
    int nseeds = argc - 3 > 1 ? argc - 4 + 1 : 1; char **seeds = malloc(sizeof(char *) * (size_t)nseeds); size_t *lens = malloc(sizeof(size_t) * (size_t)nseeds);
    seeds[0] = dt; lens[0] = dn; for (int i = 1; i < nseeds; i++) seeds[i] = slurp(argv[3 + i], &lens[i]);
    size_t cap = 65536; char *buf = malloc(cap);
    long parsed = 0, applied = 0;
    for (long it = 0; it < iters; it++) {
        int si = (int)(rnd() % (uint32_t)nseeds); size_t n = lens[si]; if (n > cap - 4096) n = cap - 4096;
        memcpy(buf, seeds[si], n);
        int muts = 1 + (int)(rnd() % 4);
        for (int m = 0; m < muts; m++) {
            uint32_t kind = rnd() % 8, at = n ? rnd() % (uint32_t)n : 0;
            switch (kind) {
                case 0: if (n) buf[at] = (char)rnd(); break;                                   /* random byte */
                case 1: if (n) buf[at] ^= (char)(1u << (rnd() % 8)); break;                   /* bit flip */
                case 2: n = at; break;                                                        /* truncate */
                case 3: { const char *s = interesting[rnd() % (sizeof interesting / sizeof *interesting)]; size_t sl = strlen(s); if (n + sl < cap) { memmove(buf + at + sl, buf + at, n - at); memcpy(buf + at, s, sl); n += sl; } break; }
                case 4: { uint32_t len = rnd() % 64; if (at + len < n) { memmove(buf + at, buf + at + len, n - at - len); n -= len; } break; }   /* delete a run */
                case 5: { uint32_t len = rnd() % 256; if (at + len < n && n + len < cap) { memmove(buf + at + len, buf + at, n - at); memcpy(buf + at, buf + at + len, len); n += len; } break; }   /* duplicate a run */
                case 6: { size_t sl = rnd() % 2000; if (n + sl < cap) { memset(buf + n, '[', sl); n += sl; } break; }   /* deep nesting */
                case 7: if (n) buf[at] = "\"\\{}[],:0"[rnd() % 9]; break;                      /* structural char */
            }
        }
        int root = json_parse(&DOC, buf, n);
        if (root >= 0) {
            parsed++;
            cfg_report_init(&REP); cfg_apply_user(&CFG, &DEF, &DOC, root, "picofox-foxlibc", &REP); applied++;
            /* the config the fox would run must be internally consistent, whatever the file said */
            if (CFG.plan.n < 0 || CFG.plan.n > 16 || CFG.radio.n_ranges < 0 || CFG.radio.n_ranges > 4 || CFG.payload.n_songs < 0 || CFG.payload.n_songs > 16) { fprintf(stderr, "iteration %ld: validator left an out-of-range count\n", it); return 1; }
            if (strlen(CFG.id.callmessage) >= sizeof CFG.id.callmessage) { fprintf(stderr, "iteration %ld: callmessage unterminated\n", it); return 1; }
        }
    }
    printf("json_fuzz: %ld iterations, %ld parsed, %ld applied, no sanitizer report\n", iters, parsed, applied);
    return 0;
}
