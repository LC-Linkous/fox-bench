/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/tests/netcfg_dump.c -- host harness for core/netcfg: prints the status word, the report items and the
 * effective configuration as JSON, so netcfg_parity.py can compare it with foxlib/netcfg.py on the same inputs.
 *   netcfg_dump <defaults.json> <fox.json|-> <board_id> <radios: e.g. wifi24,ble or ?> [pin names...]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../core/netcfg.h"

static json_doc DOC, DOC2;
static net_cfg_t DEF, CFG;
const char *__asan_default_options(void) { return "detect_leaks=0"; }

static char *slurp(const char *path, size_t *n) {
    FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(2); }
    fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET);
    char *b = malloc((size_t)len + 1); *n = fread(b, 1, (size_t)len, f); b[*n] = 0; fclose(f); return b;
}
static void jstr(const char *s) { putchar('"'); for (; *s; s++) { if (*s == '"' || *s == '\\') putchar('\\'); putchar(*s); } putchar('"'); }

int main(int argc, char **argv) {
    if (argc < 5) return 1;
    size_t n; char *t = slurp(argv[1], &n);
    int root = json_parse(&DOC, t, n);
    if (root < 0 || !net_cfg_load_defaults(&DEF, &DOC, root)) { printf("{\"status\":\"fatal(defaults)\"}\n"); return 0; }
    int uroot = -1;
    if (strcmp(argv[2], "-")) { size_t n2; char *t2 = slurp(argv[2], &n2); uroot = json_parse(&DOC2, t2, n2); }
    unsigned radios = 0;
    if (!strcmp(argv[4], "?")) radios = RADIO_UNKNOWN;
    else { if (strstr(argv[4], "wifi24")) radios |= RADIO_WIFI24; if (strstr(argv[4], "wifi5")) radios |= RADIO_WIFI5; if (strstr(argv[4], "ble")) radios |= RADIO_BLE; }
    const char *names[256]; int nn = 0;
    for (int i = 5; i < argc && nn < 255; i++) names[nn++] = argv[i];
    names[nn] = NULL;
    cfg_report_t rep;
    net_cfg_apply_user(&CFG, &DEF, &DOC2, uroot, argv[3], radios, nn ? names : NULL, &rep);
    char st[256]; cfg_report_status(&rep, st, sizeof st);
    printf("{\"status\":"); jstr(st);
    printf(",\"items\":[");
    for (int i = 0; i < rep.n_items; i++) { printf(i ? ",[" : "["); jstr(rep.items[i].key); putchar(','); jstr(rep.items[i].reason); putchar(']'); }
    printf("],\"cfg\":{\"template\":"); jstr(CFG.template_id); printf(",\"variant\":"); jstr(CFG.variant);
    printf(",\"pins\":{\"led\":"); if (CFG.pins.led_null) printf("null"); else jstr(CFG.pins.led);
    printf(",\"batt_sense\":"); if (CFG.pins.batt_null) printf("null"); else jstr(CFG.pins.batt_sense);
    printf("},\"net\":{\"kind\":"); jstr(net_kind_name(CFG.net.kind));
    printf(",\"mac\":"); jstr(CFG.net.mac); printf(",\"tx_power_dbm\":%g", CFG.net.tx_power_dbm);
    if (CFG.net.kind != NET_BLE) { printf(",\"ssid\":"); jstr(CFG.net.ssid); }
    if (CFG.net.kind == NET_WIFI_AP) {
        printf(",\"psk\":"); jstr(CFG.net.psk); printf(",\"channel\":%d,\"hidden\":%s,\"max_clients\":%d", CFG.net.channel, CFG.net.hidden ? "true" : "false", CFG.net.max_clients);
        if (net_cfg_has_key(&CFG, "channels")) { printf(",\"channels\":["); for (int i = 0; i < CFG.net.n_channels; i++) printf(i ? ",%d" : "%d", CFG.net.channels[i]); putchar(']'); }
    }
    if (CFG.net.kind == NET_WIFI_PROBE) {
        printf(",\"probe_ssids\":["); for (int i = 0; i < CFG.net.n_probe_ssids; i++) { if (i) putchar(','); jstr(CFG.net.probe_ssids[i]); } printf("],\"probe_ssid_s\":%d", CFG.net.probe_ssid_s);
    }
    if (CFG.net.kind == NET_BLE) {
        printf(",\"name\":"); jstr(CFG.net.name); printf(",\"uuid\":"); jstr(CFG.net.uuid);
        printf(",\"major\":%d,\"minor\":%d,\"signal_power_dbm\":%d,\"adv_min\":%d,\"adv_max\":%d", CFG.net.major, CFG.net.minor, CFG.net.signal_power_dbm, CFG.net.adv_min, CFG.net.adv_max);
    }
    printf("},\"id\":{\"callmessage\":"); jstr(CFG.id.callmessage); printf(",\"use_callsign_as_name\":%s}", CFG.id.use_callsign_as_name ? "true" : "false");
    printf(",\"schedule\":{\"kind\":\"duty\",\"wake_s\":%d,\"sleep_s\":%d,\"sleep\":\"%s\"}", CFG.schedule.wake_s, CFG.schedule.sleep_s, CFG.schedule.deep ? "deep" : "off");
    printf(",\"led\":{\"enabled\":%s}}}\n", CFG.led.enabled ? "true" : "false");
    return 0;
}
