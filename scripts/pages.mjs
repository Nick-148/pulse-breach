// Static page templates for the portal. Rendered at build time from shared/games.mjs so every route ships
// real, indexable HTML (title, description, controls, strategy) before any JS runs. All text is escaped.
import { CATEGORIES, GAMES } from '../shared/games.mjs';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id;
const YEAR = 2026;

function head({ site, siteUrl, title, description, path, image, noindex }) {
  const url = new URL(path, siteUrl).toString();
  const img = new URL(image, siteUrl).toString();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta name="theme-color" content="#05060f">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/img/mark.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/assets/css/portal.css">`;
}

function header(site, current) {
  const [first, ...rest] = site.name.split(' ');
  const nav = [['/#games', 'Games', 'games'], ['/store/', 'Store', 'store']]
    .map(([href, label, id]) => `<a href="${href}"${current === id ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <a class="brand" href="/" aria-label="${esc(site.name)} home"><img class="brand-mark" src="/assets/img/mark.svg" alt="" width="26" height="26"><span class="brand-text">${esc(first.toUpperCase())} <span>${esc(rest.join(' ').toUpperCase())}</span></span></a>
  <nav class="site-nav" aria-label="Main">${nav}</nav>
  <div class="hud">
    <span class="pill" id="streak-pill" hidden><span aria-hidden="true">🔥</span> <b>0</b></span>
    <span class="pill" id="wallet-pill" title="Arcade Credits"><span aria-hidden="true">🪙</span> <b id="wallet-credits">0</b><span class="sr-only"> credits</span><span id="wallet-gems-wrap" hidden> · <span aria-hidden="true">💎</span> <b id="wallet-gems">0</b><span class="sr-only"> gems</span></span></span>
    <button class="btn small" id="profile-btn" type="button">Sign in</button>
  </div>
</header>
<p id="offline-note" class="notice wrap" role="status" hidden>Online features are unavailable right now. Games still work and your progress is saved on this device.</p>`;
}

function footer(site) {
  return `<footer class="site-footer"><div class="wrap">
  <nav aria-label="Footer"><a href="/">Home</a><a href="/#games">Games</a><a href="/store/">Store</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></nav>
  <p>© ${YEAR} ${esc(site.name)}. Free browser games: no download, no sign-up needed.</p>
</div></footer>
<div id="toast" role="status" aria-live="polite"></div>`;
}

function page({ site, siteUrl, title, description, path, image = '/og/site.png', current, bodyAttrs = '', main, script, ld, noindex }) {
  return `${head({ site, siteUrl, title, description, path, image, noindex })}
${script ? `<script type="module" src="${script}"></script>\n` : ''}${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>\n` : ''}</head>
<body${bodyAttrs}>
${header(site, current)}
${main}
${footer(site)}
</body>
</html>
`;
}

function gameCard(g) {
  const chips = g.categories.map((c) => `<span class="chip">${esc(catLabel(c))}</span>`).join('');
  return `<li class="game-card" data-categories="${esc(g.categories.join(' '))}">
  <img src="/og/${g.slug}.png" alt="" width="1200" height="630" loading="lazy">
  <div class="body"><h3><a class="cover" href="/games/${g.slug}/">${esc(g.title)}</a></h3><p>${esc(g.blurb)}</p><div class="chips">${chips}</div></div>
</li>`;
}

export function homePage({ site, siteUrl }) {
  const first = GAMES[0];
  const filters = CATEGORIES.map((c) => `<button type="button" data-filter="${c.id}" aria-pressed="false">${esc(c.label)}</button>`).join('');
  const empty = CATEGORIES.filter((c) => !GAMES.some((g) => g.categories.includes(c.id)));
  const soon = empty.map((c) => `<li class="game-card soon" data-category="${c.id}"><p><strong>${esc(c.label)}</strong><br>New games coming soon</p></li>`).join('');
  const main = `<main id="main" class="wrap">
<section class="hero">
  <p class="kicker">Daily seeded arcade</p>
  <h1>${esc(site.tagline)}</h1>
  <p>Instant browser games where everyone plays the same seeded run each day. No download and no sign-up: play in seconds, climb the daily leaderboard, then send friends a link to beat your score.</p>
</section>
<section id="featured" class="featured" aria-labelledby="featured-title">
  <div>
    <p class="kicker">Daily Challenge <span class="badge">2x credits</span></p>
    <h2 id="featured-title">${esc(first.title)}: ${esc(first.subtitle)}</h2>
    <p id="featured-blurb">${esc(first.blurb)}</p>
    <p class="muted small">New seed in <span id="featured-countdown" class="countdown">--:--:--</span> (UTC midnight)</p>
    <a id="featured-play" class="btn primary" href="/games/${first.slug}/">Play today's run</a>
  </div>
  <img id="featured-art" src="/og/${first.slug}.png" alt="" width="1200" height="630">
</section>
<div id="ticker" class="ticker" hidden><p class="sr-only">Today's top scores</p><ul id="ticker-track"></ul></div>
<div class="split">
  <section class="panel" aria-labelledby="quests-h"><h2 id="quests-h">Daily quests</h2><ul id="quest-list"></ul><p id="quest-note" class="muted small"></p></section>
  <section class="panel" aria-labelledby="how-h"><h2 id="how-h">How it works</h2>
    <ol>
      <li><strong>Same seed for everyone.</strong> Each game's daily run is generated from the UTC date, so every player faces identical hazards.</li>
      <li><strong>Play instantly as a guest.</strong> Credits, streaks and quests save on your device. Create a free account (no email) to claim leaderboard spots.</li>
      <li><strong>Challenge friends.</strong> Every run ends with a link that drops your friend into the same seed with your score to beat and your ghost to race.</li>
    </ol>
  </section>
</div>
<section id="games" aria-labelledby="games-h">
  <h2 id="games-h">All games</h2>
  <div class="filters" role="group" aria-label="Filter games by category"><button type="button" data-filter="all" aria-pressed="true">All</button>${filters}</div>
  <p id="filter-status" class="sr-only" aria-live="polite"></p>
  <ul class="game-grid">${GAMES.map(gameCard).join('\n')}${soon}</ul>
</section>
</main>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: siteUrl,
    description: site.tagline,
  };
  return page({
    site, siteUrl, path: '/', current: 'games', main, ld, script: '/assets/js/home.mjs',
    title: `${site.name}: free daily browser games, same seed for everyone`,
    description: `Free instant-play browser arcade games with a daily seeded challenge, global leaderboards and friend challenge links. ${GAMES.map((g) => g.title).join(', ')}.`,
  });
}

