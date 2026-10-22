// uf2.js — what the page checks about a UF2 before it copies it onto a bootloader drive.
// SPDX-License-Identifier: GPL-2.0-only
//
// UF2 (Microsoft's format, used by the RP2040 ROM bootloader): 512-byte blocks, each with magic numbers,
// flags, a target address, a block index/count and — when flag 0x2000 is set — a family id. The RP2040's
// bootloader ignores blocks for other families, so a UF2 for another chip "copies fine" and does nothing;
// checking the family here turns that into a message. A descriptor may also pin a file's sha256 and size.

export const RP2040_FAMILY = 0xe48bff56;
const MAGIC0 = 0x0A324655, MAGIC1 = 0x9E5D5157, MAGIC_END = 0x0AB16F30, FLAG_FAMILY = 0x2000;

/** { ok, error?, blocks, family (number|null), rp2040 (bool) } for a byte array. */
export function inspectUf2(bytes) {
  if (!bytes || bytes.length < 512 || bytes.length % 512) return { ok: false, error: `not a UF2 file (${bytes ? bytes.length : 0} bytes, not a multiple of 512)`, blocks: 0, family: null, rp2040: false };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks = bytes.length / 512;
  let family = null, families = new Set();
  for (let i = 0; i < blocks; i++) {
    const o = i * 512;
    if (dv.getUint32(o, true) !== MAGIC0 || dv.getUint32(o + 4, true) !== MAGIC1 || dv.getUint32(o + 508, true) !== MAGIC_END) return { ok: false, error: `not a UF2 file (block ${i} has no UF2 magic)`, blocks, family: null, rp2040: false };
    const flags = dv.getUint32(o + 8, true);
    if (flags & FLAG_FAMILY) { const f = dv.getUint32(o + 28, true); families.add(f); if (family == null) family = f; }
  }
  const rp2040 = family === RP2040_FAMILY;
  if (families.size > 1) return { ok: false, error: 'UF2 carries blocks for several chip families', blocks, family, rp2040 };
  return { ok: true, blocks, family, rp2040 };
}

export const familyName = f => f == null ? 'no family id' : f === RP2040_FAMILY ? 'RP2040' : `family 0x${f.toString(16)}`;

/** Lower-case hex SHA-256 of a byte array (Web Crypto; also Node 20+). */
export async function sha256hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check a fetched or loaded image against what is expected of it. expect: { sha256?, size?, rp2040?: true }.
 * Returns { ok, problems: [string], sha256 }.
 */
export async function checkImage(bytes, expect = {}) {
  const problems = [];
  const ins = inspectUf2(bytes);
  if (!ins.ok) problems.push(ins.error);
  else if (expect.rp2040 !== false && !ins.rp2040) problems.push(`this UF2 is for ${familyName(ins.family)}, not the RP2040 — the bootloader would accept the copy and change nothing`);
  if (expect.size != null && bytes.length !== expect.size) problems.push(`size ${bytes.length} B, expected ${expect.size} B`);
  const sha256 = await sha256hex(bytes);
  if (expect.sha256 && sha256 !== String(expect.sha256).toLowerCase()) problems.push(`sha256 ${sha256.slice(0, 12)}… does not match the pinned ${String(expect.sha256).slice(0, 12)}…`);
  return { ok: !problems.length, problems, sha256, blocks: ins.blocks };
}
