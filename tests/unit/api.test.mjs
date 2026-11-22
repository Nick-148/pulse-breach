import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApi, ORIGIN } from '../helpers/api.mjs';
import { hmacHex, signToken } from '../../server/crypto.mjs';
import { handleApi } from '../../server/router.mjs';
import { GAMES } from '../../shared/games.mjs';
import { featuredGame } from '../../shared/seeds.mjs';
import { dailyQuests } from '../../shared/quests.mjs';

let api;
beforeEach(() => { api = makeApi(); });
afterEach(() => api.restore());

const DAILY = 'DAILY-2026-11-21';
const FEATURED = featuredGame('2026-11-21', GAMES).slug;
const OTHER = GAMES.find((g) => g.slug !== FEATURED).slug;

test('register issues a one-time Arcade Key and a session; usernames are unique case-insensitively', async () => {
  const a = new api.Client();
  const reg = await a.register('NeonFox');
  assert.match(reg.key, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  assert.equal(reg.player.username, 'NeonFox');
  assert.match(reg.player.friendCode, /^[A-Z2-9]{8}$/);
  const me = await a.get('/api/me');
  assert.equal(me.body.player.username, 'NeonFox');
  assert.deepEqual(me.body.wallet, { credits: 0, gems: 0 });

  const dupe = await new api.Client().post('/api/auth/register', { username: 'neonfox' });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.error, 'username-taken');
  for (const bad of ['ab', 'has space', '<script>', 'admin', '12345']) {
    const r = await new api.Client().post('/api/auth/register', { username: bad });
    assert.equal(r.status, 400, bad);
  }
  const row = await api.DB.prepare('SELECT key_hash FROM players').first();
  assert.notEqual(row.key_hash, reg.key, 'only the hash is stored');
});

test('login accepts the key in any case/spacing, rejects wrong keys, and rate-limits guessing', async () => {
  const a = new api.Client();
  const { key } = await a.register('Pilot_1');
  const b = new api.Client();
  const ok = await b.post('/api/auth/login', { username: 'pilot_1', key: key.toLowerCase().replace(/-/g, ' ') });
  assert.equal(ok.status, 200);
  assert.equal((await b.get('/api/me')).body.player.username, 'Pilot_1');

  const attacker = new api.Client();
  const wrong = await attacker.post('/api/auth/login', { username: 'Pilot_1', key: 'AAAAA-AAAAA-AAAAA-AAAAA' });
  assert.equal(wrong.status, 401);
  const unknown = await attacker.post('/api/auth/login', { username: 'nobody_here', key });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, wrong.body.error, 'same error for unknown user and wrong key');
  let last;
  for (let i = 0; i < 12; i++) last = await new api.Client().post('/api/auth/login', { username: 'Pilot_1', key: 'AAAAA-AAAAA-AAAAA-AAAAA' });
  assert.equal(last.status, 429);
});

test('logout clears the session server-side', async () => {
  const a = new api.Client();
  await a.register('Logger');
  const cookie = [...a.jar][0];
  await a.post('/api/auth/logout');
  assert.equal((await a.get('/api/me')).body.player, null);
  const replay = new api.Client();
  replay.jar.set(cookie[0], cookie[1]);
  assert.equal((await replay.get('/api/me')).body.player, null, 'old cookie is dead');
});

