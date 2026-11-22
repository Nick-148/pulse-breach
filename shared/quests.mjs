// Cross-game daily quests: chosen deterministically from the UTC day, so every player and the server agree
// without storing anything. Progress is computed from that day's runs.
import { deepFreeze, fnv1a, fmtInt } from './util.mjs';

export const QUEST_POOL = deepFreeze([
  { id: 'pb-score', game: 'pulse-breach', kind: 'score', target: 5000, reward: 60 },
  { id: 'pb-survive', game: 'pulse-breach', kind: 'survive', target: 40, reward: 60 },
  { id: 'pb-overdrive', game: 'pulse-breach', kind: 'survive', target: 60, reward: 90 },
  { id: 'nd-survive', game: 'neon-drift', kind: 'survive', target: 45, reward: 60 },
  { id: 'nd-score', game: 'neon-drift', kind: 'score', target: 3000, reward: 60 },
  { id: 'nd-long', game: 'neon-drift', kind: 'survive', target: 75, reward: 90 },
  { id: 'runs-3', game: null, kind: 'runs', target: 3, reward: 40 },
  { id: 'runs-6', game: null, kind: 'runs', target: 6, reward: 60 },
  { id: 'two-games', game: null, kind: 'games', target: 2, reward: 80 },
  { id: 'featured', game: null, kind: 'featured', target: 2, reward: 50 },
]);

export const questById = (id) => QUEST_POOL.find((q) => q.id === id) || null;

export function questText(q, titles = {}) {
  const name = q.game ? titles[q.game] || q.game : '';
  switch (q.kind) {
    case 'score': return `Score ${fmtInt(q.target)}+ in ${name}`;
    case 'survive': return `Survive ${q.target}s in ${name}`;
    case 'runs': return `Finish ${q.target} runs in any game`;
    case 'games': return `Play ${q.target} different games today`;
    case 'featured': return `Finish ${q.target} runs of today's featured game`;
    default: return q.id;
  }
}

/** One quest per live game plus one cross-game quest, picked from the pool by hashing the day. */
export function dailyQuests(day, liveSlugs) {
  const picks = [];
  for (const slug of liveSlugs) {
    const options = QUEST_POOL.filter((q) => q.game === slug);
    if (options.length) picks.push(options[fnv1a(`${day}:${slug}`) % options.length]);
  }
  const cross = QUEST_POOL.filter((q) => q.game === null);
  picks.push(cross[fnv1a(`${day}:cross`) % cross.length]);
  return picks;
}

/** runs: that day's runs [{game, score, survivalMs}] → {value, target, done}. */
export function questProgress(q, runs, featuredSlug) {
  let value = 0;
  const mine = q.game ? runs.filter((r) => r.game === q.game) : runs;
  switch (q.kind) {
    case 'score': value = mine.reduce((m, r) => Math.max(m, r.score), 0); break;
    case 'survive': value = Math.floor(mine.reduce((m, r) => Math.max(m, r.survivalMs), 0) / 1000); break;
    case 'runs': value = mine.length; break;
    case 'games': value = new Set(runs.map((r) => r.game)).size; break;
    case 'featured': value = runs.filter((r) => r.game === featuredSlug).length; break;
    default: break;
  }
  return { value: Math.min(value, q.target), target: q.target, done: value >= q.target };
}
