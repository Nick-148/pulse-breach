import { deepFreeze } from './util.mjs';

// The platform brand is provisional (PLAN.md B10): renaming it is a one-line change here.
export const SITE = deepFreeze({
  name: 'Seedfall Arcade',
  short: 'Seedfall',
  tagline: 'Same seed. Every player. Every day.',
  // Overridden at build time by the SITE_URL env var; used for canonical/OG/share URLs.
  url: 'https://seedfall-arcade.pages.dev',
  storagePrefix: 'arcade_v1_',
  sdkVersion: '1.0.0',
});
