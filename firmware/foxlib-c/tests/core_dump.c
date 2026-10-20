/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/tests/core_dump.c -- host harness: prints what the core produces so
 * parity.py can compare it with foxlib (Python). Modes:
 *   morse <wpm> <tone> <dit_ms|0> <text...>   -> "hz ms" per line
 *   song <json-file> <articulation>           -> events of the first song
 *   sched <json-file> <steps>                 -> wait_ms sequence (+ phase for resurrection)
 *   cfg <defaults.json> <fox.json> <board>    -> status line + key fields
 *   synth <sr> <shape> <pre> <level> <wpm> <tone> <text> -> peak/rms/samples of the rendered ID
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../core/cfg.h"
#include "../core/melody.h"
#include "../core/morse.h"
#include "../core/schedule.h"
#include "../core/synth.h"

static json_doc DOC, DOC2;
static events_t EV;
static fox_cfg_t DEF, CFG;

static char *slurp(const char *path, size_t *n) {
    FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(2); }
    fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET);
    char *b = malloc((size_t)len + 1); *n = fread(b, 1, (size_t)len, f); b[*n] = 0; fclose(f); return b;
}

static void dump_events(void) { for (int i = 0; i < EV.n; i++) printf("%.6g %.6g\n", EV.e[i].hz, EV.e[i].ms); }

int main(int argc, char **argv) {
    if (argc < 2) return 1;
    if (!strcmp(argv[1], "morse")) {
        char text[512] = ""; for (int i = 5; i < argc; i++) { if (i > 5) strcat(text, " "); strcat(text, argv[i]); }
        events_clear(&EV); morse_events(&EV, text, atoi(argv[2]), (float)atof(argv[3]), (float)atof(argv[4])); dump_events(); return 0;
    }
    if (!strcmp(argv[1], "song")) {
        size_t n; char *t = slurp(argv[2], &n); int root = json_parse(&DOC, t, n);
        if (root < 0) { fprintf(stderr, "json: %s at %d\n", DOC.err, DOC.err_pos); return 2; }
        if (!cfg_load_defaults(&DEF, &DOC, root)) { fprintf(stderr, "defaults unusable\n"); return 2; }
        if (DEF.payload.kind != PAYLOAD_SONGS) { fprintf(stderr, "no songs\n"); return 2; }
        events_clear(&EV); melody_events(&EV, &DEF.payload.songs[0], (float)atof(argv[3])); dump_events(); return 0;
    }
    if (!strcmp(argv[1], "sched")) {
        size_t n; char *t = slurp(argv[2], &n); int root = json_parse(&DOC, t, n);
        if (root < 0 || !cfg_load_defaults(&DEF, &DOC, root)) { fprintf(stderr, "bad cfg\n"); return 2; }
        sched_t s; sched_init(&s, &DEF.schedule); int64_t now = 0; int steps = atoi(argv[3]);
        for (int i = 0; i < steps; i++) {
            sched_phase_t ph = sched_phase(&s, now);
            const char *wake = "";
            if (ph == PHASE_DEAD) wake = sched_dead_wake(&s) == WAKE_ID ? " id" : " dit";
            int32_t w = sched_wait_ms(&s, now);
            printf("%s%s %d\n", ph == PHASE_DEAD ? "dead" : "alive", wake, w);
            now += w + 5000;     /* pretend every transmission lasted 5 s */
        }
        return 0;
    }
    if (!strcmp(argv[1], "cfg")) {
        size_t n; char *t = slurp(argv[2], &n); int root = json_parse(&DOC, t, n);
        if (root < 0 || !cfg_load_defaults(&DEF, &DOC, root)) { fprintf(stderr, "bad defaults\n"); return 2; }
        cfg_report_t rep; cfg_report_init(&rep);
        size_t n2; char *t2 = slurp(argv[3], &n2); int root2 = json_parse(&DOC2, t2, n2);
        if (root2 < 0) { CFG = DEF; strcpy(rep.mode, "default(parse)"); } else cfg_apply_user(&CFG, &DEF, &DOC2, root2, argv[4], &rep);
        char st[256]; printf("status=%s\n", cfg_report_status(&rep, st, sizeof st));
        for (int i = 0; i < rep.n_items; i++) printf("  cfg: %s -> default (%s)\n", rep.items[i].key, rep.items[i].reason);
        printf("template=%s callmessage=%s wpm=%d tone=%d id_ok=%d\n", CFG.template_id, CFG.id.callmessage, CFG.id.wpm, CFG.id.tone_hz, cfg_id_ok(&CFG));
        printf("freqs="); for (int i = 0; i < CFG.plan.n; i++) printf("%s%g", i ? "," : "", CFG.plan.frequencies_mhz[i]); printf(" qsy=%d\n", CFG.plan.announce_qsy);
        printf("payload=%d songs=%d dit_s=%g schedule=%s delay=%d seed=%u\n", CFG.payload.kind, CFG.payload.n_songs, CFG.payload.dit_set ? CFG.payload.dit_s : 0, sched_kind_name(CFG.schedule.kind), CFG.schedule.delay_ms, CFG.schedule.seed);
        printf("radio: dev=%d/%d shape=%d pre=%d sr=%d att=%d\n", CFG.radio.id_deviation_hz, CFG.radio.audio_deviation_hz, CFG.radio.tone_shape, CFG.radio.preemphasis, CFG.radio.sample_rate, CFG.radio.attenuation);
        return 0;
    }
    if (!strcmp(argv[1], "synth")) {
        synth_params_t p; synth_params_default(&p);
        p.sample_rate = atoi(argv[2]); p.shape = !strcmp(argv[3], "bright") ? SHAPE_BRIGHT : SHAPE_SINE; p.preemphasis = atoi(argv[4]) != 0; p.level = (float)atof(argv[5]);
        char text[512] = ""; for (int i = 8; i < argc; i++) { if (i > 8) strcat(text, " "); strcat(text, argv[i]); }
        events_clear(&EV); morse_events(&EV, text, atoi(argv[6]), (float)atof(argv[7]), 0);
        static int16_t pcm[1 << 20];
        uint32_t n = synth_render(&EV, &p, pcm, sizeof pcm / sizeof pcm[0]);
        double sq = 0; int peak = 0; for (uint32_t i = 0; i < n; i++) { int a = abs(pcm[i]); if (a > peak) peak = a; sq += (double)pcm[i] * pcm[i]; }
        printf("samples=%u expected=%u peak=%.4f rms=%.4f\n", n, (unsigned)lrint(events_ms(&EV) * p.sample_rate / 1000.0), peak / 32767.0, sqrt(sq / (n ? n : 1)) / 32767.0);
        if (argc > 1 && getenv("PCM_OUT")) { FILE *f = fopen(getenv("PCM_OUT"), "wb"); fwrite(pcm, 2, n, f); fclose(f); }
        return 0;
    }
    return 1;
}
