// Local server for dev + e2e: serves dist/ with dist/_headers exactly like Cloudflare Pages (so CSP problems
// show up before deploy) and runs /api/* through the real API router on node:sqlite (ADR 0008).
//   node scripts/serve.mjs [root=dist] [port=4173] [--db=.data/dev.sqlite | --db=:memory:]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { parseHeaders, headersFor } from './lib.mjs';
import { createD1, applyMigrations } from './sqlite-d1.mjs';
import { handleApi } from '../server/router.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const root = resolve(positional[0] || 'dist');
const port = Number(positional[1] || 4173);
const dbPath = (args.find((a) => a.startsWith('--db=')) || '--db=.data/dev.sqlite').slice(5);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};
const HIDDEN = new Set(['_headers', '_routes.json']);
const headersPath = join(root, '_headers');
// Re-read per request so a rebuild never serves stale headers.
const rules = () => (existsSync(headersPath) ? parseHeaders(readFileSync(headersPath, 'utf8')) : []);

// Local-only secrets: never used outside this process.
const env = {
  DB: applyMigrations(createD1(dbPath)),
  RUN_SECRET: 'local-dev-run-secret-not-for-production-0000',
  DEV: '1',
  PAYMENTS_SIMULATED: '1',
};

async function api(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('CF-Connecting-IP', req.socket.remoteAddress || '127.0.0.1');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
  const response = await handleApi(request, env);
  const out = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden'); // path traversal
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end(); // Pages adds the trailing slash
      return;
    }
    file = join(file, 'index.html');
  }
  let status = 200;
  if (!existsSync(file) || HIDDEN.has(file.split(sep).pop())) {
    status = 404;
    file = join(root, '404.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
  }
  const body = readFileSync(file);
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...headersFor(rules(), pathname) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"internal"}');
    });
    return;
  }
  serveStatic(req, res, url);
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} + API (db: ${dbPath}) on http://localhost:${port}`));
