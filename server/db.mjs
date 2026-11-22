// D1 query helpers. Every statement is parameterized; SQL strings never contain user input.

export const stmt = (db, sql, ...params) => db.prepare(sql).bind(...params);
export const first = (db, sql, ...params) => stmt(db, sql, ...params).first();
export const all = async (db, sql, ...params) => (await stmt(db, sql, ...params).all()).results || [];
export const exec = (db, sql, ...params) => stmt(db, sql, ...params).run();

export async function balances(db, playerId) {
  const rows = await all(db, 'SELECT currency, COALESCE(SUM(delta), 0) AS total FROM ledger WHERE player_id = ? GROUP BY currency', playerId);
  const out = { credits: 0, gems: 0 };
  for (const r of rows) out[r.currency] = Number(r.total);
  return out;
}

const USED_TODAY = '(SELECT COALESCE(SUM(delta), 0) FROM ledger WHERE player_id = ? AND reason = ? AND day = ?)';

/**
 * Books min(amount, cap − already booked today for this reason) in ONE statement, so concurrent requests
 * can't both pass the cap check. `RETURNING delta` yields the booked amount (no row = capped or duplicate ref).
 */
export function cappedGrant(db, { playerId, currency = 'credits', amount, reason, ref = null, day, now, cap }) {
  return stmt(
    db,
    `INSERT OR IGNORE INTO ledger (player_id, currency, delta, reason, ref, day, created_at)
     SELECT ?, ?, MIN(?, ? - ${USED_TODAY}), ?, ?, ?, ?
     WHERE ? - ${USED_TODAY} > 0
     RETURNING delta`,
    playerId, currency, amount, cap, playerId, reason, day, reason, ref, day, now, cap, playerId, reason, day,
  );
}

/** Uncapped, idempotent-by-ref grant (quest claims, purchases, merges). */
export function grant(db, { playerId, currency = 'credits', amount, reason, ref = null, day, now }) {
  return stmt(
    db,
    'INSERT OR IGNORE INTO ledger (player_id, currency, delta, reason, ref, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING delta',
    playerId, currency, amount, reason, ref, day, now,
  );
}

export const bookedAmount = (result) => Number(result?.results?.[0]?.delta || 0);

/** Fixed-window counter in one upsert. Returns true while the caller is within `limit`. */
export async function rateLimit(db, key, limit, windowMs, now) {
  const row = await first(
    db,
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
     RETURNING count`,
    key, now + windowMs, now, now,
  );
  return Number(row?.count || 0) <= limit;
}

export async function pruneRateLimits(db, now) {
  await exec(db, 'DELETE FROM rate_limits WHERE reset_at < ?', now - 86_400_000);
}
