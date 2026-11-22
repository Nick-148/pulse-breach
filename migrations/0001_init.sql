-- Seedfall Arcade schema v1 (ADR 0008). D1 = SQLite; the same file runs under node:sqlite in tests.
-- Balances are not columns: a balance is SUM(ledger.delta) for the player and currency.

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,      -- lower-cased username: case-insensitive uniqueness
  key_hash TEXT NOT NULL,                 -- SHA-256 of the server-generated Arcade Key (ADR 0009)
  friend_code TEXT NOT NULL UNIQUE,
  vip_until INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_checkin TEXT,
  equipped_trail TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_player ON sessions(player_id);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('credits', 'gems')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL,
  ref TEXT,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ledger_balance ON ledger(player_id, currency);
CREATE INDEX ledger_caps ON ledger(player_id, reason, day);
-- Idempotency: one quest claim per day, one purchase per item, one merge per guest id, one fulfilment per order.
CREATE UNIQUE INDEX ledger_idem ON ledger(player_id, reason, ref) WHERE ref IS NOT NULL;

CREATE TABLE inventory (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  source TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
);

-- One row per submitted run. The id comes from the signed run token, so a token can be used once.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  seed TEXT NOT NULL,
  day TEXT NOT NULL,
  is_daily INTEGER NOT NULL,
  score INTEGER NOT NULL,
  survival_ms INTEGER NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  ghost TEXT,                             -- kept only for the player's best run per (game, seed)
  created_at INTEGER NOT NULL
);
CREATE INDEX runs_player_day ON runs(player_id, day);
CREATE INDEX runs_player_seed ON runs(player_id, game, seed);

-- Leaderboard rows: best score per player per board ('D:YYYY-MM-DD' daily seed, or 'ALL').
CREATE TABLE bests (
  game TEXT NOT NULL,
  board TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  survival_ms INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game, board, player_id)
);
CREATE INDEX bests_rank ON bests(game, board, score DESC);
CREATE INDEX bests_board_recent ON bests(board, updated_at DESC);

CREATE TABLE friends (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, friend_id)
);

CREATE TABLE saves (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, game)
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,                    -- our order id (also sent to the provider as metadata)
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,                      -- e.g. Stripe Checkout Session id
  status TEXT NOT NULL CHECK (status IN ('pending', 'fulfilled')),
  created_at INTEGER NOT NULL,
  fulfilled_at INTEGER
);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
