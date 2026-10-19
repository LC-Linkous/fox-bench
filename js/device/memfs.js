// memfs.js — an in-memory stand-in for FileSystemDirectoryHandle (the File System Access API),
// just the surface drive-device.js uses. The demo board uses it; so do the unit tests.
// SPDX-License-Identifier: GPL-2.0-only

const enc = new TextEncoder();
const toBytes = async d => d instanceof Uint8Array ? d : typeof d === 'string' ? enc.encode(d) : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(await d.arrayBuffer());

class MemFile {
  constructor(name, bytes) { this.name = name; this.bytes = bytes; this.size = bytes.length; this.lastModified = Date.now(); }
  async arrayBuffer() { return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength); }
  async text() { return new TextDecoder().decode(this.bytes); }
}
class MemFileHandle {
  constructor(dir, name) { this.kind = 'file'; this.dir = dir; this.name = name; }
  async getFile() { return new MemFile(this.name, this.dir.files.get(this.name)); }
  async createWritable({ keepExistingData = false } = {}) {
    const dir = this.dir, name = this.name; let buf = keepExistingData ? Uint8Array.from(dir.files.get(name)) : new Uint8Array(0);
    return {
      async write(data) { const b = await toBytes(data && data.type === 'write' ? data.data : data); const n = new Uint8Array(buf.length + b.length); n.set(buf); n.set(b, buf.length); buf = n; },
      async truncate(n) { buf = buf.slice(0, n); },
      async close() { dir.files.set(name, buf); dir.writes++; },
      async abort() {},
    };
  }
}

export class MemDirectoryHandle {
  constructor(name = 'PICOFOX', files = {}) {
    this.kind = 'directory'; this.name = name; this.files = new Map(); this.writes = 0;
    for (const [k, v] of Object.entries(files)) this.files.set(k, typeof v === 'string' ? enc.encode(v) : v);
  }
  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) { if (!create) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' }); this.files.set(name, new Uint8Array(0)); }
    return new MemFileHandle(this, name);
  }
  async getDirectoryHandle(name) { throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' }); }
  async removeEntry(name) { if (!this.files.delete(name)) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' }); }
  async *values() { for (const name of this.files.keys()) yield new MemFileHandle(this, name); }
  async *entries() { for (const name of this.files.keys()) yield [name, new MemFileHandle(this, name)]; }
  async *keys() { yield* this.files.keys(); }
  async isSameEntry(o) { return o === this; }
}
