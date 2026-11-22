import { test, expect } from '@playwright/test';
import { guardConsole, playFrame, todaySeed } from './helpers.mjs';

const PLAY = '/games/neon-drift/play/';

test('standalone: loads under strict CSP with the daily seed and no errors', async ({ page }) => {
  const problems = guardConsole(page);
  const res = await page.goto(PLAY);
  expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
  await expect(page.locator('#title-kicker')).toContainText(todaySeed());
  await expect(page.locator('[data-mode="challenge"]')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('standalone: holding tethers, releasing lets go, and a crash ends in a spoiler-free card', async ({ page, context }, info) => {
  const problems = guardConsole(page);
  await page.goto(`${PLAY}?debug=1`);
  await page.getByRole('button', { name: 'START RUN' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.NeonDrift.debug.tethered())).toBe(true);
  await page.keyboard.up('Space');
  await expect.poll(() => page.evaluate(() => window.NeonDrift.debug.tethered())).toBe(false);
  await page.evaluate(() => window.NeonDrift.debug.forceCrash());
  await page.getByRole('button', { name: 'No thanks' }).click();
  await expect(page.locator('#scr-over')).toBeVisible();
  await expect(page.locator('#over-timeline')).toHaveText(/^[🟩🟨🔥💀⬛]{6}$/u);
  if (info.project.name !== 'mobile') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'SHARE / COPY CHALLENGE' }).click();
    await expect(page.locator('#toast')).toHaveText('Copied!');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('NEON DRIFT');
    expect(clip).toContain(`?seed=${todaySeed()}`);
  }
  expect(problems).toEqual([]);
});

test('standalone: revive through the simulated rewarded ad resumes the run', async ({ page }) => {
  await page.goto(`${PLAY}?debug=1`);
  await page.getByRole('button', { name: 'START RUN' }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.NeonDrift.debug.forceCrash());
  await page.getByRole('button', { name: /revive/i }).click();
  await expect(page.locator('#ad-modal')).toBeVisible();
  await expect(page.locator('#ad-modal')).toBeHidden({ timeout: 8000 });
  await expect.poll(() => page.evaluate(() => window.NeonDrift.debug.state())).toBe('playing');
});

test('standalone: friend challenge link shows the target and mute persists', async ({ page }) => {
  await page.goto(`${PLAY}?seed=salvage1&beat=3200`);
  await expect(page.locator('#challenge-banner')).toContainText('TARGET TO BEAT: 3,200');
  await expect(page.locator('#title-kicker')).toContainText('SALVAGE1');
  await page.locator('#btn-mute').click();
  await page.reload();
  await expect(page.locator('#btn-mute')).toHaveAttribute('aria-pressed', 'true');
});

test('hosted: a run in the theater reports to the platform and offers a challenge link', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/games/neon-drift/?debug=1');
  const f = await playFrame(page, 'neon-drift');
  expect(await f.evaluate(() => window.NeonDrift.debug.hosted())).toBe(true);
  await f.getByRole('button', { name: 'START RUN' }).click();
  await page.waitForTimeout(800);
  await f.evaluate(() => window.NeonDrift.debug.forceCrash());
  await f.getByRole('button', { name: 'No thanks' }).click();
  await expect(f.locator('#scr-over')).toBeVisible();
  await expect(page.locator('#challenge-card')).toBeVisible();
  expect(await page.locator('#challenge-card input').inputValue()).toContain('/games/neon-drift/?seed=');
  expect(problems).toEqual([]);
});
