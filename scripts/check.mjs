// Static guards (run before build). Fails fast on anything that would break "zero dependency" cartridges,
// the strict CSP, the no-HTML-string-sink rule, or the client/server boundary.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GAMES } from '../shared/games.mjs';
import { ROOT, readCartridge, inlineBlocks, storagePrefix, cartridgeUrl } from './lib.mjs';

const failures = [];
const rule = (ok, msg) => { if (!ok) failures.push(msg); };
const SINKS = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write\s*\(/;
const EVAL = /\beval\s*\(|new Function\s*\(/;

const sizes = [];
for (const game of GAMES) {
  const tag = `games/${game.slug}`;
  if (!existsSync(cartridgeUrl(game.slug))) { failures.push(`${tag}/index.html is missing (registered in shared/games.mjs)`); continue; }
  const html = readCartridge(game.slug);
  const script = inlineBlocks(html, 'script').join('\n');
  const outside = html.replace(script, '');
  const bytes = Buffer.byteLength(html);
  sizes.push(`${game.slug} ${(bytes / 1024).toFixed(1)} KiB`);
  rule(bytes < 160 * 1024, `${tag}: ${bytes} bytes; budget is 160 KiB`);
  rule(inlineBlocks(html, 'script').length === 1 && /<script id="game-script">/.test(html), `${tag}: exactly one inline <script id="game-script"> expected`);
  rule(inlineBlocks(html, 'style').length === 1, `${tag}: exactly one inline <style> expected`);
  rule(!/<script[^>]+src=/i.test(html), `${tag}: external <script src> is not allowed (the build injects the SDK)`);
  rule(!/<link[^>]+rel=["']?stylesheet/i.test(html), `${tag}: external stylesheets are not allowed`);
  rule(!/(src|href)=["']?(https?:)?\/\//i.test(html), `${tag}: no remote src/href (zero external dependencies)`);
  rule(!/@import|url\(\s*["']?(https?:)?\/\//i.test(html), `${tag}: no remote CSS imports/urls`);
  rule(!/\son[a-z]+\s*=/i.test(outside), `${tag}: inline event handler attributes break CSP`);
  rule(!/\sstyle\s*=\s*["']/i.test(outside), `${tag}: inline style="" attributes break CSP`);
  rule(!SINKS.test(script), `${tag}: HTML-string DOM sinks are banned (use textContent / h())`);
  rule(!EVAL.test(script), `${tag}: eval/new Function are banned`);
  rule(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|['"`]\/api\//.test(script), `${tag}: games never touch the network or /api (use ArcadeSDK)`);
  rule(!/\b(TODO|FIXME|XXX)\b/.test(html), `${tag}: no TODO/FIXME placeholders in a shipped file`);
  rule(/'use strict'/.test(script), `${tag}: script must be 'use strict'`);
  rule(script.includes(storagePrefix(game.slug)), `${tag}: storage keys must be namespaced under ${storagePrefix(game.slug)}`);
}

const files = (dir, ext) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.some((e) => p.endsWith(e)) ? [p] : [];
  });
};
const rel = (p) => p.slice(ROOT.length);

for (const file of [...files(join(ROOT, 'portal'), ['.mjs', '.js']), ...files(join(ROOT, 'sdk'), ['.js']), ...files(join(ROOT, 'shared'), ['.mjs'])]) {
  const src = readFileSync(file, 'utf8');
  rule(!SINKS.test(src), `${rel(file)}: HTML-string DOM sinks are banned`);
  rule(!EVAL.test(src), `${rel(file)}: eval/new Function are banned`);
}
for (const file of [...files(join(ROOT, 'sdk'), ['.js']), ...files(join(ROOT, 'shared'), ['.mjs'])]) {
  const src = readFileSync(file, 'utf8');
  rule(!/\bfetch\s*\(|XMLHttpRequest|localStorage|document\./.test(src), `${rel(file)}: must stay pure (no network, storage or DOM)`);
}
for (const file of files(join(ROOT, 'server'), ['.mjs'])) {
  const src = readFileSync(file, 'utf8');
  rule(!/from 'node:/.test(src), `${rel(file)}: server code must use Web APIs only (runs on Workers)`);
  // Only the payment provider talks to a third party, and only to Stripe's API.
  if (!file.endsWith('payments.mjs')) rule(!/\bfetch\s*\(/.test(src), `${rel(file)}: outbound fetch is only allowed in server/payments.mjs`);
  // SQL template literals may only interpolate ALL_CAPS constant fragments; values must be bound with `?`.
  for (const m of src.matchAll(/`([^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*)`/g)) {
    for (const expr of m[1].matchAll(/\$\{([^}]*)\}/g)) {
      rule(/^[A-Z][A-Z0-9_]*$/.test(expr[1].trim()), `${rel(file)}: SQL interpolates \${${expr[1]}}; bind values with ? instead`);
    }
  }
}

if (failures.length) {
  console.error(`check failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`check ok (${sizes.join(', ')}; portal, SDK, shared and server guards passed)`);
