/* SPDX-License-Identifier: GPL-3.0-or-later
 * foxlib-c/core/json.c -- recursive-descent JSON into a node arena. */
#include "json.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

typedef struct { json_doc *d; const char *s; size_t n, i; int depth; } P;

static int fail(P *p, const char *why) { if (!p->d->err) { p->d->err = why; p->d->err_pos = (int)p->i; } return -1; }

static void ws(P *p) { while (p->i < p->n && (p->s[p->i] == ' ' || p->s[p->i] == '\t' || p->s[p->i] == '\n' || p->s[p->i] == '\r')) p->i++; }

static int alloc(P *p, int type, int parent) {
    if (p->d->n_nodes >= JSON_MAX_NODES) return fail(p, "too many values");
    int i = p->d->n_nodes++;
    json_node *nd = &p->d->nodes[i];
    nd->type = (uint8_t)type; nd->is_int = 0; nd->parent = (int16_t)parent; nd->next = -1; nd->first = -1; nd->key = -1; nd->count = 0; nd->v.num = 0;
    return i;
}

static int putc_(P *p, char c) { if (p->d->n_strs >= JSON_STR_BYTES) return fail(p, "strings too long"); p->d->strs[p->d->n_strs++] = c; return 0; }

static int put_utf8(P *p, unsigned cp) {
    if (cp < 0x80) return putc_(p, (char)cp);
    if (cp < 0x800) { if (putc_(p, (char)(0xC0 | (cp >> 6)))) return -1; return putc_(p, (char)(0x80 | (cp & 0x3F))); }
    if (cp < 0x10000) {
        if (putc_(p, (char)(0xE0 | (cp >> 12)))) return -1;
        if (putc_(p, (char)(0x80 | ((cp >> 6) & 0x3F)))) return -1;
        return putc_(p, (char)(0x80 | (cp & 0x3F)));
    }
    if (putc_(p, (char)(0xF0 | (cp >> 18)))) return -1;
    if (putc_(p, (char)(0x80 | ((cp >> 12) & 0x3F)))) return -1;
    if (putc_(p, (char)(0x80 | ((cp >> 6) & 0x3F)))) return -1;
    return putc_(p, (char)(0x80 | (cp & 0x3F)));
}

static int hex4(P *p, unsigned *out) {
    if (p->i + 4 > p->n) return fail(p, "bad \\u");
    unsigned v = 0;
    for (int k = 0; k < 4; k++) {
        char c = p->s[p->i++]; v <<= 4;
        if (c >= '0' && c <= '9') v |= (unsigned)(c - '0'); else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10); else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10); else return fail(p, "bad \\u");
    }
    *out = v; return 0;
}

/* Parses a string at p->i (on the opening quote); returns the string-buffer offset or -1. */
static int string(P *p) {
    if (p->s[p->i] != '"') return fail(p, "expected string");
    p->i++;
    int start = p->d->n_strs;
    while (p->i < p->n) {
        char c = p->s[p->i++];
        if (c == '"') { if (putc_(p, 0)) return -1; return start; }
        if ((unsigned char)c < 0x20) return fail(p, "control char in string");
        if (c != '\\') { if (putc_(p, c)) return -1; continue; }
        if (p->i >= p->n) break;
        c = p->s[p->i++];
        switch (c) {
            case '"': case '\\': case '/': if (putc_(p, c)) return -1; break;
            case 'b': if (putc_(p, '\b')) return -1; break;
            case 'f': if (putc_(p, '\f')) return -1; break;
            case 'n': if (putc_(p, '\n')) return -1; break;
            case 'r': if (putc_(p, '\r')) return -1; break;
            case 't': if (putc_(p, '\t')) return -1; break;
            case 'u': {
                unsigned cp; if (hex4(p, &cp)) return -1;
                if (cp >= 0xD800 && cp < 0xDC00 && p->i + 6 <= p->n && p->s[p->i] == '\\' && p->s[p->i + 1] == 'u') {
                    p->i += 2;
                    unsigned lo;
                    if (hex4(p, &lo)) return -1;
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                }
                if (put_utf8(p, cp)) return -1;
                break;
            }
            default: return fail(p, "bad escape");
        }
    }
    return fail(p, "unterminated string");
}

static int value(P *p, int parent);

static int number(P *p, int parent) {
    size_t st = p->i; bool frac = false;
    if (p->s[p->i] == '-') p->i++;
    if (p->i >= p->n || p->s[p->i] < '0' || p->s[p->i] > '9') return fail(p, "bad number");
    while (p->i < p->n && p->s[p->i] >= '0' && p->s[p->i] <= '9') p->i++;
    if (p->i < p->n && p->s[p->i] == '.') { frac = true; p->i++; if (p->i >= p->n || p->s[p->i] < '0' || p->s[p->i] > '9') return fail(p, "bad number"); while (p->i < p->n && p->s[p->i] >= '0' && p->s[p->i] <= '9') p->i++; }
    if (p->i < p->n && (p->s[p->i] == 'e' || p->s[p->i] == 'E')) { frac = true; p->i++; if (p->i < p->n && (p->s[p->i] == '+' || p->s[p->i] == '-')) p->i++; if (p->i >= p->n || p->s[p->i] < '0' || p->s[p->i] > '9') return fail(p, "bad number"); while (p->i < p->n && p->s[p->i] >= '0' && p->s[p->i] <= '9') p->i++; }
    char buf[48]; size_t len = p->i - st; if (len >= sizeof buf) return fail(p, "number too long");
    memcpy(buf, p->s + st, len); buf[len] = 0;
    int idx = alloc(p, J_NUM, parent); if (idx < 0) return -1;
    double v = strtod(buf, NULL);
    p->d->nodes[idx].v.num = v;
    p->d->nodes[idx].is_int = (!frac || (isfinite(v) && v == floor(v) && fabs(v) < 2147483648.0)) ? 1 : 0;
    return idx;
}

