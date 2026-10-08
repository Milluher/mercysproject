/**
 * Database access: plain SQL over one small interface with two engines behind it.
 *
 * - DATABASE_URL set (e.g. Neon Postgres on Vercel): a node-postgres connection pool.
 * - Not set (local development): PGlite, a full Postgres compiled to WebAssembly running
 *   in-process, stored in .data/. Tests use an in-memory PGlite.
 *
 * Column types are chosen so both engines return the same JavaScript values: dates are ISO
 * text ("2026-09-01"), numbers are float8/int4 (never numeric/bigint, which pg returns as strings).
 */
import "server-only";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run several statements at once, without parameters (schema setup). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  sector          TEXT NOT NULL DEFAULT '',
  stage           TEXT NOT NULL DEFAULT '',
  invested_on     TEXT,
  amount_invested DOUBLE PRECISION,
  ownership_pct   DOUBLE PRECISION
);

-- One row per company and reporting month. Metric columns are nullable: an update request may
-- ask for only some of them, and later requests for the same month fill in the rest.
CREATE TABLE IF NOT EXISTS updates (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,              -- first day of the month, e.g. 2026-09-01
  revenue      DOUBLE PRECISION,           -- monthly recurring revenue
  burn         DOUBLE PRECISION,           -- net monthly burn (positive = cash out)
  cash         DOUBLE PRECISION,           -- cash in the bank at month end
  headcount    INTEGER,
  customers    INTEGER,
  notes        TEXT,
  submitted_on TEXT NOT NULL,
  UNIQUE (company_id, month)
);

CREATE TABLE IF NOT EXISTS custom_metrics (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,                -- number, integer, percent, money or text
  help       TEXT NOT NULL DEFAULT '',     -- guidance shown to founders under the field
  created_on TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_metrics_name ON custom_metrics (lower(name));

CREATE TABLE IF NOT EXISTS custom_values (
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,
  metric_id    INTEGER NOT NULL REFERENCES custom_metrics(id) ON DELETE CASCADE,
  value_num    DOUBLE PRECISION,
  value_text   TEXT,
  submitted_on TEXT NOT NULL,
  PRIMARY KEY (company_id, month, metric_id)
);

CREATE TABLE IF NOT EXISTS update_requests (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,               -- shown to founders as the form title
  month       TEXT NOT NULL,
  fields      JSONB NOT NULL,              -- metric keys, e.g. ["revenue", "custom:3"]
  company_ids JSONB NOT NULL,
  due_on      TEXT,
  created_on  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_responses (
  request_id   INTEGER NOT NULL REFERENCES update_requests(id) ON DELETE CASCADE,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  submitted_on TEXT NOT NULL,
  PRIMARY KEY (request_id, company_id)
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,      -- stored lower-case
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'founder')),
  company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,  -- founders only
  password_hash TEXT,                      -- NULL until the person accepts their invite
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ
);

-- Only SHA-256 hashes of invite and session tokens are stored, never the tokens themselves.
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
`;

// --- Engines ------------------------------------------------------------------------

export async function postgresDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  // Small pool: on Vercel each function instance gets its own, and Neon's pooled URL multiplexes them.
  const pool = new Pool({ connectionString: url, max: 3 });
  const wrap = (run: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Db => ({
    query: async <T,>(sql: string, params?: unknown[]) => (await run(sql, params)).rows as T[],
    exec: async (sql: string) => void (await run(sql)),
    transaction: () => {
      throw new Error("Nested transactions are not supported");
    },
  });
  return {
    query: async <T,>(sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows as T[],
    exec: async (sql: string) => void (await pool.query(sql)),
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap((sql, params) => client.query(sql, params)));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

/** An in-process Postgres. `dataDir` undefined means in-memory (tests). */
export async function pgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const pg = new PGlite(dataDir);
  type Q = {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    exec: (sql: string) => Promise<unknown>;
  };
  const wrap = (q: Q): Db => ({
    query: async <T,>(sql: string, params?: unknown[]) => (await q.query(sql, params)).rows as T[],
    exec: async (sql: string) => void (await q.exec(sql)),
    transaction: () => {
      throw new Error("Nested transactions are not supported");
    },
  });
  return {
    ...wrap(pg),
    transaction: <T,>(fn: (tx: Db) => Promise<T>) => pg.transaction((tx) => fn(wrap(tx))),
  };
}

// --- The app's database -------------------------------------------------------------

type Holder = { db?: Promise<Db> };
const holder = globalThis as typeof globalThis & { __portfolioDb?: Holder };
holder.__portfolioDb ??= {};

/** The shared database, created on first use with its tables (and demo data if SEED_DEMO=true). */
export function getDb(): Promise<Db> {
  const h = holder.__portfolioDb!;
  h.db ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.VERCEL) {
      // Vercel's servers are read-only and short-lived, so the built-in local database can't work there.
      throw new Error("DATABASE_URL is not set. Connect a Postgres database in Vercel: Project → Storage → Create Database (Neon).");
    }
    const db = url ? await postgresDb(url) : await pgliteDb(process.env.PGLITE_DIR || ".data/pglite");
    await prepare(db);
    return db;
  })().catch((e) => {
    h.db = undefined; // retry on the next request instead of caching the failure
    throw e;
  });
  return h.db;
}

/** Use a specific database (tests). */
export async function setDb(db: Db, { seedDemo = false } = {}): Promise<void> {
  await prepare(db, seedDemo);
  holder.__portfolioDb!.db = Promise.resolve(db);
}

async function prepare(db: Db, seedDemo = process.env.SEED_DEMO === "true"): Promise<void> {
  await db.exec(SCHEMA);
  if (seedDemo) {
    const { seedDemoIfEmpty } = await import("./seed");
    await seedDemoIfEmpty(db);
  }
}
