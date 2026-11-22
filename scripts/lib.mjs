// Shared helpers for build/check/serve. Zero runtime dependencies by design (ADR 0001).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const cartridgeUrl = (slug) => new URL(`../games/${slug}/index.html`, import.meta.url);
export const readCartridge = (slug) => readFileSync(cartridgeUrl(slug), 'utf8');
/** Each game namespaces its own localStorage keys: pulse-breach → pulse_breach_v1_. */
export const storagePrefix = (slug) => `${slug.replace(/-/g, '_')}_v1_`;

/** Returns the bodies of every inline <script> / <style> block, in order. */
export function inlineBlocks(html, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
}

/**
 * The hosted copy of a cartridge: its inline <style>/<script> move to same-origin files so the whole site
 * runs under `script-src 'self'` with no hashes, and the ArcadeSDK loads first (ADR 0007). The standalone
 * cartridge (games/<slug>/index.html) is never modified.
 */
export function hostCartridge(html, { slug, canonical }) {
  const styles = inlineBlocks(html, 'style');
  const scripts = [...html.matchAll(/<script id="game-script">([\s\S]*?)<\/script>/g)];
  if (styles.length !== 1 || scripts.length !== 1 || inlineBlocks(html, 'script').length !== 1) {
    throw new Error(`${slug}: a cartridge needs exactly one <style> and one <script id="game-script"> (AGENTS.md)`);
  }
  const base = `/games/${slug}/play`;
  const page = html
    .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/, `<link rel="stylesheet" href="${base}/game.css">`)
    .replace(/<script id="game-script">[\s\S]*?<\/script>/, `<script src="/sdk/arcade-sdk.js"></script>\n<script src="${base}/game.js"></script>`)
    .replace(/<head>/, `<head>\n<meta name="robots" content="noindex">\n<link rel="canonical" href="${canonical}">`);
  return { page, script: scripts[0][1], style: styles[0] };
}

export function buildCsp() {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "manifest-src 'self'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    // Only our own theater may frame pages; a portal build (Poki/CrazyGames) needs its own entry (ADR 0003).
    "frame-ancestors 'self'",
  ].join('; ');
}

export function headersFile() {
  return `/*
  Content-Security-Policy: ${buildCsp()}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), fullscreen=(self)
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/og/*
  Cache-Control: public, max-age=86400
`;
}

/** Parses the subset of Cloudflare's _headers format we emit (path blocks + "Name: value" lines). */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(':');
      if (i > 0) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

export function headersFor(rules, pathname) {
  const out = {};
  for (const r of rules) {
    const match = r.pattern.endsWith('*') ? pathname.startsWith(r.pattern.slice(0, -1)) : pathname === r.pattern;
    if (match) Object.assign(out, r.headers);
  }
  return out;
}