static int container(P *p, int parent, bool obj) {
    if (++p->depth > 32) return fail(p, "nesting too deep");
    int idx = alloc(p, obj ? J_OBJ : J_ARR, parent); if (idx < 0) return -1;
    p->i++; ws(p);
    char close = obj ? '}' : ']';
    if (p->i < p->n && p->s[p->i] == close) { p->i++; p->depth--; return idx; }
    int last = -1;
    for (;;) {
        ws(p);
        int key = -1;
        if (obj) { key = string(p); if (key < 0) return -1; ws(p); if (p->i >= p->n || p->s[p->i] != ':') return fail(p, "expected ':'"); p->i++; ws(p); }
        int child = value(p, idx); if (child < 0) return -1;
        p->d->nodes[child].key = (int16_t)key;
        if (last < 0) p->d->nodes[idx].first = (int16_t)child; else p->d->nodes[last].next = (int16_t)child;
        last = child; p->d->nodes[idx].count++;
        ws(p);
        if (p->i >= p->n) return fail(p, "unterminated container");
        if (p->s[p->i] == ',') { p->i++; continue; }
        if (p->s[p->i] == close) { p->i++; p->depth--; return idx; }
        return fail(p, "expected ',' or close");
    }
}

static int value(P *p, int parent) {
    ws(p);
    if (p->i >= p->n) return fail(p, "unexpected end");
    char c = p->s[p->i];
    if (c == '{') return container(p, parent, true);
    if (c == '[') return container(p, parent, false);
    if (c == '"') { int s = string(p); if (s < 0) return -1; int idx = alloc(p, J_STR, parent); if (idx < 0) return -1; p->d->nodes[idx].v.str = s; return idx; }
    if (c == '-' || (c >= '0' && c <= '9')) return number(p, parent);
    if (p->n - p->i >= 4 && !memcmp(p->s + p->i, "true", 4)) { p->i += 4; int idx = alloc(p, J_BOOL, parent); if (idx >= 0) p->d->nodes[idx].v.b = true; return idx; }
    if (p->n - p->i >= 5 && !memcmp(p->s + p->i, "false", 5)) { p->i += 5; int idx = alloc(p, J_BOOL, parent); if (idx >= 0) p->d->nodes[idx].v.b = false; return idx; }
    if (p->n - p->i >= 4 && !memcmp(p->s + p->i, "null", 4)) { p->i += 4; return alloc(p, J_NULL, parent); }
    return fail(p, "unexpected character");
}

int json_parse(json_doc *d, const char *text, size_t len) {
    d->n_nodes = 0; d->n_strs = 0; d->err = NULL; d->err_pos = 0;
    P p = { d, text, len, 0, 0 };
    int root = value(&p, -1);
    if (root < 0) return -1;
    ws(&p);
    if (p.i != p.n) { fail(&p, "trailing characters"); return -1; }
    return root;
}

int json_get(const json_doc *d, int obj, const char *key) {
    if (obj < 0 || d->nodes[obj].type != J_OBJ) return -1;
    for (int c = d->nodes[obj].first; c >= 0; c = d->nodes[c].next)
        if (d->nodes[c].key >= 0 && !strcmp(d->strs + d->nodes[c].key, key)) return c;
    return -1;
}
int json_index(const json_doc *d, int arr, int i) {
    if (arr < 0 || (d->nodes[arr].type != J_ARR && d->nodes[arr].type != J_OBJ)) return -1;
    int c = d->nodes[arr].first;
    while (c >= 0 && i-- > 0) c = d->nodes[c].next;
    return c;
}
int json_len(const json_doc *d, int idx) { return (idx < 0 || (d->nodes[idx].type != J_ARR && d->nodes[idx].type != J_OBJ)) ? 0 : d->nodes[idx].count; }
const char *json_key(const json_doc *d, int m) { return (m < 0 || d->nodes[m].key < 0) ? NULL : d->strs + d->nodes[m].key; }
const char *json_str(const json_doc *d, int idx) { return (idx < 0 || d->nodes[idx].type != J_STR) ? NULL : d->strs + d->nodes[idx].v.str; }
bool json_is(const json_doc *d, int idx, json_type t) { return idx >= 0 && d->nodes[idx].type == t; }
bool json_is_int(const json_doc *d, int idx) { return idx >= 0 && d->nodes[idx].type == J_NUM && d->nodes[idx].is_int; }
bool json_is_num(const json_doc *d, int idx) { return idx >= 0 && d->nodes[idx].type == J_NUM; }
double json_num(const json_doc *d, int idx, double dflt) { return json_is_num(d, idx) ? d->nodes[idx].v.num : dflt; }
int json_int(const json_doc *d, int idx, int dflt) { return json_is_num(d, idx) ? (int)d->nodes[idx].v.num : dflt; }
bool json_bool(const json_doc *d, int idx, bool dflt) { return json_is(d, idx, J_BOOL) ? d->nodes[idx].v.b : dflt; }
bool json_is_null(const json_doc *d, int idx) { return json_is(d, idx, J_NULL); }
