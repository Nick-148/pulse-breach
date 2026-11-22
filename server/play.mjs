// Runs, score submission, leaderboards, ghosts (ADR 0010).
import { GAMES, gameBySlug, SLUG_RE } from '../shared/games.mjs';
import { featuredGame, GHOST_ID_RE } from '../shared/seeds.mjs';
import { validateRunBody, checkPlausibility } from '../shared/validate.mjs';
import { runCredits, runBucket } from '../shared/economy.mjs';
import { utcDay, shiftDay, DAY_RE } from '../shared/util.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { randomHex, signToken, verifyToken } from './crypto.mjs';
import { all, balances, bookedAmount, cappedGrant, first, stmt, exec } from './db.mjs';

const BOARD_SIZE = 50;

function requireSecret(env) {
  if (!env.RUN_SECRET || env.RUN_SECRET.length < 32) throw new HttpError(503, 'leaderboards-offline');
  return env.RUN_SECRET;
}

function requireGame(slug) {
  const game = typeof slug === 'string' && SLUG_RE.test(slug) ? gameBySlug(slug) : null;
  if (!game) throw new HttpError(404, 'unknown-game');
  return game;
}

export const isFeatured = (game, day) => featuredGame(day, GAMES)?.slug === game.slug;

/** POST /api/runs {game, seed} → signed run token. Guests get tokens too (claim after sign-in). */
export async function startRun(ctx) {
  const secret = requireSecret(ctx.env);
  const body = await readJson(ctx.request, 1024);
  const game = requireGame(body.game);
  if (typeof body.seed !== 'string' || !game.seedPattern.test(body.seed)) throw new HttpError(400, 'bad-seed');
  await ctx.limit(`runs:${await ctx.ipKey()}`, 90, 10 * 60_000);
  const token = await signToken({ v: 1, r: randomHex(16), g: game.slug, s: body.seed, t: ctx.now }, secret);
  return json({ token, daily: body.seed === game.dailySeed(ctx.day) });
}

/** POST /api/scores → validates, stores the run, updates boards, books credits. */
export async function submitScore(ctx) {
  const secret = requireSecret(ctx.env);
  const player = await ctx.requirePlayer();
  const shape = validateRunBody(await readJson(ctx.request));
  if (!shape.ok) throw new HttpError(400, shape.reason);
  const run = shape.value;
  const token = await verifyToken(run.token, secret);
  if (!token || token.v !== 1 || typeof token.r !== 'string' || !GHOST_ID_RE.test(token.r) || !Number.isSafeInteger(token.t)) {
    throw new HttpError(400, 'bad-token');
  }
  const game = gameBySlug(token.g);
  const verdict = checkPlausibility(game, run, token, ctx.now);
  if (!verdict.ok) throw new HttpError(422, verdict.reason);
  await ctx.limit(`scores:${player.id}`, 40, 10 * 60_000);

  const db = ctx.db;
  const runDay = utcDay(new Date(token.t));
  const isDaily = token.s === game.dailySeed(runDay);
  const featured = isFeatured(game, runDay);
  const prev = await first(db, 'SELECT MAX(score) AS best FROM runs WHERE player_id = ? AND game = ? AND seed = ?', player.id, game.slug, token.s);
  const seedBest = prev && prev.best !== null ? Number(prev.best) : -1;
  const keepGhost = Boolean(run.ghost) && run.score > seedBest;

  const statements = [
    stmt(
      db,
      'INSERT INTO runs (id, player_id, game, seed, day, is_daily, score, survival_ms, meta, ghost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      token.r, player.id, game.slug, token.s, runDay, isDaily ? 1 : 0, run.score, run.survivalMs,
      JSON.stringify(run.meta), keepGhost ? JSON.stringify(run.ghost) : null, ctx.now,
    ),
  ];
  if (isDaily) {
    for (const board of [`D:${runDay}`, 'ALL']) {
      statements.push(stmt(
        db,
        `INSERT INTO bests (game, board, player_id, score, survival_ms, run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game, board, player_id) DO UPDATE SET
           score = excluded.score, survival_ms = excluded.survival_ms, run_id = excluded.run_id, updated_at = excluded.updated_at
         WHERE excluded.score > bests.score`,
        game.slug, board, player.id, run.score, run.survivalMs, token.r, ctx.now,
      ));
    }
  }
  const credits = runCredits(game, run.score, featured);
  const creditIndex = statements.length;
  if (credits > 0) {
    const bucket = runBucket(featured);
    statements.push(cappedGrant(db, {
      playerId: player.id, amount: credits, reason: bucket.reason, ref: token.r, day: runDay, now: ctx.now, cap: bucket.cap,
    }));
  }

  let results;
  try {
    results = await db.batch(statements);
  } catch (err) {
    if (String(err && err.message).includes('runs.id')) throw new HttpError(409, 'run-already-submitted');
    throw err;
  }
  if (keepGhost) {
    await exec(db, 'UPDATE runs SET ghost = NULL WHERE player_id = ? AND game = ? AND seed = ? AND id <> ? AND ghost IS NOT NULL', player.id, game.slug, token.s, token.r);
  }

  let daily = null;
  if (isDaily) {
    const board = `D:${runDay}`;
    const best = await first(db, 'SELECT score FROM bests WHERE game = ? AND board = ? AND player_id = ?', game.slug, board, player.id);
    const rank = await first(db, 'SELECT COUNT(*) + 1 AS rank FROM bests WHERE game = ? AND board = ? AND score > ?', game.slug, board, best.score);
    daily = { best: Number(best.score), rank: Number(rank.rank), improved: Number(best.score) === run.score && run.score > 0 };
  }
  return json({
    accepted: true,
    runId: token.r,
    ghostId: keepGhost ? token.r : null,
    isDaily,
    featured,
    daily,
    credits: credits > 0 ? bookedAmount(results[creditIndex]) : 0,
    balance: await balances(db, player.id),
  });
}

