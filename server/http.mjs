// HTTP helpers for the API. Web-standard Request/Response only (Workers + Node 22).
import { isObj } from '../shared/util.mjs';

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export const MAX_BODY_BYTES = 64 * 1024;

/** Reads a JSON object body with a hard size cap. Throws HttpError on anything else. */
export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'body-too-large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'body-too-large');
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'bad-json');
  }
  if (!isObj(body)) throw new HttpError(400, 'bad-body');
  return body;
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookieName(env) {
  // __Host- requires Secure, which plain-http local dev can't set.
  return env.DEV === '1' ? 'arcade_sid' : '__Host-arcade_sid';
}

export function sessionCookie(env, value, maxAgeSeconds) {
  const parts = [`${sessionCookieName(env)}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (env.DEV !== '1') parts.push('Secure');
  return parts.join('; ');
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || '0.0.0.0';
}

/**
 * CSRF guard for state-changing requests: JSON content type (forces a CORS preflight cross-site) and an
 * Origin header matching this site. The session cookie is SameSite=Lax as a second layer.
 */
export function assertSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== url.origin) throw new HttpError(403, 'bad-origin');
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'json-required');
}
