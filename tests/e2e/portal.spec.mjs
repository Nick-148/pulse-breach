import { test, expect } from '@playwright/test';
import { guardConsole, playFrame, register, quickPulseRun, todaySeed } from './helpers.mjs';

test('home loads under the site CSP with guest check-in credits, quests and working filters', async ({ page }) => {
  const problems = guardConsole(page);
  const res = await page.goto('/');
  const csp = res.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  await expect(page.locator('#wallet-credits')).toHaveText('10');
  await expect(page.locator('#featured-title')).not.toHaveText('');
  await expect(page.locator('#quest-list li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Logic & Puzzle' }).click();
  await expect(page.locator('.game-card[data-categories]:visible')).toHaveCount(0);
  await expect(page.locator('.game-card.soon:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reflex & Dodge' }).click();
  await expect(page.locator('.game-card[data-categories]:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.game-card[data-categories]:visible')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('guest run in the theater: hosted SDK, signed run token, claim prompt and challenge link', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/games/pulse-breach/?debug=1');
  const f = await playFrame(page, 'pulse-breach');
  expect(await f.evaluate(() => window.PulseBreach.debug.hosted())).toBe(true);
  await expect(f.locator('#banner-wrap')).toBeHidden();
  await expect(f.locator('#btn-ad-mode')).toBeHidden();
  await quickPulseRun(page, f);
  await expect(page.locator('#challenge-card')).toBeVisible();
  const link = await page.locator('#challenge-card input').inputValue();
  expect(link).toContain(`/games/pulse-breach/?seed=${todaySeed()}`);
  await expect(page.locator('#board-me')).toContainText('Sign in to claim');
  await expect(f.locator('#over-note')).toContainText('Sign in on the arcade page');
  const guest = await page.evaluate(() => JSON.parse(localStorage.getItem('arcade_v1_guest')));
  expect(guest.pending).toHaveLength(1);
  expect(problems).toEqual([]);
});

test('creating an account claims the guest run, then a signed-in run produces a ghost challenge', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/games/pulse-breach/?debug=1');
  let f = await playFrame(page, 'pulse-breach');
  await quickPulseRun(page, f);
  const name = await register(page);
  await expect(page.locator('#board-list')).toContainText(name);
  const guest = await page.evaluate(() => JSON.parse(localStorage.getItem('arcade_v1_guest')));
  expect(guest.pending).toHaveLength(0);

  // A practice seed is new for this player, so the run is their best on it and keeps its ghost.
  await f.getByRole('button', { name: 'Menu' }).click();
  await quickPulseRun(page, f, { practice: true });
  await expect.poll(() => f.evaluate(() => window.PulseBreach.debug.ack() && window.PulseBreach.debug.ack().accepted)).toBe(true);
  const link = await page.locator('#challenge-card input').inputValue();
  expect(link).toMatch(/[?&]ghost=[a-f0-9]{32}/);

  await page.goto(`${link}&debug=1`);
  f = await playFrame(page, 'pulse-breach');
  await expect(page.locator('#target-banner')).toContainText('racing their ghost');
  await expect(f.locator('#challenge-banner')).toContainText(`racing ${name}'s ghost`);
  expect(problems).toEqual([]);
});

test('store: a signed-in player buys the founder bundle (simulated payments in dev)', async ({ page }) => {
  await page.goto('/store/');
  await expect(page.locator('#product-status')).toContainText('simulated');
  await register(page);
  await page.getByRole('button', { name: 'Buy $4.99' }).first().click();
  await expect(page.locator('#wallet-gems')).toHaveText('200');
  await page.locator('#profile-btn').click();
  await expect(page.getByRole('dialog')).toContainText('Founder Gold Trail');
});

test('daily quests can be claimed by a guest after finishing runs', async ({ page }) => {
  await page.goto('/');
  const before = Number(await page.locator('#wallet-credits').textContent());
  await page.evaluate(() => {
    // Simulate today's finished runs in guest storage (the theater writes these after each run).
    const key = 'arcade_v1_guest';
    const g = JSON.parse(localStorage.getItem(key));
    const runs = [];
    for (let i = 0; i < 6; i++) runs.push({ game: i % 2 ? 'pulse-breach' : 'neon-drift', score: 99999, survivalMs: 120000 });
    localStorage.setItem(key, JSON.stringify({ ...g, runs }));
  });
  await page.reload();
  const claim = page.locator('#quest-list button:not([disabled])').first();
  await claim.click();
  await expect.poll(async () => Number(await page.locator('#wallet-credits').textContent())).toBeGreaterThan(before);
});

test('hostile challenge params are dropped and never rendered', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/games/pulse-breach/?seed=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&beat=9&ghost=..%2F..%2Fapi');
  await expect(page.locator('#game-frame')).toHaveAttribute('src', /\/games\/pulse-breach\/play\//);
  await expect(page.locator('#target-banner')).toBeHidden();
  expect(await page.locator('#game-frame').getAttribute('src')).not.toContain('seed=');
  expect(await page.locator('main img').count()).toBe(0);
  expect(problems).toEqual([]);
});

test('unknown pages get the 404 page; the API refuses cross-site writes', async ({ page, request }) => {
  const res = await page.goto('/definitely-not-here');
  expect(res.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('Lost in the void');
  const api = await request.post('/api/auth/register', { data: { username: 'Csrf_Probe' }, headers: { Origin: 'https://evil.example' } });
  expect(api.status()).toBe(403);
  const health = await request.get('/api/health');
  expect(await health.json()).toEqual({ ok: true, db: true });
});

test('mobile portrait: the game frame gets most of the screen and nothing scrolls sideways', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'portrait layout only');
  await page.goto('/games/pulse-breach/');
  const box = await page.locator('.frame-wrap').boundingBox();
  const vp = page.viewportSize();
  expect(box.height).toBeGreaterThan(vp.height * 0.6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator('.ad-slot[data-size="320x50"]')).toBeVisible();
  await expect(page.locator('.ad-slot[data-size="728x90"]')).toBeHidden();
});
