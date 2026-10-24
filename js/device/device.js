// device.js — Device: what the page needs from a board, independent of how
// bytes get there. Implementations: ReplDevice (real board over a Link,
// files through the REPL) and DemoDevice (in-memory).
// SPDX-License-Identifier: GPL-2.0-only
//
//   connect()                 -> { boardId, uid, foxlibVersion, files: {name: size} }
//   readText(path) / readBytes(path)   null if missing
//   writeText(path, text) / writeBytes(path, bytes)   verified by size and CRC32
//   mkdir(path), remove(path), list(path)
//   reboot()                  -> boot log text (parse with parseBanner)
//   exec(code)                -> stdout        (bench commands)
//   close()

export const PROBE_FREQS = [146.5, 433.5];

/** Parse one FOX banner line into a map; null if none present. */
export function parseBanner(text) {
  const m = text.match(/^FOX (.*)$/m);
  if (!m) return null;
  const out = { _raw: m[0] };
  for (const kv of m[1].match(/\S+=(?:"[^"]*"|\([^)]*\)|\S)*/g) || []) {   // a value may be "quoted with spaces" (a network fox's name=)
    const i = kv.indexOf('='); let v = kv.slice(i + 1); if (v.length >= 2 && v[0] === '"' && v.endsWith('"')) v = v.slice(1, -1); out[kv.slice(0, i)] = v;
  }
  return out;
}

export class Device {
  constructor() { this.kind = 'none'; this.onLog = null; }
  log(text, cls) { if (this.onLog) this.onLog(text, cls); }
  async connect() { throw new Error('not implemented'); }
  async readText() { return null; }
  async readBytes() { return null; }
  async writeText() {}
  async writeBytes() {}
  async mkdir() {}
  async remove() {}
  async list() { return {}; }
  async reboot() { return ''; }
  /** Stop a running code.py and take the REPL (no-op for the demo). */
  async interrupt() {}
  async exec() { return ''; }
  async close() {}
}
