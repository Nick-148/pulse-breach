import { defineConfig, devices } from '@playwright/test';

// E2E runs against dist/ served with the real _headers (strict CSP), so any
// CSP violation or runtime error fails the suite before it reaches production.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/serve.mjs dist 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
