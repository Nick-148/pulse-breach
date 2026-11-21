import { test, expect } from '@playwright/test';

/** Fails the test on any console error, page error, or CSP violation. */
function guardConsole(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

const todaySeed = () => `DAILY-${new Date().toISOString().slice(0, 10)}`;

test('loads under strict CSP with the daily seed and no errors', async ({ page }) => {
  const problems = guardConsole(page);
  const res = await page.goto('/');
  expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
  await expect(page.locator('#title-kicker')).toContainText(todaySeed());
  await expect(page.locator('#banner-ad-slot')).toBeVisible();
  await expect(page.locator('[data-mode="challenge"]')).toBeHidden();
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

test('page never scrolls and the game fits the viewport', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight - innerHeight,
    w: document.documentElement.scrollWidth - innerWidth,
  }));
  expect(overflow.h).toBeLessThanOrEqual(0);
  expect(overflow.w).toBeLessThanOrEqual(0);
});

test('full daily run: play → breach → decline revive → share copies a challenge link', async ({ page, context, browserName }, info) => {
  test.skip(info.project.name === 'mobile', 'clipboard permissions are desktop-only in this setup');
  const problems = guardConsole(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'START RUN' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowUp');
  expect(Number(await page.locator('#hud-time').textContent())).toBeGreaterThan(0.3);
  await page.evaluate(() => window.PulseBreach.debug.forceBreach());
  await expect(page.locator('#scr-revive')).toBeVisible();
  await page.getByRole('button', { name: 'No thanks' }).click();
  await expect(page.locator('#scr-over')).toBeVisible();
  await expect(page.locator('#over-timeline')).toHaveText(/^[🟩🟨🔥💀⬛]{6}$/u);
  await page.getByRole('button', { name: 'SHARE / COPY CHALLENGE' }).click();
  await expect(page.locator('#toast')).toHaveText('Copied!');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(`?seed=${todaySeed()}`);
  expect(clip).toContain('PULSE BREACH');
  expect(browserName).toBe('chromium');
  expect(problems).toEqual([]);
});

test('second-chance revive via simulated ad resumes the run with invulnerability', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'START RUN' }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.PulseBreach.debug.forceBreach());
  await page.getByRole('button', { name: /revive/i }).click();
  await expect(page.locator('#ad-modal')).toBeVisible();
  await expect(page.locator('#ad-modal-title')).toContainText('Rewarded Ad Playing');
  await expect(page.locator('#ad-modal')).toBeHidden({ timeout: 8000 });
  await expect.poll(() => page.evaluate(() => window.PulseBreach.debug.state())).toBe('playing');
});

test('friend challenge link shows the banner and uses that seed', async ({ page }) => {
  await page.goto('/?seed=abc123&beat=4200');
  await expect(page.locator('#challenge-banner')).toContainText("CHALLENGE MODE: Beat your friend's run!");
  await expect(page.locator('#challenge-banner')).toContainText('4,200');
  await expect(page.locator('#title-kicker')).toContainText('ABC123');
});

test('malicious seed is rejected and never rendered', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/?seed=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  await expect(page.locator('#challenge-banner')).toBeHidden();
  await expect(page.locator('#title-kicker')).toContainText(todaySeed());
  expect(await page.locator('img').count()).toBe(0);
  expect(problems).toEqual([]);
});

test('hangar: rewarded top-up grants scrap, which buys an upgrade that persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Hangar/ }).click();
  await expect(page.locator('#hangar-scrap')).toHaveText('0');
  await page.getByRole('button', { name: /\+100 scrap/ }).click();
  await expect(page.locator('#hangar-scrap')).toHaveText('100', { timeout: 8000 });
  await page.getByRole('button', { name: /Upgrade Magnet Radius/ }).click();
  await expect(page.locator('#hangar-scrap')).toHaveText('40');
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pulse_breach_v1_profile')));
  expect(stored.upgrades.magnet).toBe(1);
  expect(stored.scrap).toBe(40);
});

test('ad mode toggle switches to SDK hooks (stub) and persists', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-ad-mode').click();
  await expect(page.locator('#btn-ad-mode')).toHaveText('Ad Mode: SDK Hooks (stub)');
  await page.reload();
  await expect(page.locator('#btn-ad-mode')).toHaveText('Ad Mode: SDK Hooks (stub)');
  await page.getByRole('button', { name: /Hangar/ }).click();
  await page.getByRole('button', { name: /\+100 scrap/ }).click();
  await expect(page.locator('#ad-modal-kicker')).toContainText('adBreak() stub');
  await expect(page.locator('#hangar-scrap')).toHaveText('100', { timeout: 6000 });
});

test('mute toggle persists', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-mute').click();
  await expect(page.locator('#btn-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#btn-mute')).toHaveAttribute('aria-pressed', 'true');
});

test('touch devices get the on-screen dash button during a run', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch only');
  await page.goto('/');
  await page.getByRole('button', { name: 'START RUN' }).click();
  await expect(page.locator('#dash-btn')).toBeVisible();
  await page.locator('#dash-btn').dispatchEvent('pointerdown');
});

test('daily attempt # and streak update after a run ended from pause', async ({ page }) => {
  await page.goto('/');
  const stat = (label) => page.locator('#title-stats div').filter({ hasText: label }).locator('dd');
  await expect(stat('Attempt #')).toHaveText('1');
  await expect(stat('Streak')).toHaveText('0d');
  await page.getByRole('button', { name: 'START RUN' }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect(page.locator('#scr-pause')).toBeVisible();
  await page.getByRole('button', { name: 'End run' }).click();
  await expect(page.locator('#scr-over')).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(stat('Attempt #')).toHaveText('2');
  await expect(stat('Streak')).toHaveText('1d');
  const daily = await page.evaluate(() => JSON.parse(localStorage.getItem('pulse_breach_v1_daily')));
  expect(daily.attempts).toBe(1);
  expect(daily.streak).toBe(1);
  expect(daily.best).toBeGreaterThanOrEqual(0);
});
