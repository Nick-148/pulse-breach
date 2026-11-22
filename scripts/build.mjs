// Builds dist/ for Cloudflare Pages: portal pages generated from shared/games.mjs, hosted cartridges with the
// ArcadeSDK, OG images, sitemap, _headers (site-wide strict CSP) and _routes.json (Functions only on /api/*).
// Standalone single-file copies of each game go to build/standalone/ for itch.io / Poki / CrazyGames uploads.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, readCartridge, hostCartridge, headersFile } from './lib.mjs';
import { GAMES } from '../shared/games.mjs';
import { SITE } from '../shared/site.mjs';
import { homePage, theaterPage, storePage, privacyPage, termsPage, notFoundPage, MARK_SVG } from './pages.mjs';
import { renderOg } from './og.mjs';

const siteUrl = (process.env.SITE_URL || SITE.url).replace(/\/+$/, '');
if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(siteUrl)) throw new Error(`SITE_URL must be an origin like https://example.com (got ${siteUrl})`);
const site = SITE;
const dist = join(ROOT, 'dist');
const standalone = join(ROOT, 'build', 'standalone');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
mkdirSync(standalone, { recursive: true });

const write = (rel, data) => {
  const file = join(dist, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

for (const game of GAMES) {
  const html = readCartridge(game.slug);
  const hosted = hostCartridge(html, { slug: game.slug, canonical: `${siteUrl}/games/${game.slug}/` });
  write(`games/${game.slug}/play/index.html`, hosted.page);
  write(`games/${game.slug}/play/game.js`, hosted.script);
  write(`games/${game.slug}/play/game.css`, hosted.style);
  write(`games/${game.slug}/index.html`, theaterPage({ site, siteUrl, game }));
  write(`og/${game.slug}.png`, renderOg(game.slug));
  writeFileSync(join(standalone, `${game.slug}.html`), html);
}

write('index.html', homePage({ site, siteUrl }));
write('store/index.html', storePage({ site, siteUrl }));
write('privacy/index.html', privacyPage({ site, siteUrl }));
write('terms/index.html', termsPage({ site, siteUrl }));
write('404.html', notFoundPage({ site, siteUrl }));
write('og/site.png', renderOg('site'));
write('assets/img/mark.svg', MARK_SVG);

cpSync(join(ROOT, 'portal', 'assets'), join(dist, 'assets'), { recursive: true });
cpSync(join(ROOT, 'shared'), join(dist, 'shared'), { recursive: true });
cpSync(join(ROOT, 'sdk'), join(dist, 'sdk'), { recursive: true });

write('_headers', headersFile());
write('_routes.json', `${JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2)}\n`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /games/*/play/\nSitemap: ${siteUrl}/sitemap.xml\n`);
const urls = ['/', '/store/', '/privacy/', '/terms/', ...GAMES.map((g) => `/games/${g.slug}/`)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${siteUrl}${u}</loc><changefreq>${u.startsWith('/games/') || u === '/' ? 'daily' : 'monthly'}</changefreq></url>`).join('\n')}
</urlset>
`);
write('manifest.webmanifest', `${JSON.stringify({
  name: site.name, short_name: site.short, start_url: '/', display: 'standalone',
  background_color: '#05060f', theme_color: '#05060f',
  icons: [{ src: '/assets/img/mark.svg', sizes: 'any', type: 'image/svg+xml' }],
}, null, 2)}\n`);

// Post-build guard: generated portal pages must satisfy the CSP (no inline JS/handlers/style attributes).
const problems = [];
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(dist).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  const rel = file.slice(dist.length);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1];
    if (!/\bsrc=/.test(attrs) && !/type="application\/ld\+json"/.test(attrs) && m[2].trim()) problems.push(`${rel}: inline <script>`);
  }
  if (/<style\b/.test(html)) problems.push(`${rel}: inline <style>`);
  if (/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) problems.push(`${rel}: inline event handler`);
  if (/\sstyle\s*=\s*["']/i.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) problems.push(`${rel}: style="" attribute`);
}
if (problems.length) {
  console.error(`build produced CSP-incompatible HTML:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`built dist/ for ${siteUrl}: ${GAMES.length} games, ${urls.length} indexable pages`);