function boardDay(ctx) {
  const day = ctx.url.searchParams.get('day') || ctx.day;
  if (!DAY_RE.test(day) || day > ctx.day || day < shiftDay(ctx.day, -60)) throw new HttpError(400, 'bad-day');
  return day;
}

const entryView = (r, i) => ({
  rank: i + 1,
  name: r.username,
  score: Number(r.score),
  survivalMs: Number(r.survival_ms),
  ghostId: r.has_ghost ? r.run_id : null,
});

/** GET /api/boards/:game?board=daily|alltime|friends&day=YYYY-MM-DD */
export async function leaderboard(ctx, { game: slug }) {
  const game = requireGame(slug);
  const kind = ctx.url.searchParams.get('board') || 'daily';
  if (!['daily', 'alltime', 'friends'].includes(kind)) throw new HttpError(400, 'bad-board');
  const day = boardDay(ctx);
  const board = kind === 'alltime' ? 'ALL' : `D:${day}`;
  const player = await ctx.player();
  if (kind === 'friends' && !player) throw new HttpError(401, 'sign-in-required');

  const select = `SELECT b.score, b.survival_ms, b.run_id, b.player_id, p.username, (r.ghost IS NOT NULL) AS has_ghost
    FROM bests b JOIN players p ON p.id = b.player_id LEFT JOIN runs r ON r.id = b.run_id
    WHERE b.game = ? AND b.board = ?`;
  const rows = kind === 'friends'
    ? await all(ctx.db, `${select} AND (b.player_id = ? OR b.player_id IN (SELECT friend_id FROM friends WHERE player_id = ?))
        ORDER BY b.score DESC, b.updated_at ASC LIMIT ?`, game.slug, board, player.id, player.id, BOARD_SIZE)
    : await all(ctx.db, `${select} ORDER BY b.score DESC, b.updated_at ASC LIMIT ?`, game.slug, board, BOARD_SIZE);

  let me = null;
  if (player) {
    const mine = await first(ctx.db, 'SELECT score, survival_ms FROM bests WHERE game = ? AND board = ? AND player_id = ?', game.slug, board, player.id);
    if (mine) {
      const rank = await first(ctx.db, 'SELECT COUNT(*) + 1 AS rank FROM bests WHERE game = ? AND board = ? AND score > ?', game.slug, board, mine.score);
      me = { rank: Number(rank.rank), score: Number(mine.score), survivalMs: Number(mine.survival_ms) };
    }
  }
  return json({
    game: game.slug, board: kind, day, seed: kind === 'alltime' ? null : game.dailySeed(day),
    entries: rows.map(entryView), me,
  });
}

/** GET /api/trending → today's top 3 per game, for the home ticker. */
export async function trending(ctx) {
  const out = [];
  for (const game of GAMES) {
    const rows = await all(
      ctx.db,
      `SELECT b.score, p.username FROM bests b JOIN players p ON p.id = b.player_id
       WHERE b.game = ? AND b.board = ? ORDER BY b.score DESC, b.updated_at ASC LIMIT 3`,
      game.slug, `D:${ctx.day}`,
    );
    rows.forEach((r, i) => out.push({ game: game.slug, title: game.title, rank: i + 1, name: r.username, score: Number(r.score) }));
  }
  return json({ day: ctx.day, entries: out }, 200, { 'Cache-Control': 'public, max-age=30' });
}

/** GET /api/ghosts/:id → recorded positions of a best run (10 Hz), for challenge ghosts. */
export async function ghost(ctx, { id }) {
  if (!GHOST_ID_RE.test(id)) throw new HttpError(404, 'not-found');
  const row = await first(
    ctx.db,
    'SELECT r.game, r.seed, r.score, r.survival_ms, r.ghost, p.username FROM runs r JOIN players p ON p.id = r.player_id WHERE r.id = ? AND r.ghost IS NOT NULL',
    id,
  );
  if (!row) throw new HttpError(404, 'not-found');
  let frames;
  try {
    frames = JSON.parse(row.ghost);
  } catch {
    throw new HttpError(404, 'not-found');
  }
  return json(
    { id, game: row.game, seed: row.seed, name: row.username, score: Number(row.score), survivalMs: Number(row.survival_ms), hz: 10, frames },
    200,
    { 'Cache-Control': 'public, max-age=3600' },
  );
}
