/* SPDX-License-Identifier: GPL-3.0-or-later
 * netfox.c -- see netfox.h. Milestone 1: the wifi-ap kind (wifi-beacon, and the checkpoint's radio side without its
 * portal). wifi-probe and ble are loaded and reported (radio=unsupported) and stay silent until their turn. */
#include "netfox.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "console.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "fs.h"
#include "led.h"
#include "sdkconfig.h"
#include "filexfer.h"

extern const char builtin_defaults_json_start[] asm("_binary_builtin_defaults_json_start");
extern const char builtin_defaults_json_end[] asm("_binary_builtin_defaults_json_end");

static json_doc DOC_D, DOC_U;
static char FILE_D[XFER_MAX_FILE + 1], FILE_U[XFER_MAX_FILE + 1];
static net_cfg_t DEF, CFG;
static cfg_report_t REP;
static char uid[17];
static bool have_cfg, id_ok, wifi_inited, up;
static const char *radio_status = "skipped";
static char template_version[16] = "?";
static uint32_t reload_at, phase_until, bench_until, resume_at;
static int cycle_n;
static float bench_len_s;
static enum { HOLD, WAKE, SLEEP, BENCH } state = HOLD;
static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

static void template_version_lookup(const char *id) {
    /* TEMPLATE_VERSIONS: "ble-beacon=1.0.1;wifi-beacon=1.0.1;..." from the catalog at build time */
    const char *p = TEMPLATE_VERSIONS; size_t n = strlen(id);
    while (p && *p) { if (!strncmp(p, id, n) && p[n] == '=') { const char *v = p + n + 1; const char *e = strchr(v, ';'); size_t l = e ? (size_t)(e - v) : strlen(v); if (l >= sizeof template_version) l = sizeof template_version - 1; memcpy(template_version, v, l); template_version[l] = 0; return; } p = strchr(p, ';'); if (p) p++; }
    strcpy(template_version, "?");
}

/* ---- the radio (wifi-ap) */
static bool wifi_init_once(void) {
    if (wifi_inited) return true;
    esp_netif_init(); esp_event_loop_create_default(); esp_netif_create_default_wifi_ap(); esp_netif_create_default_wifi_sta();
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_wifi_init(&ic) != ESP_OK) return false;
    esp_wifi_set_storage(WIFI_STORAGE_RAM);
    esp_wifi_set_mode(WIFI_MODE_APSTA);     /* AP for the fox, STA idle so `scan` works at any time */
    wifi_inited = true; return true;
}
static void radio_up(void) {
    if (up) return;
    if (CFG.net.kind != NET_WIFI_AP) return;
    if (!wifi_init_once()) { radio_status = "failed"; return; }
    wifi_config_t wc = { 0 };
    const char *name = net_cfg_name_on_air(&CFG);
    strncpy((char *)wc.ap.ssid, name, sizeof wc.ap.ssid - 1); wc.ap.ssid_len = strlen((char *)wc.ap.ssid);
    if (CFG.net.psk[0]) { strncpy((char *)wc.ap.password, CFG.net.psk, sizeof wc.ap.password - 1); wc.ap.authmode = WIFI_AUTH_WPA2_PSK; } else wc.ap.authmode = WIFI_AUTH_OPEN;
    wc.ap.channel = (uint8_t)CFG.net.channel; wc.ap.max_connection = (uint8_t)CFG.net.max_clients; wc.ap.ssid_hidden = CFG.net.hidden ? 1 : 0;
    uint8_t mac[6];
    if (net_parse_mac(CFG.net.mac, mac)) { esp_wifi_stop(); if (esp_wifi_set_mac(WIFI_IF_AP, mac) != ESP_OK) con_printf("  note: the chip refused MAC %s, on the air with its own\r\n", CFG.net.mac); }
    if (esp_wifi_set_config(WIFI_IF_AP, &wc) != ESP_OK || esp_wifi_start() != ESP_OK) { radio_status = "failed"; return; }
    int8_t q = (int8_t)(CFG.net.tx_power_dbm * 4); if (q < 8) q = 8; if (q > 84) q = 84;
    esp_wifi_set_max_tx_power(q);
    up = true; radio_status = "ok"; led_set(CFG.led.enabled);
    char m[18]; esp_wifi_get_mac(WIFI_IF_AP, mac); snprintf(m, sizeof m, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    con_printf("wifi-ap up: %s (%s) for %d s\r\n", name, m, (int)((phase_until - now_ms()) / 1000));
}
static void radio_down(void) { if (!up) return; esp_wifi_stop(); up = false; led_set(false); }
static void mac_on_air(char *out, int n) { uint8_t mac[6] = { 0 }; if (wifi_inited) esp_wifi_get_mac(WIFI_IF_AP, mac); snprintf(out, (size_t)n, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]); }

