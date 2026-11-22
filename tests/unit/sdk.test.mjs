import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHostBridge } from '../../portal/assets/js/bridge-host.mjs';

const SDK_SOURCE = readFileSync(new URL('../../sdk/arcade-sdk.js', import.meta.url), 'utf8');
const ORIGIN = 'https://arcade.test';
// Objects created inside the VM have another realm's prototypes; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

/** Minimal windows with browser postMessage semantics: async delivery, event.origin = sender origin, event.source = sender. */
function fakeWindow(origin) {
  const listeners = new Set();
  return {
    location: { origin },
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => listeners.delete(fn),
    receive(data, from) {
      setTimeout(() => {
        for (const fn of listeners) fn({ data: structuredClone(data), origin: from.location.origin, source: from });
      }, 0);
    },
  };
}

function setup({ framed = true, crossOrigin = false, fastTimers = false } = {}) {
  const parent = fakeWindow(ORIGIN);
  const frame = fakeWindow(ORIGIN);
  parent.postMessage = (data, target) => { if (target === ORIGIN) parent.receive(data, frame); };
  frame.postMessage = (data, target) => { if (target === ORIGIN) frame.receive(data, parent); };
  frame.parent = framed ? parent : frame;
  if (crossOrigin) Object.defineProperty(parent, 'location', { get() { throw new Error('SecurityError'); } });
  const st = fastTimers ? (fn, ms) => setTimeout(fn, Math.min(ms, 15)) : setTimeout;
  vm.runInContext(SDK_SOURCE, vm.createContext({ window: frame, URL, setTimeout: st, clearTimeout, console }));
  return { parent, frame, sdk: frame.ArcadeSDK };
}

test('the SDK only exists when framed by a same-origin host', () => {
  assert.equal(setup({ framed: false }).sdk, undefined, 'opened directly → standalone game');
  assert.equal(setup({ crossOrigin: true }).sdk, undefined, 'framed by another site → standalone game');
  const { sdk, frame } = setup();
  assert.equal(typeof sdk.init, 'function');
  assert.ok(Object.isFrozen(sdk) && Object.isFrozen(sdk.wallet));
  assert.throws(() => { 'use strict'; frame.ArcadeSDK = null; });
});

test('requests round-trip to host handlers with params', async () => {
  const { parent, frame, sdk } = setup();
  const seen = [];
  createHostBridge({
    frame: { contentWindow: frame },
    origin: ORIGIN,
    win: parent,
    handlers: {
      init: (p) => { seen.push(['init', p]); return { game: p.game, player: { signedIn: true, name: 'Ace', vip: false } }; },
      submitScore: (p) => { seen.push(['submit', p]); return { accepted: true, rank: 3 }; },
      'ads.showRewarded': async (p) => ({ granted: p.placement === 'revive', reason: 'viewed' }),
    },
  });
  const init = await sdk.init('pulse-breach');
  assert.equal(init.player.name, 'Ace');
  const res = await sdk.submitScore({ score: 1200, survivalTime: 31.5, seed: 'DAILY-2026-11-21', ghostData: [1, 2] });
  assert.deepEqual(res, { accepted: true, rank: 3 });
  assert.deepEqual(seen[1][1].ghostData, [1, 2]);
  assert.deepEqual(await sdk.ads.showRewarded('revive'), { granted: true, reason: 'viewed' });
  assert.equal(
    sdk.share.challengeUrl({ seed: 'daily-2026-11-21', score: 1200.9, ghost: 'c'.repeat(32) }),
    `${ORIGIN}/games/pulse-breach/?seed=DAILY-2026-11-21&beat=1200&ghost=${'c'.repeat(32)}`,
  );
  assert.equal(sdk.share.challengeUrl({ seed: '<script>', score: 5 }), `${ORIGIN}/games/pulse-breach/`, 'bad seed dropped');
});

test('unknown methods and throwing handlers resolve the documented fallback (never reject)', async () => {
  const { parent, frame, sdk } = setup();
  createHostBridge({
    frame: { contentWindow: frame }, origin: ORIGIN, win: parent,
    handlers: { 'wallet.grant': () => { throw new Error('boom'); } },
  });
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(plain(await sdk.wallet.grant(50, 'level')), { granted: 0, balance: null });
    assert.deepEqual(plain(await sdk.wallet.getBalance()), { credits: 0, gems: 0, vip: false, signedIn: false });
  } finally {
    console.warn = original;
  }
});

test('with no host answering, every call resolves its fallback after the timeout', async () => {
  const { sdk } = setup({ fastTimers: true });
  const init = await sdk.init('neon-drift');
  assert.equal(init.offline, true);
  assert.equal(init.player.signedIn, false);
  assert.deepEqual(plain(await sdk.submitScore({ score: 1 })), { accepted: false, reason: 'offline', rank: null, credits: 0, ghostId: null, signedIn: false });
  assert.deepEqual(plain(await sdk.ads.showRewarded('revive')), { granted: false, reason: 'timeout' });
  assert.equal(await sdk.ghost.get('x'), null);
});

test('messages from foreign windows are ignored on both sides', async () => {
  const { parent, frame, sdk } = setup({ fastTimers: true });
  const evil = fakeWindow('https://evil.example');
  let called = 0;
  createHostBridge({ frame: { contentWindow: frame }, origin: ORIGIN, win: parent, handlers: { init: () => { called++; return {}; } } });
  // A foreign window asks the host to run a handler: ignored (wrong source and origin).
  parent.receive({ ns: 'arcade-sdk', kind: 'req', id: 1, method: 'init', params: null }, evil);
  // Same origin but not the game frame (e.g. another tab's iframe): also ignored.
  const sibling = fakeWindow(ORIGIN);
  sibling.postMessage = () => {};
  parent.receive({ ns: 'arcade-sdk', kind: 'req', id: 2, method: 'init', params: null }, sibling);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(called, 0);

  // A forged response to the game from a foreign window can't resolve a pending call.
  const p = sdk.wallet.spend(800, 'trail-aurora');
  frame.receive({ ns: 'arcade-sdk', kind: 'res', id: 1, ok: true, result: { ok: true, reason: 'forged' } }, evil);
  const res = await p;
  assert.notEqual(res.reason, 'forged');
});

test('host events reach game listeners; a throwing listener does not stop the others', async () => {
  const { parent, frame, sdk } = setup();
  const bridge = createHostBridge({ frame: { contentWindow: frame }, origin: ORIGIN, win: parent, handlers: {} });
  const got = [];
  sdk.on('pause', () => { throw new Error('game bug'); });
  sdk.on('pause', (d) => got.push(d));
  const off = (d) => got.push(['off', d]);
  sdk.on('pause', off);
  sdk.off('pause', off);
  bridge.emit('pause', { reason: 'dialog' });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got, [{ reason: 'dialog' }]);
  bridge.destroy();
});
