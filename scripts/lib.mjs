// Shared helpers for build/check/serve. Zero dependencies by design (ADR 0001).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SRC_HTML = new URL('../games/pulse-breach/index.html', import.meta.url);

export function readSource() {
  return readFileSync(SRC_HTML, 'utf8');
}

/** Returns the bodies of every inline <script> / <style> block, in order. */
export function inlineBlocks(html, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
}

/** CSP source expression for an inline block: 'sha256-<base64>' of its exact text. */
export function cspHash(body) {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

export function buildCsp(html) {
  const scripts = inlineBlocks(html, 'script').map(cspHash).join(' ');
  const styles = inlineBlocks(html, 'style').map(cspHash).join(' ');
  return [
    "default-src 'none'",
    `script-src ${scripts}`,
    `style-src ${styles}`,
    "img-src 'self' data:",
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // 'self' only: portals that iframe the game need an explicit entry (see ADR 0004).
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function headersFile(html) {
  return `/*
  Content-Security-Policy: ${buildCsp(html)}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/
  Cache-Control: public, max-age=0, must-revalidate

/index.html
  Cache-Control: public, max-age=0, must-revalidate
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
