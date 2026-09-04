// Zero-dependency static server. `node game/tools/serve.mjs [port]`
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8123);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.glb':'model/gltf-binary' };
createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const s = await stat(f).catch(() => null);
    if (!s || s.isDirectory()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (e) { res.writeHead(500).end(String(e)); }
}).listen(PORT, () => console.log(`hanedan: http://localhost:${PORT}/`));