/* ---- configuration */
static bool load(void) {
    have_cfg = false; cfg_report_init(&REP); radio_status = "skipped";
    long n = fs_read("defaults.json", FILE_D, sizeof FILE_D);
    const char *dtext = FILE_D; size_t dlen = n > 0 ? (size_t)n : 0;
    if (n <= 0) { dtext = builtin_defaults_json_start; dlen = (size_t)(builtin_defaults_json_end - builtin_defaults_json_start); }
    int droot = json_parse(&DOC_D, dtext, dlen);
    if (droot < 0 || !net_cfg_load_defaults(&DEF, &DOC_D, droot)) { strcpy(REP.fatal, "defaults"); return false; }
    long un = fs_read("fox.json", FILE_U, sizeof FILE_U);
    int uroot = un > 0 ? json_parse(&DOC_U, FILE_U, (size_t)un) : -1;
    if (un > 0 && uroot < 0) cfg_report_mode(&REP, "default(json)");
    unsigned radios = RADIO_WIFI24 | RADIO_BLE;
#if CONFIG_IDF_TARGET_ESP32C5
    radios |= RADIO_WIFI5;
#endif
    net_cfg_apply_user(&CFG, &DEF, &DOC_U, uroot, BOARD_ID, radios, NULL, &REP);
    if (un > 0 && uroot < 0) cfg_report_mode(&REP, "default(json)");
    template_version_lookup(CFG.template_id);
    id_ok = net_cfg_id_ok(&CFG);
    have_cfg = true;
    return true;
}

const char *netfox_banner_line(char *buf, int n) {
    char st[256], m[18]; mac_on_air(m, sizeof m);
    const char *kind = have_cfg ? net_kind_name(CFG.net.kind) : "?";
    snprintf(buf, (size_t)n, "FOX template=%s/%s foxlib=c-%s board=%s uid=%s cfg=%s radio=%s id=%s freq=none net=%s name=\"%s\" mac=%s clock=unset mem=%u",
             have_cfg ? CFG.template_id : "?", template_version, FOXLIBC_VERSION, BOARD_ID, uid, cfg_report_status(&REP, st, sizeof st), radio_status,
             id_ok ? "set" : "unset", kind, have_cfg ? net_cfg_name_on_air(&CFG) : "", have_cfg && net_parse_mac(CFG.net.mac, (uint8_t[6]){0}) ? CFG.net.mac : m, (unsigned)esp_get_free_heap_size());
    return buf;
}
void netfox_print_banner(void) {
    char line[512];
    con_puts("initializing system ... \r\n");
    con_puts(netfox_banner_line(line, sizeof line)); con_puts("\r\n");
    for (int i = 0; i < REP.n_items; i++) con_printf("  cfg: %s -> default (%s)\r\n", REP.items[i].key, REP.items[i].reason);
    if (REP.fatal[0]) con_printf("** fatal: %s -- staying silent **\r\n", REP.fatal);
    else if (!id_ok) con_puts("** callsign not set: staying silent **\r\n");
    if (have_cfg && CFG.net.kind != NET_WIFI_AP) con_printf("  note: %s is not in this firmware yet: the fox stays silent\r\n", net_kind_name(CFG.net.kind));
}

static void start_cycle(void) {
    cycle_n = 0; state = HOLD;
    if (!have_cfg || REP.fatal[0] || !id_ok || CFG.net.kind != NET_WIFI_AP) { radio_status = CFG.net.kind != NET_WIFI_AP && have_cfg ? "unsupported" : "skipped"; return; }
    state = WAKE; phase_until = now_ms() + (uint32_t)CFG.schedule.wake_s * 1000;
    con_printf("cycle %d\r\n", cycle_n); radio_up();
}