export function theaterPage({ site, siteUrl, game }) {
  const controls = game.controls.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const tips = game.strategy.map((s) => `<li>${esc(s)}</li>`).join('');
  const others = GAMES.filter((g) => g.slug !== game.slug)
    .map((g) => `<li><a href="/games/${g.slug}/">${esc(g.title)}</a><span class="muted small">${esc(g.blurb)}</span></li>`).join('');
  const main = `<main id="main" class="wrap theater-wrap">
<div class="theater">
  <div class="stage-col">
    <div class="ad-wrap ad-desktop"><span class="ad-label">Advertisement</span><div class="ad-slot" data-size="728x90"></div></div>
    <p id="target-banner" class="target-banner" role="status" hidden></p>
    <div class="frame-wrap"><iframe id="game-frame" title="${esc(game.title)} game" allow="fullscreen; clipboard-write; autoplay"></iframe></div>
    <div class="frame-tools">
      <h1>${esc(game.title)}: ${esc(game.subtitle)}</h1>
      <button id="fullscreen-btn" class="btn small" type="button"><span aria-hidden="true">⛶</span> Fullscreen</button>
    </div>
    <div class="ad-wrap ad-mobile"><span class="ad-label">Advertisement</span><div class="ad-slot" data-size="320x50"></div></div>
  </div>
  <aside class="board panel" aria-labelledby="board-h">
    <h2 id="board-h" class="h3">Leaderboard</h2>
    <div id="board-tabs" class="tabs" role="tablist" aria-label="Leaderboard period">
      <button class="tab" type="button" role="tab" aria-selected="true" data-board="daily">Today</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-board="alltime">All-time</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-board="friends">Friends</button>
    </div>
    <p id="board-status" class="muted small" aria-live="polite">Loading…</p>
    <ol id="board-list"></ol>
    <p id="board-me" class="small"></p>
    <section id="challenge-card" class="stack" aria-live="polite" hidden></section>
  </aside>
</div>
<section class="about" aria-labelledby="about-h">
  <div>
    <h2 id="about-h">About ${esc(game.title)}</h2>
    <p>${esc(game.description)}</p>
    <h3>Controls</h3>
    <dl>${controls}</dl>
    <h3>Strategy tips</h3>
    <ul>${tips}</ul>
  </div>
  <div>
    <h3>Daily seed and challenges</h3>
    <p>Everyone gets the same ${esc(game.title)} run each UTC day. Finish a run to get a challenge link with your score; your friend plays the exact same seed and races your ghost.</p>
    <h3>More games</h3>
    <ul class="list">${others || '<li>More games are on the way.</li>'}</ul>
  </div>
</section>
</main>`;
  const url = new URL(`/games/${game.slug}/`, siteUrl).toString();
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: `${game.title}: ${game.subtitle}`,
    description: game.description,
    url,
    image: new URL(`/og/${game.slug}.png`, siteUrl).toString(),
    genre: game.categories.map(catLabel),
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
  return page({
    site, siteUrl, path: `/games/${game.slug}/`, image: `/og/${game.slug}.png`, ld, main,
    bodyAttrs: ` data-game="${esc(game.slug)}"`, script: '/assets/js/theater.mjs',
    title: `${game.title}: ${game.subtitle} | Play free online | ${site.name}`,
    description: `${game.blurb} Free to play in your browser, daily leaderboard, challenge your friends.`,
  });
}

