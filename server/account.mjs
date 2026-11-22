// Profile, wallet, quests, cloud saves and friends. All currency math is server-side (ADR 0010).
import { GAMES, gameBySlug, SLUG_RE } from '../shared/games.mjs';
import { ITEMS, itemById, ITEM_ID_RE } from '../shared/catalog.mjs';
import { GUEST_ID_RE, checkinReward, grantRule, nextStreak, planGuestMerge } from '../shared/economy.mjs';
import { dailyQuests, questById, questProgress } from '../shared/quests.mjs';
import { featuredGame } from '../shared/seeds.mjs';
import { isObj } from '../shared/util.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { all, balances, bookedAmount, cappedGrant, exec, first, grant, stmt } from './db.mjs';

const MAX_FRIENDS = 200;
const MAX_SAVE_BYTES = 32 * 1024;
const FRIEND_CODE_RE = /^[A-Z0-9]{8}$/;

const liveSlugs = () => GAMES.map((g) => g.slug);

async function todaysRuns(ctx, playerId) {
  const rows = await all(ctx.db, 'SELECT game, score, survival_ms FROM runs WHERE player_id = ? AND day = ?', playerId, ctx.day);
  return rows.map((r) => ({ game: r.game, score: Number(r.score), survivalMs: Number(r.survival_ms) }));
}

async function questsFor(ctx, playerId) {
  const runs = await todaysRuns(ctx, playerId);
  const featured = featuredGame(ctx.day, GAMES)?.slug;
  const claimedRows = await all(ctx.db, "SELECT ref FROM ledger WHERE player_id = ? AND reason = 'quest' AND day = ?", playerId, ctx.day);
  const claimed = new Set(claimedRows.map((r) => String(r.ref).split(':')[1]));
  return dailyQuests(ctx.day, liveSlugs()).map((q) => ({ ...q, ...questProgress(q, runs, featured), claimed: claimed.has(q.id) }));
}

/** GET /api/me */
export async function me(ctx) {
  const player = await ctx.player();
  if (!player) return json({ player: null });
  const [wallet, inventory, bests, quests] = await Promise.all([
    balances(ctx.db, player.id),
    all(ctx.db, 'SELECT item_id FROM inventory WHERE player_id = ? ORDER BY acquired_at', player.id),
    all(ctx.db, "SELECT game, board, score FROM bests WHERE player_id = ? AND board IN ('ALL', ?)", player.id, `D:${ctx.day}`),
    questsFor(ctx, player.id),
  ]);
  const streakAlive = nextStreak(player.lastCheckin, player.streak, ctx.day);
  return json({
    player: { ...player, vip: player.vipUntil > ctx.now, streak: streakAlive.already || streakAlive.streak > 1 ? player.streak : 0 },
    checkedInToday: player.lastCheckin === ctx.day,
    trail: trailColors(player.equippedTrail),
    wallet,
    inventory: inventory.map((r) => r.item_id),
    bests: bests.map((b) => ({ game: b.game, board: b.board === 'ALL' ? 'alltime' : 'daily', score: Number(b.score) })),
    quests,
  });
}

/** POST /api/me/checkin → daily login streak reward, once per UTC day. */
export async function checkin(ctx) {
  const player = await ctx.requirePlayer();
  const { streak, already } = nextStreak(player.lastCheckin, player.streak, ctx.day);
  if (already) return json({ reward: 0, streak, already: true, wallet: await balances(ctx.db, player.id) });
  const reward = checkinReward(streak, player.vipUntil > ctx.now);
  const [updated, booked] = await ctx.db.batch([
    stmt(ctx.db, 'UPDATE players SET streak = ?, last_checkin = ? WHERE id = ? AND (last_checkin IS NULL OR last_checkin <> ?)', streak, ctx.day, player.id, ctx.day),
    grant(ctx.db, { playerId: player.id, amount: reward, reason: 'checkin', ref: ctx.day, day: ctx.day, now: ctx.now }),
  ]);
  const granted = updated.meta && updated.meta.changes === 0 ? 0 : bookedAmount(booked);
  return json({ reward: granted, streak, already: granted === 0, wallet: await balances(ctx.db, player.id) });
}

