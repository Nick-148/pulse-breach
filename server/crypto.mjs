// Web Crypto helpers (identical in Workers and Node 22). Nothing here is hand-rolled crypto:
// HMAC/SHA-256 come from crypto.subtle; randomness from crypto.getRandomValues.
const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const randomHex = (n) => toHex(randomBytes(n));

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  try {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function sha256Hex(text) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

/** Uniform random string from `alphabet` via rejection sampling (no modulo bias). */
export function randomString(alphabet, length) {
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L: readable when copied by hand

/** 20 symbols from a 31-letter alphabet ≈ 99 bits of entropy, shown as XXXXX-XXXXX-XXXXX-XXXXX. */
export function newArcadeKey() {
  return randomString(KEY_ALPHABET, 20).match(/.{5}/g).join('-');
}

export function normalizeArcadeKey(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const flat = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{20}$/.test(flat) ? flat : null;
}

export function newFriendCode() {
  return randomString(KEY_ALPHABET, 8);
}

/** Constant-time string comparison for equal-length secrets (hex digests). */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const keyCache = new Map();
async function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, key);
  }
  return key;
}

export async function hmacHex(secret, message) {
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message))));
}

/** Verifies a hex HMAC-SHA256 signature in constant time (crypto.subtle.verify). */
export async function hmacVerifyHex(secret, message, sigHex) {
  const sig = fromHex(sigHex);
  if (!sig || sig.length !== 32) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(message));
}

/** Signed, tamper-evident token: base64url(JSON payload) "." base64url(HMAC). Not encrypted. */
export async function signToken(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const [body, sigText, extra] = token.split('.');
  if (!body || !sigText || extra !== undefined) return null;
  const sig = fromB64url(sigText);
  if (!sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(body));
  if (!ok) return null;
  try {
    const bytes = fromB64url(body);
    return bytes ? JSON.parse(dec.decode(bytes)) : null;
  } catch {
    return null;
  }
}
