// Procedural Open Graph images (1200x630 PNG) with zero dependencies: a tiny additive rasterizer plus a PNG
// encoder on node:zlib. Social previews need a real image file; games themselves stay asset-free (ADR 0001).
import { deflateSync } from 'node:zlib';

const W = 1200;
const H = 630;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(rgb, width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = y === 0 ? 0 : 2; // "Up" filter: smooth vertical gradients compress to almost nothing
    for (let i = 0; i < stride; i++) {
      const v = rgb[y * stride + i];
      raw[row + 1 + i] = y === 0 ? v : (v - rgb[(y - 1) * stride + i]) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);

class Canvas {
  constructor() {
    this.px = new Float32Array(W * H * 3);
  }

  background(top, bottom) {
    const a = hex(top);
    const b = hex(bottom);
    for (let y = 0; y < H; y++) {
      const t = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        for (let k = 0; k < 3; k++) this.px[i + k] = a[k] + (b[k] - a[k]) * t;
      }
    }
  }

  /** Coverage-based draw over a bounding box: `fn(x, y)` returns 0..1 coverage. */
  shade(x0, y0, x1, y1, color, alpha, fn, additive = false) {
    const c = hex(color);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
        const cov = fn(x + 0.5, y + 0.5) * alpha;
        if (cov <= 0) continue;
        const i = (y * W + x) * 3;
        for (let k = 0; k < 3; k++) this.px[i + k] = additive ? this.px[i + k] + c[k] * cov : this.px[i + k] * (1 - cov) + c[k] * cov;
      }
    }
  }

  glow(cx, cy, r, color, intensity = 0.6) {
    this.shade(cx - 3 * r, cy - 3 * r, cx + 3 * r, cy + 3 * r, color, intensity, (x, y) => Math.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (r * r))), true);
  }

  disc(cx, cy, r, color, alpha = 1) {
    this.shade(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, color, alpha, (x, y) => Math.min(1, Math.max(0, r - Math.hypot(x - cx, y - cy) + 0.5)));
  }

  ring(cx, cy, r, width, color, alpha = 1, a0 = -Infinity, a1 = Infinity) {
    const R = r + width;
    this.shade(cx - R - 1, cy - R - 1, cx + R + 1, cy + R + 1, color, alpha, (x, y) => {
      const ang = Math.atan2(y - cy, x - cx);
      if (ang < a0 || ang > a1) return 0;
      return Math.min(1, Math.max(0, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5));
    });
  }

  line(x0, y0, x1, y1, width, color, alpha = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const pad = width + 2;
    this.shade(Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.max(x0, x1) + pad, Math.max(y0, y1) + pad, color, alpha, (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
      const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
      return Math.min(1, Math.max(0, width / 2 - d + 0.5));
    });
  }

  /** Filled polygon via 4x supersampled even-odd test. */
  poly(points, color, alpha = 1) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    this.shade(Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1, color, alpha, (x, y) => {
      let n = 0;
      for (const [ox, oy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) if (inside(x + ox, y + oy)) n++;
      return n / 4;
    });
  }

  grid(color, step, alpha) {
    for (let x = 0; x < W; x += step) this.line(x, 0, x, H, 1, color, alpha);
    for (let y = 0; y < H; y += step) this.line(0, y, W, y, 1, color, alpha);
  }

  png() {
    const out = new Uint8Array(W * H * 3);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, this.px[i])) * 255);
    return encodePng(out, W, H);
  }
}