test('state-changing requests require same Origin and JSON (CSRF)', async () => {
  const a = new api.Client();
  assert.equal((await a.req('POST', '/api/auth/register', { username: 'Csrf' }, { Origin: null })).status, 403);
  assert.equal((await a.req('POST', '/api/auth/register', { username: 'Csrf' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await a.req('POST', '/api/auth/register', 'username=Csrf', { 'Content-Type': 'text/plain' })).status, 415);
});

test('a valid daily run is accepted, ranked, credited and ghosted; replays and tampering are rejected', async () => {
  const a = new api.Client();
  await a.register('Runner');
  const ghost = Array.from({ length: 200 }, (_, i) => (i % 2 ? 360 : 640));
  const r = await a.playRun({ seed: DAILY, score: 12000, survivalMs: 30_000, ghost, meta: { mode: 'daily', revived: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.isDaily, true);
  assert.equal(r.body.daily.rank, 1);
  assert.ok(r.body.credits > 0);
  assert.equal(r.body.balance.credits, r.body.credits);
  assert.equal(r.body.ghostId, r.body.runId);

  const g = await new api.Client().get(`/api/ghosts/${r.body.ghostId}`);
  assert.equal(g.status, 200);
  assert.equal(g.body.frames.length, 200);
  assert.equal(g.body.seed, DAILY);

  // Token replay
  const t = await a.post('/api/runs', { game: 'pulse-breach', seed: DAILY });
  api.advance(20_000);
  assert.equal((await a.post('/api/scores', { token: t.body.token, score: 100, survivalMs: 10_000 })).status, 200);
  assert.equal((await a.post('/api/scores', { token: t.body.token, score: 100, survivalMs: 10_000 })).status, 409);

  // Tampered payload (score bump is in the body, but a forged token is caught by the signature)
  const t2 = await a.post('/api/runs', { game: 'pulse-breach', seed: DAILY });
  const [body, sig] = t2.body.token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ v: 1, r: 'f'.repeat(32), g: 'pulse-breach', s: DAILY, t: 0 })).toString('base64url')}.${sig}`;
  api.advance(5000);
  assert.equal((await a.post('/api/scores', { token: forged, score: 10, survivalMs: 1000 })).status, 400);
  assert.ok(body);
});

test('implausible runs are rejected: faster than wall clock, score above the bound, bad ghost', async () => {
  const a = new api.Client();
  await a.register('Cheater');
  const tooFast = await a.playRun({ seed: DAILY, score: 100, survivalMs: 60_000, advanceMs: 10_000 });
  assert.equal(tooFast.status, 422);
  assert.equal(tooFast.body.error, 'implausible-survival');
  const tooHigh = await a.playRun({ seed: DAILY, score: 5_000_000, survivalMs: 30_000 });
  assert.equal(tooHigh.body.error, 'implausible-score');
  const badGhost = await a.playRun({ seed: DAILY, score: 100, survivalMs: 5000, ghost: [1.5, 1] });
  assert.equal(badGhost.status, 400);
  const offBoard = await a.playRun({ seed: DAILY, score: 100, survivalMs: 5000, ghost: [5000, 100] });
  assert.equal(offBoard.body.error, 'bad-ghost');
  const badSeed = await a.post('/api/runs', { game: 'pulse-breach', seed: '<x>' });
  assert.equal(badSeed.status, 400);
  const badGame = await a.post('/api/runs', { game: 'nope', seed: DAILY });
  assert.equal(badGame.status, 404);
});

test('guests can start runs but must sign in to submit; the token can be claimed later', async () => {
  const guest = new api.Client();
  const t = await guest.post('/api/runs', { game: 'pulse-breach', seed: DAILY });
  assert.equal(t.status, 200);
  api.advance(25_000);
  const anon = await guest.post('/api/scores', { token: t.body.token, score: 3000, survivalMs: 20_000 });
  assert.equal(anon.status, 401);
  await guest.register('LateClaim');
  api.advance(60_000);
  const claimed = await guest.post('/api/scores', { token: t.body.token, score: 3000, survivalMs: 20_000 });
  assert.equal(claimed.status, 200);
  api.advance(25 * 3600_000);
  const t2 = await guest.post('/api/runs', { game: 'pulse-breach', seed: DAILY });
  api.advance(25 * 3600_000);
  assert.equal((await guest.post('/api/scores', { token: t2.body.token, score: 1, survivalMs: 1000 })).body.error, 'token-expired');
});

test('leaderboards: daily and all-time only count daily seeds; best per player; friends board', async () => {
  const a = new api.Client();
  const b = new api.Client();
  const c = new api.Client();
  await a.register('Alpha');
  const { player: pb } = await b.register('Bravo');
  await c.register('Charlie');
  await a.playRun({ seed: DAILY, score: 5000, survivalMs: 20_000 });
  await a.playRun({ seed: DAILY, score: 4000, survivalMs: 20_000 });
  await b.playRun({ seed: DAILY, score: 9000, survivalMs: 30_000 });
  await c.playRun({ seed: DAILY, score: 7000, survivalMs: 25_000 });
  await c.playRun({ seed: 'EASY-SEED', score: 99_000, survivalMs: 40_000 });

  const daily = await a.get('/api/boards/pulse-breach?board=daily');
  assert.deepEqual(daily.body.entries.map((e) => [e.name, e.score]), [['Bravo', 9000], ['Charlie', 7000], ['Alpha', 5000]]);
  assert.deepEqual(daily.body.me, { rank: 3, score: 5000, survivalMs: 20_000 });
  const all = await new api.Client().get('/api/boards/pulse-breach?board=alltime');
  assert.equal(all.body.entries[0].score, 9000, 'custom seeds never reach the all-time board');
  assert.equal(all.body.me, null);

  assert.equal((await new api.Client().get('/api/boards/pulse-breach?board=friends')).status, 401);
  assert.equal((await a.post('/api/friends', { code: pb.friendCode })).status, 200);
  assert.equal((await a.post('/api/friends', { code: 'ZZZZZZZZ' })).status, 404);
  const friends = await a.get('/api/boards/pulse-breach?board=friends');
  assert.deepEqual(friends.body.entries.map((e) => e.name), ['Bravo', 'Alpha']);
  assert.equal((await a.get('/api/friends')).body.friends[0].name, 'Bravo');
  await a.del(`/api/friends/${pb.friendCode}`);
  assert.equal((await a.get('/api/friends')).body.friends.length, 0);

  assert.equal((await a.get('/api/boards/pulse-breach?day=2020-01-01')).status, 400);
  assert.equal((await a.get('/api/boards/pulse-breach?board=weekly')).status, 400);
  const trending = await a.get('/api/trending');
  assert.equal(trending.body.entries.filter((e) => e.game === 'pulse-breach').length, 3);
});

test('only the best run per seed keeps its ghost', async () => {
  const a = new api.Client();
  await a.register('Ghosty');
  const ghost = [100, 100, 110, 110];
  const first = await a.playRun({ seed: DAILY, score: 2000, survivalMs: 10_000, ghost });
  const worse = await a.playRun({ seed: DAILY, score: 1000, survivalMs: 10_000, ghost });
  assert.equal(worse.body.ghostId, null);
  const better = await a.playRun({ seed: DAILY, score: 3000, survivalMs: 10_000, ghost });
  assert.ok(better.body.ghostId);
  assert.equal((await a.get(`/api/ghosts/${first.body.ghostId}`)).status, 404, 'superseded ghost is dropped');
  assert.equal((await a.get(`/api/ghosts/${better.body.ghostId}`)).status, 200);
});

test('run credits are capped per day; the featured game doubles them', async () => {
  const a = new api.Client();
  await a.register('Grinder');
  const big = (game) => a.playRun({ game, seed: DAILY, score: 60 * 300 * 2, survivalMs: 60_000 });
  const r1 = await big(OTHER);
  assert.equal(r1.body.credits, 60);
  const f1 = await big(FEATURED);
  assert.equal(f1.body.credits, 120, 'featured game pays 2x');
  let total = 60;
  for (let i = 0; i < 8; i++) total += (await big(OTHER)).body.credits;
  assert.equal(total, 400, 'normal runs stop at the 400/day cap, unaffected by featured credits');
  let featured = 120;
  for (let i = 0; i < 8; i++) featured += (await big(FEATURED)).body.credits;
  assert.equal(featured, 800, 'featured runs have their own doubled cap');
});

test('wallet grants obey rules and caps; spending uses catalog prices only', async () => {
  const a = new api.Client();
  await a.register('Spender');
  let granted = 0;
  for (let i = 0; i < 10; i++) granted += (await a.post('/api/wallet/grant', { reason: 'rewarded_ad', amount: 9999 })).body.granted;
  assert.equal(granted, 200, '8 ads x 25 credits');
  let bonus = 0;
  for (let i = 0; i < 4; i++) bonus += (await a.post('/api/wallet/grant', { reason: 'level', amount: 50, game: 'neon-drift' })).body.granted;
  assert.equal(bonus, 100);
  assert.equal((await a.post('/api/wallet/grant', { reason: 'level', amount: 50 })).status, 400, 'needs a known game');
  assert.equal((await a.post('/api/wallet/grant', { reason: 'level', amount: 50, game: 'evil' })).status, 400);

  const poor = await a.post('/api/wallet/spend', { itemId: 'trail-aurora' });
  assert.equal(poor.status, 409);
  assert.equal(poor.body.error, 'insufficient-funds');
  for (let i = 0; i < 10; i++) await a.playRun({ game: FEATURED, seed: DAILY, score: 40_000, survivalMs: 60_000 });
  assert.equal((await a.post('/api/wallet/spend', { itemId: 'trail-aurora', cost: 1 })).body.error, 'price-changed');
  const buy = await a.post('/api/wallet/spend', { itemId: 'trail-aurora', cost: 800 });
  assert.equal(buy.status, 200, JSON.stringify(buy.body));
  assert.equal(buy.body.wallet.credits, 300 + 800 - 800);
  assert.equal((await a.post('/api/wallet/spend', { itemId: 'trail-aurora' })).body.error, 'already-owned');
  assert.equal((await a.post('/api/wallet/spend', { itemId: 'trail-founder' })).status, 404, 'bundle-only items are not for sale');
  assert.equal((await a.post('/api/me/equip', { itemId: 'trail-void' })).status, 403);
  assert.equal((await a.post('/api/me/equip', { itemId: 'trail-aurora' })).status, 200);
  const me = await a.get('/api/me');
  assert.deepEqual(me.body.inventory, ['trail-aurora']);
  assert.equal(me.body.trail.id, 'trail-aurora');
  const ledger = await api.DB.prepare('SELECT COUNT(*) AS n FROM ledger WHERE delta < 0').first();
  assert.equal(ledger.n, 1);
});

test('daily check-in streak: once per day, grows on consecutive days, resets after a gap', async () => {
  const a = new api.Client();
  await a.register('Daily');
  const r1 = await a.post('/api/me/checkin');
  assert.deepEqual([r1.body.reward, r1.body.streak], [10, 1]);
  assert.equal((await a.post('/api/me/checkin')).body.reward, 0);
  api.advance(86_400_000);
  const r2 = await a.post('/api/me/checkin');
  assert.deepEqual([r2.body.reward, r2.body.streak], [15, 2]);
  api.advance(3 * 86_400_000);
  assert.equal((await a.get('/api/me')).body.player.streak, 0, 'broken streak shows 0');
  const r3 = await a.post('/api/me/checkin');
  assert.deepEqual([r3.body.reward, r3.body.streak], [10, 1]);
  assert.equal(r3.body.wallet.credits, 35);
});

test('guest merge is capped, once per guest id, and validated', async () => {
  const a = new api.Client();
  await a.register('Merger');
  const id = `g_${'a'.repeat(32)}`;
  const m1 = await a.post('/api/me/merge', { guest: { id, credits: 999_999 } });
  assert.equal(m1.body.merged, 1000);
  assert.equal((await a.post('/api/me/merge', { guest: { id, credits: 500 } })).body.merged, 0);
  assert.equal((await a.post('/api/me/merge', { guest: { id: 'x', credits: 5 } })).status, 400);
  assert.equal((await new api.Client().post('/api/me/merge', { guest: { id, credits: 5 } })).status, 401);
});

test('quests: progress from validated runs, claim once', async () => {
  const a = new api.Client();
  await a.register('Quester');
  const quests = dailyQuests('2026-11-21', GAMES.map((g) => g.slug));
  const cross = quests[quests.length - 1];
  assert.equal((await a.post(`/api/quests/${cross.id}/claim`)).body.error, 'quest-not-complete');
  for (const game of [FEATURED, OTHER, FEATURED, OTHER, FEATURED, OTHER]) {
    await a.playRun({ game, seed: DAILY, score: 100, survivalMs: 5000 });
  }
  const me = await a.get('/api/me');
  const q = me.body.quests.find((x) => x.id === cross.id);
  assert.equal(q.done, true);
  const claim = await a.post(`/api/quests/${cross.id}/claim`);
  assert.equal(claim.body.granted, cross.reward);
  assert.equal((await a.post(`/api/quests/${cross.id}/claim`)).body.error, 'quest-already-claimed');
  assert.equal((await a.post('/api/quests/not-today/claim')).status, 404);
});

test('cloud saves: per game, size-capped, unknown games rejected', async () => {
  const a = new api.Client();
  await a.register('Saver');
  assert.equal((await a.get('/api/saves/pulse-breach')).body.data, null);
  await a.put('/api/saves/pulse-breach', { data: { scrap: 50, upgrades: { magnet: 1 } } });
  assert.deepEqual((await a.get('/api/saves/pulse-breach')).body.data, { scrap: 50, upgrades: { magnet: 1 } });
  assert.equal((await a.put('/api/saves/pulse-breach', { data: { blob: 'x'.repeat(40_000) } })).status, 413);
  assert.equal((await a.put('/api/saves/unknown', { data: {} })).status, 404);
  assert.equal((await new api.Client().get('/api/saves/pulse-breach')).status, 401);
});

test('simulated store fulfils products; disabled store refuses checkout', async () => {
  const a = new api.Client();
  await a.register('Buyer');
  const r = await a.post('/api/store/checkout', { sku: 'founder_bundle' });
  assert.equal(r.body.fulfilled, true);
  const me = await a.get('/api/me');
  assert.deepEqual(me.body.inventory.sort(), ['badge-founder', 'trail-founder']);
  assert.equal(me.body.wallet.gems, 200);
  await a.post('/api/store/checkout', { sku: 'vip_30d' });
  assert.equal((await a.get('/api/me')).body.player.vip, true);
  assert.equal((await a.post('/api/store/checkout', { sku: 'free_money' })).status, 404);

  const off = makeApi({ PAYMENTS_SIMULATED: '0' });
  const b = new off.Client();
  await b.register('NoStore');
  assert.equal((await b.post('/api/store/checkout', { sku: 'vip_30d' })).status, 503);
  assert.equal((await b.get('/api/store/catalog')).body.payments.enabled, false);
});

test('stripe: checkout creates a pending order; only a correctly signed webhook fulfils it, once', async () => {
  const secret = 'whsec_test_secret';
  const stripe = makeApi({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: secret, PAYMENTS_SIMULATED: '0' });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }), { status: 200 });
  };
  try {
    const a = new stripe.Client();
    const { player } = await a.register('Payer');
    const r = await a.post('/api/store/checkout', { sku: 'gems_120' });
    assert.equal(r.body.url, 'https://checkout.stripe.com/c/pay/cs_test_123');
    assert.match(String(calls[0].init.body), /unit_amount%5D=99/);
    assert.match(calls[0].init.headers.Authorization, /^Bearer sk_test_x$/);
    const order = await stripe.DB.prepare('SELECT id, status FROM purchases').first();
    assert.equal(order.status, 'pending');

    const event = JSON.stringify({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', payment_status: 'paid', client_reference_id: player.id, metadata: { sku: 'gems_120', player: player.id, order: order.id } } },
    });
    const send = async (payload, sigHeader) => handleApi(new Request(`${ORIGIN}/api/store/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sigHeader }, body: payload,
    }), stripe.env);
    const t = Math.floor(stripe.now() / 1000);
    const good = `t=${t},v1=${await hmacHex(secret, `${t}.${event}`)}`;
    assert.equal((await send(event, `t=${t},v1=${'0'.repeat(64)}`)).status, 400, 'bad signature');
    assert.equal((await send(event.replace('gems_120', 'gems_700'), good)).status, 400, 'payload tampering breaks the signature');
    const old = Math.floor(stripe.now() / 1000) - 3600;
    assert.equal((await send(event, `t=${old},v1=${await hmacHex(secret, `${old}.${event}`)}`)).status, 400, 'stale timestamp');
    assert.equal((await send(event, good)).status, 200);
    assert.equal((await send(event, good)).status, 200, 'retries are acknowledged');
    assert.equal((await a.get('/api/me')).body.wallet.gems, 120, 'granted exactly once');
  } finally {
    globalThis.fetch = realFetch;
    stripe.restore();
  }
});

