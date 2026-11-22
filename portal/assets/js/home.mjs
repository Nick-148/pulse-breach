// Home / discovery hub: featured daily game, quests, trending ticker, category filters.
import { gameBySlug } from '/shared/games.mjs';
import { fmtInt, msUntilNextUtcDay } from '/shared/util.mjs';
import { bootShell, openProfile } from './shell.mjs';
import { errorMessage } from './api.mjs';
import { $, $$, h, replace, toast, formatDuration } from './dom.mjs';

function wireFilters() {
  const buttons = $$('[data-filter]');
  const cards = $$('.game-card[data-categories]');
  const status = $('#filter-status');
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const f = b.dataset.filter;
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      let shown = 0;
      for (const c of cards) {
        const match = f === 'all' || c.dataset.categories.split(' ').includes(f);
        c.hidden = !match;
        if (match) shown++;
      }
      for (const soon of $$('.game-card.soon')) soon.hidden = f !== 'all' && soon.dataset.category !== f;
      status.textContent = shown ? `${shown} game${shown === 1 ? '' : 's'}` : 'New games in this category are on the way.';
    });
  }
}

function renderFeatured(p) {
  const game = gameBySlug(p.featuredSlug);
  const box = $('#featured');
  if (!game || !box) return;
  box.style.setProperty('--game-accent', game.accent);
  $('#featured-title').textContent = `${game.title}: ${game.subtitle}`;
  $('#featured-blurb').textContent = game.blurb;
  $('#featured-play').href = `/games/${game.slug}/`;
  $('#featured-play').textContent = `Play today's ${game.title}`;
  $('#featured-art').src = `/og/${game.slug}.png`;
  const timer = $('#featured-countdown');
  const tick = () => { timer.textContent = formatDuration(msUntilNextUtcDay()); };
  tick();
  setInterval(tick, 1000);
}

function renderQuests(p) {
  const list = $('#quest-list');
  if (!list) return;
  replace(list, p.quests().map((q) => {
    const pct = Math.round((q.value / q.target) * 100);
    const bar = h('i');
    bar.style.width = `${pct}%`;
    const claim = h('button', {
      class: `btn small ${q.done && !q.claimed ? 'primary' : ''}`, type: 'button',
      disabled: !q.done || q.claimed, text: q.claimed ? 'Claimed' : `Claim +${q.reward}`,
      onclick: async () => {
        const r = await p.claimQuest(q.id);
        toast(r.ok ? `+${fmtInt(r.granted)} credits` : errorMessage(r.error));
        renderQuests(p);
      },
    });
    return h('li', { class: 'quest' },
      h('div', { class: 'quest-text' }, h('span', { text: q.text }), h('span', { class: 'muted small', text: `${fmtInt(q.value)} / ${fmtInt(q.target)}` })),
      h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': q.target, 'aria-valuenow': q.value, 'aria-label': q.text }, bar),
      claim);
  }));
  const note = $('#quest-note');
  if (p.signedIn) note.textContent = 'Progress comes from your submitted runs today.';
  else replace(note, 'Playing as a guest: progress is saved on this device. ', h('button', { class: 'linkish', type: 'button', text: 'Sign in to keep it everywhere', onclick: () => openProfile(p) }), '.');
}

async function renderTicker(p) {
  const ticker = $('#ticker');
  const track = $('#ticker-track');
  if (!ticker || !p.leaderboards) return;
  const r = await p.trending();
  if (!r.ok) return;
  if (!r.data.entries.length) {
    replace(track, h('li', { text: 'No scores yet today. Set the first one!' }));
    ticker.classList.add('static');
    ticker.hidden = false;
    return;
  }
  const items = r.data.entries.map((e) => h('li', {}, h('a', { href: `/games/${e.game}/`, text: e.title }), ` #${e.rank} `, h('strong', { text: e.name }), ` ${fmtInt(e.score)}`));
  // Two copies make the CSS marquee loop seamlessly; the copy is hidden from assistive tech.
  const copy = items.map((li) => { const c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); for (const a of c.querySelectorAll('a')) a.tabIndex = -1; return c; });
  replace(track, items, copy);
  ticker.hidden = false;
}

const platform = await bootShell();
renderFeatured(platform);
renderQuests(platform);
renderTicker(platform);
wireFilters();
platform.subscribe(renderQuests);
