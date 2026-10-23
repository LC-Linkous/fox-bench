// serve.mjs — minimal static server for the repo root (ES modules need http://, not file://).
// SPDX-License-Identifier: GPL-2.0-only
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.py': 'text/x-python', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function serve(root, port = 0) {
  root = resolve(root);
  const overrides = new Map();   // path → { body: Buffer|string, type } set by a test to play a deployed site (CI-written files)
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    if (overrides.has(p)) { const o = overrides.get(p); res.writeHead(200, { 'content-type': o.type || 'application/octet-stream', 'cache-control': 'no-store' }); return res.end(o.body); }
    const file = resolve(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('dir');
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('not found: ' + p); }
  });
  return new Promise(ok => srv.listen(port, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}/`, overrides, close: () => new Promise(r => srv.close(r)) })));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { url } = await serve(process.argv[2] || '.', +(process.argv[3] || 8765));
  console.log('serving', url);
}
