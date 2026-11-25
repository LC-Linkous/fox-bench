/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/netcfg.h -- fox.json over defaults.json for a network fox: twin of foxlib/netcfg.py (the page has
 * js/model/netschema.js). Same keys, same reasons, same status words, so the three validators are compared on one
 * corpus (tests/netcfg_parity.py). Pure: no radio, no board; the host tests run it.
 *
 * What is here is what the ESP32 firmware runs: the net section for the three kinds, id, schedule, pins, led, fleet.
 * The contest features (payload, checkpoint, sense, stealth) are parsed as far as "the section is present" and
 * reported `<section>: not in this firmware` until the firmware grows them -- the cfg= word says partial, the fox
 * runs without them rather than staying silent. */
#ifndef FOXLIBC_NETCFG_H
#define FOXLIBC_NETCFG_H
#include <stdbool.h>
#include <stdint.h>
#include "json.h"
#include "report.h"

#define NET_MAX_NAME 32
#define NET_MAX_PSK 63
#define NET_MAX_PROBE_SSIDS 8
#define NET_MAX_CHANNELS 13
#define NET_MAX_KEYS 16
#define NET_PLACEHOLDER "N0CALL"

/* what the hardware has, as netcfg.py's `radios` list; RADIO_UNKNOWN = don't check (None) */
#define RADIO_WIFI24 1
#define RADIO_WIFI5 2
#define RADIO_BLE 4
#define RADIO_UNKNOWN 0x80

typedef enum { NET_WIFI_AP, NET_WIFI_PROBE, NET_BLE } net_kind_t;

typedef struct {
    char template_id[32];
    char board[32];
    char variant[48];
    struct { char led[24]; bool led_null; char batt_sense[24]; bool batt_null; } pins;    /* a role: a name, or null */
    struct {
        net_kind_t kind;
        char ssid[NET_MAX_NAME + 1];            /* wifi-ap / wifi-probe */
        char psk[NET_MAX_PSK + 1];              /* wifi-ap: "" = open */
        char name[NET_MAX_NAME + 1];            /* ble */
        char mac[18];                           /* "F2:B0:00:00:00:01", upper-case */
        int channel;                            /* wifi-ap */
        int channels[NET_MAX_CHANNELS]; int n_channels;   /* wifi-ap: [] = stay; wifi-probe: the hop list */
        bool hidden;
        double tx_power_dbm;
        int max_clients;
        char probe_ssids[NET_MAX_PROBE_SSIDS][NET_MAX_NAME + 1]; int n_probe_ssids; int probe_ssid_s;
        char uuid[37]; int major, minor; int signal_power_dbm; int adv_min, adv_max;      /* ble */
        char keys[NET_MAX_KEYS][20]; int n_keys;   /* the net keys the defaults carry (+ the ones the kind adds): anything else is unknown */
    } net;
    struct { char callmessage[65]; bool use_callsign_as_name; } id;
    struct { int wake_s, sleep_s; bool deep; } schedule;
    struct { bool enabled; } led;
    struct { char profile[64]; char event[64]; char notes[128]; char owner[64]; char points_to[64]; int number; bool number_set; } fleet;
    struct { bool payload, checkpoint, sense, stealth; } features_present;   /* in fox.json; reported, not run */
    struct { bool enabled, portal; } checkpoint;   /* from the defaults (the checkpoint template turns its portal on): deep sleep is refused with a portal */
} net_cfg_t;

/* Fill cfg from the defaults document (trusted). Returns false if it is not usable (no template, no net.kind). */
bool net_cfg_load_defaults(net_cfg_t *cfg, const json_doc *d, int root);
/* Apply fox.json on top: validation and fallbacks as netcfg.py. radios: RADIO_* bits or RADIO_UNKNOWN. board_names:
 * NULL-terminated list of pin names the board has (NULL = don't check). */
void net_cfg_apply_user(net_cfg_t *cfg, const net_cfg_t *defaults, const json_doc *d, int root, const char *board_id,
                        unsigned radios, const char *const *board_names, cfg_report_t *rep);
bool net_cfg_id_ok(const net_cfg_t *cfg);                 /* the placeholder is not in the callmessage */
const char *net_cfg_name_on_air(const net_cfg_t *cfg);    /* the callsign when use_callsign_as_name, else the SSID / name */
const char *net_kind_name(net_kind_t k);                  /* "wifi-ap" | "wifi-probe" | "ble" */
bool net_parse_mac(const char *s, uint8_t out[6]);        /* 6 hex bytes, unicast; '-' or ':' */
bool net_cfg_has_key(const net_cfg_t *cfg, const char *k);  /* a net key the config carries (the defaults', or one the kind adds) */

#endif