/** POST /api/me/merge {guest:{id, credits}} → folds capped guest credits in, once per guest id. */
export async function mergeGuest(ctx) {
  const player = await ctx.requirePlayer();
  const body = await readJson(ctx.request, 4096);
  const guest = body.guest;
  if (!isObj(guest) || typeof guest.id !== 'string' || !GUEST_ID_RE.test(guest.id)) throw new HttpError(400, 'bad-guest');
  await ctx.limit(`merge:${player.id}`, 5, 3600_000);
  const plan = planGuestMerge(guest);
  let merged = 0;
  if (plan.credits > 0) {
    // At most 3 merges per player per day, and each guest id merges once (ledger ref).
    const res = await stmt(
      ctx.db,
      `INSERT OR IGNORE INTO ledger (player_id, currency, delta, reason, ref, day, created_at)
       SELECT ?, 'credits', ?, 'guest_merge', ?, ?, ?
       WHERE (SELECT COUNT(*) FROM ledger WHERE player_id = ? AND reason = 'guest_merge' AND day = ?) < 3
       RETURNING delta`,
      player.id, plan.credits, guest.id, ctx.day, ctx.now, player.id, ctx.day,
    ).all();
    merged = bookedAmount(res);
  }
  return json({ merged, wallet: await balances(ctx.db, player.id) });
}

/** POST /api/quests/:id/claim */
export async function claimQuest(ctx, { id }) {
  const player = await ctx.requirePlayer();
  const quest = questById(id);
  const today = await questsFor(ctx, player.id);
  const q = quest && today.find((t) => t.id === quest.id);
  if (!q) throw new HttpError(404, 'quest-not-active');
  if (!q.done) throw new HttpError(409, 'quest-not-complete');
  const res = await grant(ctx.db, { playerId: player.id, amount: q.reward, reason: 'quest', ref: `${ctx.day}:${q.id}`, day: ctx.day, now: ctx.now }).all();
  const granted = bookedAmount(res);
  if (!granted) throw new HttpError(409, 'quest-already-claimed');
  return json({ granted, wallet: await balances(ctx.db, player.id) });
}

/** POST /api/wallet/grant {amount, reason, game} → only rule-approved, capped amounts are booked. */
export async function walletGrant(ctx) {
  const player = await ctx.requirePlayer();
  const body = await readJson(ctx.request, 1024);
  const gameSlug = typeof body.game === 'string' && SLUG_RE.test(body.game) && gameBySlug(body.game) ? body.game : null;
  const rule = grantRule(body.reason, body.amount, gameSlug);
  if (!rule) throw new HttpError(400, 'grant-not-allowed');
  await ctx.limit(`grant:${player.id}`, 30, 3600_000);
  const res = await cappedGrant(ctx.db, {
    playerId: player.id, amount: rule.amount, reason: rule.reason, day: ctx.day, now: ctx.now, cap: rule.dailyCap,
  }).all();
  const granted = bookedAmount(res);
  return json({ granted, reason: granted ? 'granted' : 'daily-cap', wallet: await balances(ctx.db, player.id) });
}

/** POST /api/wallet/spend {itemId, cost?} → buys a catalog item; price comes from the catalog only. */
export async function walletSpend(ctx) {
  const player = await ctx.requirePlayer();
  const body = await readJson(ctx.request, 1024);
  const item = typeof body.itemId === 'string' && ITEM_ID_RE.test(body.itemId) ? itemById(body.itemId) : null;
  if (!item || !item.price) throw new HttpError(404, 'item-not-for-sale');
  if (body.cost !== undefined && body.cost !== item.price.amount) throw new HttpError(409, 'price-changed');
  await ctx.limit(`spend:${player.id}`, 30, 3600_000);
  const { currency, amount } = item.price;
  const [charge] = await ctx.db.batch([
    stmt(
      ctx.db,
      `INSERT OR IGNORE INTO ledger (player_id, currency, delta, reason, ref, day, created_at)
       SELECT ?, ?, ?, 'buy_item', ?, ?, ?
       WHERE (SELECT COALESCE(SUM(delta), 0) FROM ledger WHERE player_id = ? AND currency = ?) >= ?
         AND NOT EXISTS (SELECT 1 FROM inventory WHERE player_id = ? AND item_id = ?)
       RETURNING delta`,
      player.id, currency, -amount, item.id, ctx.day, ctx.now, player.id, currency, amount, player.id, item.id,
    ),
    stmt(
      ctx.db,
      `INSERT OR IGNORE INTO inventory (player_id, item_id, source, acquired_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ledger WHERE player_id = ? AND reason = 'buy_item' AND ref = ?)`,
      player.id, item.id, currency, ctx.now, player.id, item.id,
    ),
  ]);
  const wallet = await balances(ctx.db, player.id);
  if (!charge.results || !charge.results.length) {
    const owned = await first(ctx.db, 'SELECT 1 AS x FROM inventory WHERE player_id = ? AND item_id = ?', player.id, item.id);
    throw new HttpError(409, owned ? 'already-owned' : 'insufficient-funds', { wallet });
  }
  return json({ ok: true, itemId: item.id, wallet });
}

