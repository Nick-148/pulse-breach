// A D1-shaped wrapper over node:sqlite so the API runs locally and in tests without Wrangler (ADR 0008).
// Mirrors the parts of D1 we use: prepare().bind().first()/all()/run(), batch() as one transaction.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

function normalize(v) {
  if (v === undefined) throw new TypeError('D1_TYPE_ERROR: undefined is not a supported bind value');
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export function createD1(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  const returnsRows = (sql) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

  const execute = (sql, params) => {
    const st = db.prepare(sql);
    if (returnsRows(sql)) {
      const results = st.all(...params).map((r) => ({ ...r }));
      return { success: true, results, meta: { changes: results.length } };
    }
    const r = st.run(...params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };

  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p.map(normalize)),
    first: async (col) => {
      const row = execute(sql, params).results[0] ?? null;
      return row && col ? row[col] : row;
    },
    all: async () => execute(sql, params),
    run: async () => execute(sql, params),
    runSync: () => execute(sql, params),
  });

  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1 };
    },
    close: () => db.close(),
    raw: db,
  };
}

/** Applies migrations/*.sql in order, once each (tracked like wrangler's d1_migrations table). */
export function applyMigrations(d1) {
  const db = d1.raw;
  db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
      db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return d1;
}