void netfox_init(void) {
    uint8_t mac[6]; esp_read_mac(mac, ESP_MAC_WIFI_STA); snprintf(uid, sizeof uid, "%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    led_init(NULL);
    load();
    if (have_cfg && !CFG.pins.led_null) led_init(CFG.pins.led);
    netfox_print_banner();
    start_cycle();
}
void netfox_reload(const char *why) {
    radio_down(); con_printf("reload: %s\r\n", why);
    load(); netfox_print_banner(); start_cycle();
}
void netfox_schedule_reload(uint32_t in_ms) { reload_at = now_ms() + in_ms; }

void netfox_poll(void) {
    uint32_t t = now_ms();
    if (reload_at && (int32_t)(t - reload_at) >= 0) { reload_at = 0; netfox_reload("console"); return; }
    switch (state) {
    case WAKE:
        if ((int32_t)(t - phase_until) >= 0) {
            radio_down();
            if (CFG.schedule.sleep_s == 0) { cycle_n++; phase_until = t + (uint32_t)CFG.schedule.wake_s * 1000; con_printf("cycle %d\r\n", cycle_n); radio_up(); break; }
            if (CFG.schedule.deep) { con_printf("sleep: deep for %d s\r\n", CFG.schedule.sleep_s); con_flush(); esp_deep_sleep((uint64_t)CFG.schedule.sleep_s * 1000000ULL); }
            state = SLEEP; phase_until = t + (uint32_t)CFG.schedule.sleep_s * 1000;
        }
        break;
    case SLEEP:
        if ((int32_t)(t - phase_until) >= 0) { cycle_n++; state = WAKE; phase_until = t + (uint32_t)CFG.schedule.wake_s * 1000; con_printf("cycle %d\r\n", cycle_n); radio_up(); }
        break;
    case BENCH:
        if ((int32_t)(t - bench_until) >= 0) {
            radio_down();
            char m[18]; mac_on_air(m, sizeof m);
            con_printf("ok %s %s (%s) for %.1f s\r\nok\r\n", net_kind_name(CFG.net.kind), net_cfg_name_on_air(&CFG), m, (double)bench_len_s);
            state = HOLD; resume_at = t + 1000;
        }
        break;
    case HOLD:
        if (resume_at && (int32_t)(t - resume_at) >= 0) { resume_at = 0; start_cycle(); }
        break;
    }
}

/* ---- bench */
bool netfox_bench_key(uint32_t ms) {
    if (!have_cfg || REP.fatal[0]) return false;
    if (CFG.net.kind != NET_WIFI_AP) { con_puts("err: this kind is not in this firmware yet\r\n"); return true; }
    radio_down(); state = BENCH; bench_len_s = ms / 1000.0f; bench_until = now_ms() + ms; phase_until = bench_until;
    radio_up();
    if (!up) { state = HOLD; resume_at = now_ms() + 1000; con_puts("err: radio did not start\r\n"); return true; }
    return true;
}
bool netfox_bench_scan(void) {
    if (!wifi_init_once()) return false;
    if (!up) esp_wifi_start();
    wifi_scan_config_t sc = { 0 };
    if (esp_wifi_scan_start(&sc, true) != ESP_OK) { if (!up) esp_wifi_stop(); return false; }
    uint16_t n = 12; wifi_ap_record_t recs[12];
    esp_wifi_scan_get_ap_records(&n, recs);
    for (int i = 0; i < n; i++) con_printf("%d ch%d %s\r\n", recs[i].rssi, recs[i].primary, recs[i].ssid[0] ? (const char *)recs[i].ssid : "(hidden)");
    if (n == 0) con_puts("nothing heard\r\n");
    if (!up) esp_wifi_stop();
    return true;
}
void netfox_bench_stop(void) { if (state == BENCH) { radio_down(); con_puts("ok (stopped)\r\n"); } else radio_down(); state = HOLD; resume_at = now_ms() + 1000; }
void netfox_health_json(char *buf, int n) {
    snprintf(buf, (size_t)n, "{\"free\": %u, \"after_import\": %u, \"import_s\": 0, \"with_fox\": %u, \"foxlib\": \"c-%s\", \"fatal\": %s%s%s}",
             (unsigned)esp_get_minimum_free_heap_size(), (unsigned)esp_get_minimum_free_heap_size(), (unsigned)esp_get_free_heap_size(), FOXLIBC_VERSION,
             REP.fatal[0] ? "\"" : "null", REP.fatal[0] ? REP.fatal : "", REP.fatal[0] ? "\"" : "");
}
const net_cfg_t *netfox_cfg(void) { return &CFG; }
const cfg_report_t *netfox_report(void) { return &REP; }
const char *netfox_uid(void) { return uid; }
const char *netfox_radio_status(void) { return radio_status; }
bool netfox_on_air(void) { return up; }