/** POST /api/me/equip {itemId|null} → sets the cross-game trail games read via ArcadeSDK.init(). */
export async function equip(ctx) {
  const player = await ctx.requirePlayer();
  const body = await readJson(ctx.request, 1024);
  let itemId = null;
  if (body.itemId !== null) {
    const item = typeof body.itemId === 'string' && ITEM_ID_RE.test(body.itemId) ? itemById(body.itemId) : null;
    if (!item || item.kind !== 'trail') throw new HttpError(400, 'bad-item');
    const owned = await first(ctx.db, 'SELECT 1 AS x FROM inventory WHERE player_id = ? AND item_id = ?', player.id, item.id);
    if (!owned) throw new HttpError(403, 'not-owned');
    itemId = item.id;
  }
  await exec(ctx.db, 'UPDATE players SET equipped_trail = ? WHERE id = ?', itemId, player.id);
  return json({ ok: true, equippedTrail: itemId });
}

function requireGameSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || !gameBySlug(slug)) throw new HttpError(404, 'unknown-game');
  return slug;
}

/** GET /api/saves/:game */
export async function getSave(ctx, { game }) {
  const player = await ctx.requirePlayer();
  const row = await first(ctx.db, 'SELECT data, updated_at FROM saves WHERE player_id = ? AND game = ?', player.id, requireGameSlug(game));
  return json({ data: row ? JSON.parse(row.data) : null, updatedAt: row ? Number(row.updated_at) : 0 });
}

/** PUT /api/saves/:game {data} — opaque per-game JSON, size-capped, last write wins. */
export async function putSave(ctx, { game }) {
  const player = await ctx.requirePlayer();
  const slug = requireGameSlug(game);
  const body = await readJson(ctx.request, MAX_SAVE_BYTES + 1024);
  if (!isObj(body.data)) throw new HttpError(400, 'bad-save');
  const data = JSON.stringify(body.data);
  if (data.length > MAX_SAVE_BYTES) throw new HttpError(413, 'save-too-large');
  await ctx.limit(`save:${player.id}`, 60, 10 * 60_000);
  await exec(
    ctx.db,
    `INSERT INTO saves (player_id, game, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id, game) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    player.id, slug, data, ctx.now,
  );
  return json({ ok: true, updatedAt: ctx.now });
}

/** GET /api/friends */
export async function listFriends(ctx) {
  const player = await ctx.requirePlayer();
  const rows = await all(
    ctx.db,
    'SELECT p.username, p.friend_code FROM friends f JOIN players p ON p.id = f.friend_id WHERE f.player_id = ? ORDER BY p.username_key',
    player.id,
  );
  return json({ friends: rows.map((r) => ({ name: r.username, code: r.friend_code })) });
}

/** POST /api/friends {code} → follow a player by friend code (one-way, like a friends board). */
export async function addFriend(ctx) {
  const player = await ctx.requirePlayer();
  const body = await readJson(ctx.request, 512);
  const code = typeof body.code === 'string' ? body.code.toUpperCase().replace(/[\s-]/g, '') : '';
  if (!FRIEND_CODE_RE.test(code)) throw new HttpError(400, 'bad-friend-code');
  await ctx.limit(`friends:${player.id}`, 30, 3600_000);
  const friend = await first(ctx.db, 'SELECT id, username, friend_code FROM players WHERE friend_code = ?', code);
  if (!friend) throw new HttpError(404, 'friend-not-found');
  if (friend.id === player.id) throw new HttpError(400, 'cannot-friend-self');
  const count = await first(ctx.db, 'SELECT COUNT(*) AS n FROM friends WHERE player_id = ?', player.id);
  if (Number(count.n) >= MAX_FRIENDS) throw new HttpError(409, 'too-many-friends');
  await exec(ctx.db, 'INSERT OR IGNORE INTO friends (player_id, friend_id, created_at) VALUES (?, ?, ?)', player.id, friend.id, ctx.now);
  return json({ ok: true, friend: { name: friend.username, code: friend.friend_code } });
}

/** DELETE /api/friends/:code */
export async function removeFriend(ctx, { code }) {
  const player = await ctx.requirePlayer();
  if (!FRIEND_CODE_RE.test(code)) throw new HttpError(400, 'bad-friend-code');
  await exec(ctx.db, 'DELETE FROM friends WHERE player_id = ? AND friend_id = (SELECT id FROM players WHERE friend_code = ?)', player.id, code);
  return json({ ok: true });
}

/** Cosmetic colors for the equipped trail (sent to games through the SDK). */
export function trailColors(itemId) {
  const item = itemId ? ITEMS.find((i) => i.id === itemId && i.kind === 'trail') : null;
  return item ? { id: item.id, name: item.name, colors: item.colors } : null;
}