test('account deletion requires typing the username and removes everything', async () => {
  const a = new api.Client();
  const { key } = await a.register('Leaver');
  await a.playRun({ seed: DAILY, score: 1000, survivalMs: 5000 });
  assert.equal((await a.del('/api/me', { confirm: 'nope' })).status, 400);
  assert.equal((await a.del('/api/me', { confirm: 'leaver' })).status, 200);
  assert.equal((await a.get('/api/me')).body.player, null);
  assert.equal((await new api.Client().post('/api/auth/login', { username: 'Leaver', key })).status, 401);
  for (const table of ['players', 'runs', 'bests', 'ledger', 'sessions']) {
    assert.equal((await api.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, table);
  }
});

test('degrades cleanly: no DB → 503 except config; no RUN_SECRET → leaderboards offline; routing errors', async () => {
  const req = (path, env, method = 'GET') => handleApi(new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }), env);
  assert.equal((await req('/api/me', {})).status, 503);
  const cfg = await (await req('/api/config', {})).json();
  assert.equal(cfg.leaderboards, false);
  assert.equal(cfg.quests.length, 3);
  assert.ok(cfg.auth.find((p) => p.id === 'username').enabled);
  assert.equal(cfg.auth.find((p) => p.id === 'google').enabled, false);
  assert.equal((await req('/api/runs', { DB: api.DB }, 'POST')).status, 503);
  assert.equal((await req('/api/nope', {})).status, 404);
  assert.equal((await req('/api/me', { DB: api.DB }, 'PUT')).status, 405);
  assert.equal((await req('/api/auth/google/start', {})).status, 501);
});

test('run tokens are bound to game and seed', async () => {
  const a = new api.Client();
  await a.register('Binder');
  const forged = await signToken({ v: 1, r: 'a'.repeat(32), g: 'pulse-breach', s: DAILY, t: api.now() }, 'wrong-secret'.padEnd(40, 'y'));
  api.advance(5000);
  assert.equal((await a.post('/api/scores', { token: forged, score: 10, survivalMs: 1000 })).body.error, 'bad-token');
});
