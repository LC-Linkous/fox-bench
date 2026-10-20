/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/json.h -- a small JSON reader for configuration files.
 *
 * Parses into a fixed arena of nodes (no malloc). Values keep their text
 * position; strings are unescaped into a side buffer. Good for files up to
 * JSON_MAX_NODES values, which covers fox.json with a long playlist.
 */
#ifndef FOXLIBC_JSON_H
#define FOXLIBC_JSON_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef JSON_MAX_NODES
#define JSON_MAX_NODES 4096
#endif
#ifndef JSON_STR_BYTES
#define JSON_STR_BYTES 8192
#endif

typedef enum { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ } json_type;

typedef struct {
    uint8_t type;
    uint8_t is_int;        /* number had no fraction/exponent, or an integral value ("3.0" is int, like foxlib's intify) */
    int16_t parent;
    int16_t next;          /* next sibling, -1 at end */
    int16_t first;         /* first child (arrays/objects), -1 if empty */
    int16_t key;           /* for object members: index of the key string in the string buffer; -1 otherwise */
    int16_t count;         /* children count */
    union { double num; int32_t str; bool b; } v;   /* str: offset into the string buffer */
} json_node;

typedef struct {
    json_node nodes[JSON_MAX_NODES];
    char strs[JSON_STR_BYTES];
    int n_nodes, n_strs;
    const char *err;       /* NULL on success */
    int err_pos;
} json_doc;

/* Parse text (not required to be NUL-terminated past `len`). Returns the root index or -1. */
int json_parse(json_doc *d, const char *text, size_t len);

/* Accessors. All tolerate idx < 0 (return "missing"). */
static inline const json_node *json_at(const json_doc *d, int idx) { return idx < 0 ? NULL : &d->nodes[idx]; }
int json_get(const json_doc *d, int obj, const char *key);      /* member of an object, or -1 */
int json_index(const json_doc *d, int arr, int i);              /* element of an array, or -1 */
int json_len(const json_doc *d, int idx);                       /* children count, 0 if not a container */
const char *json_key(const json_doc *d, int member);            /* key text of an object member */
const char *json_str(const json_doc *d, int idx);               /* string value or NULL */
bool json_is(const json_doc *d, int idx, json_type t);
bool json_is_int(const json_doc *d, int idx);                   /* J_NUM with an integral value */
bool json_is_num(const json_doc *d, int idx);
double json_num(const json_doc *d, int idx, double dflt);
int json_int(const json_doc *d, int idx, int dflt);
bool json_bool(const json_doc *d, int idx, bool dflt);
bool json_is_null(const json_doc *d, int idx);

#endif