/** Deterministic pseudo-random for decoration placement (stable images across builds). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ship(c, x, y, angle, size, color) {
  const pts = [[size, 0], [-size * 0.7, size * 0.6], [-size * 0.35, 0], [-size * 0.7, -size * 0.6]]
    .map(([px, py]) => [x + px * Math.cos(angle) - py * Math.sin(angle), y + px * Math.sin(angle) + py * Math.cos(angle)]);
  c.glow(x, y, size * 2.2, color, 0.5);
  c.poly(pts, color);
}

function pulseBreach(c) {
  const r = rng(7);
  c.background('#05060f', '#0d0a2a');
  c.grid('#1b2456', 60, 0.35);
  for (let i = 0; i < 5; i++) c.ring(840, 300, 70 + i * 62, 4, i % 2 ? '#ff2bd6' : '#29f3ff', 0.55 - i * 0.08);
  c.glow(840, 300, 120, '#ff2bd6', 0.35);
  c.line(0, 520, 1200, 430, 10, '#ff2bd6', 0.9);
  c.glow(600, 475, 160, '#ff2bd6', 0.18);
  for (let i = 0; i < 26; i++) {
    const x = r() * W;
    const y = r() * H;
    const s = 6 + r() * 22;
    c.disc(x, y, s, '#46507e', 0.9);
    c.ring(x, y, s, 2, '#8d97c7', 0.5);
  }
  for (let i = 0; i < 9; i++) {
    const x = 120 + r() * 960;
    const y = 80 + r() * 470;
    c.glow(x, y, 16, '#ffe14d', 0.7);
    c.disc(x, y, 6, '#fff3b0');
  }
  ship(c, 360, 300, -0.35, 46, '#29f3ff');
  c.line(200, 360, 330, 312, 10, '#29f3ff', 0.35);
}

function neonDrift(c) {
  const r = rng(11);
  c.background('#04090b', '#0b1a14');
  c.grid('#123329', 60, 0.35);
  const beacons = [[300, 210], [640, 420], [960, 190], [1060, 470], [180, 500]];
  for (const [x, y] of beacons) {
    c.glow(x, y, 50, '#7dff6b', 0.45);
    c.ring(x, y, 34, 4, '#7dff6b', 0.9);
    c.disc(x, y, 12, '#d9ffd2');
  }
  c.ring(640, 420, 150, 8, '#ffb347', 0.95, -Math.PI, -0.2);
  c.glow(640 + 150 * Math.cos(-0.2), 420 + 150 * Math.sin(-0.2), 40, '#ffb347', 0.6);
  c.line(640, 420, 640 + 150 * Math.cos(-0.2), 420 + 150 * Math.sin(-0.2), 3, '#ffb347', 0.6);
  ship(c, 640 + 150 * Math.cos(-0.2), 420 + 150 * Math.sin(-0.2), -0.2 + Math.PI / 2, 34, '#ffb347');
  for (let i = 0; i < 12; i++) {
    const x = 80 + r() * 1040;
    const y = 60 + r() * 510;
    c.glow(x, y, 18, '#ffd23f', 0.4);
    c.poly([[x - 9, y - 9], [x + 9, y - 9], [x + 9, y + 9], [x - 9, y + 9]], '#ffd23f');
  }
  for (let i = 0; i < 10; i++) {
    const x = r() * W;
    const y = r() * H;
    c.glow(x, y, 14, '#ff3b5c', 0.5);
    c.disc(x, y, 8, '#ff3b5c');
  }
}

function site(c) {
  c.background('#05060f', '#100a26');
  c.grid('#1b2456', 60, 0.3);
  const r = rng(3);
  for (let i = 0; i < 60; i++) {
    const x = r() * W;
    const y = r() * H * 0.9;
    c.glow(x, y, 4 + r() * 10, i % 3 ? '#29f3ff' : '#ff2bd6', 0.5);
  }
  for (let i = 0; i < 4; i++) c.ring(380, 315, 60 + i * 55, 4, '#29f3ff', 0.5 - i * 0.1);
  ship(c, 380, 315, -0.4, 40, '#29f3ff');
  c.ring(840, 330, 120, 7, '#ffb347', 0.9, -Math.PI, 0);
  c.glow(840, 330, 40, '#7dff6b', 0.6);
  c.ring(840, 330, 30, 4, '#7dff6b');
}

const ART = { 'pulse-breach': pulseBreach, 'neon-drift': neonDrift, site };

/** PNG for a game slug (or 'site'); unknown games get the site art so a new game never breaks the build. */
export function renderOg(slug) {
  const c = new Canvas();
  (ART[slug] || site)(c);
  return c.png();
}

export const OG_SIZE = { width: W, height: H };
