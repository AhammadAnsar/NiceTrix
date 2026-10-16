// Small local static test server. Production consists only of dist/ files.
// Implements the project's explicit Pages redirects and a genuine 404 response.
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function serve(port = 4321) {
  const root = path.resolve('dist');
  const rules = (await readFile(path.join(root, '_redirects'), 'utf8')).trim().split('\n').map(l => l.trim().split(/\s+/));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      const rule = rules.find(([from]) => decodeURIComponent(from) === pathname);
      if (rule) {
        if (Number(rule[2]) !== 200) { res.writeHead(Number(rule[2]), { Location: rule[1] }); res.end(); return; }
        pathname = decodeURIComponent(rule[1]);
      }
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep) && file !== root) throw new Error('Invalid path');
      if (existsSync(file) && (await stat(file)).isDirectory()) {
        if (!pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); res.end(); return; }
        file = path.join(file, 'index.html');
      }
      const found = existsSync(file) && (await stat(file)).isFile();
      if (!found) file = path.join(root, '404.html');
      res.writeHead(found ? 200 : 404, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch { res.writeHead(400); res.end('Bad request'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await serve(Number(process.env.PORT || 4321));
  console.log('NiceTrix static preview: http://127.0.0.1:4321');
}
