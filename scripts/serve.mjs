// Minimal static server for local dev + e2e. Applies dist/_headers exactly like
// Cloudflare Pages would, so CSP violations show up locally before deploy.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { parseHeaders, headersFor } from './lib.mjs';

const root = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const headersPath = join(root, '_headers');
// Re-read per request so a rebuild (new CSP hashes) never serves stale headers.
const rules = () => (existsSync(headersPath) ? parseHeaders(readFileSync(headersPath, 'utf8')) : []);

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let file = resolve(root, `.${pathname}`);
  // Path traversal guard: never serve outside root.
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || file.endsWith(`${sep}_headers`)) file = join(root, 'index.html'); // Pages SPA fallback
  const body = readFileSync(file);
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...headersFor(rules(), pathname) });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://localhost:${port}`));
