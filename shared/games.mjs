// The game registry: single source of truth for the portal (cards, theater pages, SEO, sitemap),
// the build (which cartridges to host) and the API (seed rules, plausibility bounds, credits).
// Adding a game = a cartridge at games/<slug>/index.html + one entry here (AGENTS.md → Game Cartridge Spec).
import { deepFreeze } from './util.mjs';

export const CATEGORIES = deepFreeze([
  { id: 'reflex', label: 'Reflex & Dodge' },
  { id: 'timing', label: 'Timing & Rhythm' },
  { id: 'logic', label: 'Logic & Puzzle' },
  { id: 'upgrades', label: 'Arcade & Upgrades' },
]);

const SEED_PATTERN = /^[A-Z0-9-]{1,32}$/;

export const GAMES = deepFreeze([
  {
    slug: 'pulse-breach',
    title: 'Pulse Breach',
    subtitle: 'Daily Run',
    categories: ['reflex', 'upgrades'],
    accent: '#29f3ff',
    accent2: '#ff2bd6',
    blurb: 'Survive 60 seconds of seeded chaos. Same hazards for everyone today.',
    description:
      'Pulse Breach is a 60-second survival arcade game. Dodge debris, sweeping lasers, hunter drones and gravity ' +
      'wells across six escalating waves, then push into endless Overdrive. Every player gets the same seeded run ' +
      'each day, so your score is directly comparable with friends and the global leaderboard.',
    controls: [
      ['Move', 'WASD or arrow keys; on touch, drag anywhere (the ship follows your finger relatively)'],
      ['Phase dash', 'Space or Shift; on touch, double-tap or the DASH button. You are invulnerable while phasing'],
      ['Pause / mute', 'P or Esc to pause, M to mute'],
    ],
    strategy: [
      'Collect shards back to back to build your combo multiplier up to x10. It resets if you go 3 seconds without one.',
      'Grazing a hazard without touching it scores a bonus and refills your combo timer.',
      'Lasers flash for 1.2 seconds before firing: read the warning line, then move or dash through.',
      'Hunter drones chase you. Bait two into each other for a big bonus.',
      'Golden cores in wave 4 are worth 5 combo steps. Gravity wells pull you in, so approach from the side.',
    ],
    dailySeed: (day) => `DAILY-${day}`,
    seedPattern: SEED_PATTERN,
    world: { w: 1280, h: 720 },
    scoring: {
      maxSurvivalMs: 30 * 60_000,
      // Generous ceiling: a strong 60 s run is ~20–40k; this allows 155k (ADR 0010).
      maxScore: (seconds) => 5000 + 2500 * seconds,
      pointsPerCredit: 300,
      maxRunCredits: 60,
    },
  },
  {
    slug: 'neon-drift',
    title: 'Neon Drift',
    subtitle: 'Salvage Run',
    categories: ['timing', 'upgrades'],
    accent: '#7dff6b',
    accent2: '#ffb347',
    blurb: 'Tether, swing and slingshot through a seeded salvage field before your fuel runs dry.',
    description:
      'Neon Drift: Salvage Run is a one-button timing game. Hold to tether your skiff to the nearest beacon and ' +
      'swing around it; release to slingshot away. Grab salvage to refuel and build your haul multiplier, dodge ' +
      'drifting mines, and keep moving: fuel never stops draining. The daily field is the same for every player.',
    controls: [
      ['Tether', 'Hold Space, click, or touch anywhere to latch onto the nearest beacon in range'],
      ['Slingshot', 'Release to fly off along your swing. Speed builds while you stay tethered'],
      ['Pause / mute', 'P or Esc to pause, M to mute'],
    ],
    strategy: [
      'Release when your nose points at salvage: you travel in a straight line until you tether again.',
      'Long swings charge speed. Faster hauls score more, but walls arrive sooner.',
      'Grab salvage in quick succession to raise the haul multiplier; each crate also refuels you.',
      'Beacons relocate every 10 seconds. Watch for the fading ring and plan your next anchor.',
      'Skimming past a mine without touching it scores a near-miss bonus.',
    ],
    dailySeed: (day) => `DAILY-${day}`,
    seedPattern: SEED_PATTERN,
    world: { w: 1280, h: 720 },
    scoring: {
      maxSurvivalMs: 30 * 60_000,
      maxScore: (seconds) => 4000 + 2000 * seconds,
      pointsPerCredit: 250,
      maxRunCredits: 60,
    },
  },
]);

export const gameBySlug = (slug) => GAMES.find((g) => g.slug === slug) || null;
export const SLUG_RE = /^[a-z0-9-]{1,40}$/;
