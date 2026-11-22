import { expect } from '@playwright/test';

/** Collects console errors, page errors and CSP violations; tests assert the list stays empty. */
export function guardConsole(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

export const todaySeed = () => `DAILY-${new Date().toISOString().slice(0, 10)}`;

/** Unique per test run: e2e projects share one in-memory database. */
export const uniqueName = () => `E2E_${Math.random().toString(36).slice(2, 8)}`;

/** The hosted cartridge frame for a game, once its debug hooks exist (theater adds ?debug=1 to the frame). */
export async function playFrame(page, slug) {
  const re = new RegExp(`/games/${slug}/play/`);
  const ready = async () => {
    const f = page.frame({ url: re });
    if (!f) return false;
    return f.evaluate(() => Boolean((window.PulseBreach && window.PulseBreach.debug) || (window.NeonDrift && window.NeonDrift.debug))).catch(() => false);
  };
  await expect.poll(ready, { timeout: 15_000 }).toBe(true);
  return page.frame({ url: re });
}

/** Creates an account through the profile dialog (no email; the server returns an Arcade Key once). */
export async function register(page, name = uniqueName()) {
  await page.locator('#profile-btn').click();
  await page.getByLabel('Username').fill(name);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.arcade-key')).toHaveText(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  await page.getByLabel(/I saved my Arcade Key/).check();
  await page.getByRole('button', { name: "I've saved my key" }).click();
  await expect(page.locator('#profile-btn')).toHaveText(name);
  return name;
}

/** Plays a short Pulse Breach run inside the theater and declines the revive. */
export async function quickPulseRun(page, frame, { practice = false } = {}) {
  if (practice) await frame.getByRole('button', { name: 'Practice' }).click();
  await frame.getByRole('button', { name: 'START RUN' }).click();
  await page.waitForTimeout(1200);
  await frame.evaluate(() => window.PulseBreach.debug.forceBreach());
  await frame.getByRole('button', { name: 'No thanks' }).click();
  await expect(frame.locator('#scr-over')).toBeVisible();
}