export function storePage({ site, siteUrl }) {
  const main = `<main id="main" class="wrap">
<section class="hero">
  <h1>Store</h1>
  <p>Every game is free to play. Purchases are optional, cosmetic or convenience only, and support new games.</p>
</section>
<p id="checkout-note" class="notice" role="status" hidden></p>
<section aria-labelledby="items-h">
  <h2 id="items-h">Trails</h2>
  <p class="muted">Cosmetic trails show up in every game. Earn credits by playing, finishing daily quests and keeping your login streak.</p>
  <ul id="item-grid" class="card-grid"></ul>
</section>
<section aria-labelledby="products-h">
  <h2 id="products-h">Passes and packs</h2>
  <p id="product-status" class="muted">Loading…</p>
  <ul id="product-grid" class="card-grid"></ul>
</section>
<p class="muted small">Prices in USD. Payments are processed by Stripe; we never see or store card details. Virtual items have no cash value. See the <a href="/terms/">terms</a>.</p>
</main>`;
  return page({
    site, siteUrl, path: '/store/', current: 'store', main, script: '/assets/js/store.mjs',
    title: `Store | ${site.name}`, description: `Optional cosmetic trails, the ad-free pass and credit packs for ${site.name}.`,
  });
}

const DRAFT = '<p class="notice"><strong>Draft.</strong> This page is a working draft pending legal review before launch.</p>';

export function privacyPage({ site, siteUrl }) {
  const main = `<main id="main" class="wrap prose">
<h1>Privacy</h1>
${DRAFT}
<p>${esc(site.name)} is built to need as little personal data as possible. Last updated ${YEAR}-11-21.</p>
<h2>Playing as a guest</h2>
<p>Guest progress (credits, streak, quest progress, game settings) is stored only in your browser's local storage on your device. We don't receive it unless you create an account.</p>
<h2>Accounts</h2>
<ul>
  <li>We store your chosen username, a one-way hash of your Arcade Key, your scores and run replays ("ghosts"), credits, items and purchase records.</li>
  <li>We do not ask for your name, email address, birthday or location. Please don't use your real name as a username: usernames appear on public leaderboards.</li>
  <li>One strictly necessary cookie keeps you signed in. We use no advertising or analytics cookies today.</li>
</ul>
<h2>Security and abuse prevention</h2>
<p>To stop spam and cheating we rate-limit requests using a salted hash of your IP address that changes every day. We never store raw IP addresses.</p>
<h2>Payments</h2>
<p>Purchases are processed by Stripe, which handles your card details under its own privacy policy. We receive only the order status.</p>
<h2>Advertising</h2>
<p>Ads currently shown are placeholders. Before real ads are enabled we will update this page and, where required, ask for your consent.</p>
<h2>Children</h2>
<p>We do not knowingly collect personal information from children. Accounts need no personal information, and usernames are filtered.</p>
<h2>Your choices</h2>
<p>You can delete your account and all associated data at any time from your profile (Profile → Delete account). Clearing your browser storage removes guest data.</p>
</main>`;
  return page({ site, siteUrl, path: '/privacy/', main, script: '/assets/js/static.mjs', title: `Privacy | ${site.name}`, description: `How ${site.name} handles your data.` });
}

export function termsPage({ site, siteUrl }) {
  const main = `<main id="main" class="wrap prose">
<h1>Terms of play</h1>
${DRAFT}
<ul>
  <li><strong>Free to play.</strong> All games can be played for free, without an account.</li>
  <li><strong>Fair play.</strong> Don't cheat, automate, or tamper with games or requests. We may remove scores or accounts that break the rules.</li>
  <li><strong>Usernames.</strong> Keep them friendly and don't impersonate others or use your real name. We may rename or remove offensive names.</li>
  <li><strong>Virtual items.</strong> Credits, gems, passes and cosmetics are a limited licence to use in ${esc(site.name)}. They have no cash value and can't be exchanged or transferred.</li>
  <li><strong>Purchases.</strong> Optional purchases are processed by Stripe. Refunds follow the law where you live; contact us if something went wrong.</li>
  <li><strong>Availability.</strong> Games and online features are provided as is and may change, pause or end.</li>
</ul>
</main>`;
  return page({ site, siteUrl, path: '/terms/', main, script: '/assets/js/static.mjs', title: `Terms | ${site.name}`, description: `Terms of play for ${site.name}.` });
}

export function notFoundPage({ site, siteUrl }) {
  const main = `<main id="main" class="wrap prose">
<h1>Lost in the void</h1>
<p>That page drifted out of range. Try the <a href="/">home page</a> or jump into a game:</p>
<ul>${GAMES.map((g) => `<li><a href="/games/${g.slug}/">${esc(g.title)}</a></li>`).join('')}</ul>
</main>`;
  return page({ site, siteUrl, path: '/404', main, script: '/assets/js/static.mjs', noindex: true, title: `Not found | ${site.name}`, description: 'Page not found.' });
}

export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#29f3ff"/><stop offset="1" stop-color="#ff2bd6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#05060f"/><path d="M32 8c10 12 16 20 16 29a16 16 0 0 1-32 0c0-9 6-17 16-29z" fill="none" stroke="url(#g)" stroke-width="5"/><circle cx="32" cy="38" r="6" fill="#29f3ff"/></svg>
`;
