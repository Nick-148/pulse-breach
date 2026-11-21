// Builds dist/ for Cloudflare Pages: the game file unchanged + _headers with a
// hash-based CSP computed from the exact inline <script>/<style> bodies.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readSource, headersFile, inlineBlocks } from './lib.mjs';

const html = readSource();
if (inlineBlocks(html, 'script').length !== 1 || inlineBlocks(html, 'style').length !== 1) {
  throw new Error('Expected exactly one inline <script> and one <style> (CSP hashing assumes it).');
}
const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'index.html'), html);
writeFileSync(join(dist, '_headers'), headersFile(html));
writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log(`built dist/ (index.html ${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB)`);
