// Loads the game's inline <script> into an isolated VM context with no DOM.
// The script only boots the App when `document` exists, so this exposes the
// pure modules (PRNG, economy, engine…) via a global (PulseBreach, NeonDrift, …).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadGame(slug = 'pulse-breach', globalName = 'PulseBreach') {
  const html = readFileSync(new URL(`../../games/${slug}/index.html`, import.meta.url), 'utf8');
  const match = html.match(/<script id="game-script">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('game script not found');
  const context = vm.createContext({ console, URL, URLSearchParams, setTimeout, clearTimeout });
  vm.runInContext(match[1], context, { filename: `${slug}/index.html#game-script` });
  return context[globalName];
}

/** Steps an engine with a fixed frame time until it stops running or maxSeconds elapse. */
export function runIdle(engine, frameDt, maxSeconds = 300, input = { moveX: 0, moveY: 0 }) {
  const frames = Math.ceil(maxSeconds / frameDt);
  for (let i = 0; i < frames && engine.state === 'running'; i++) engine.update(frameDt, input);
  return engine;
}

/** In-memory Storage double (same surface as window.localStorage). */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}
