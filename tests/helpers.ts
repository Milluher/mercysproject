import { pgliteDb, postgresDb, setDb, type Db } from "@/lib/db";

let db: Db | undefined;

/**
 * A fresh, empty database for each test (optionally filled with the demo portfolio).
 * In-memory PGlite by default; set TEST_DATABASE_URL to run against a real Postgres instead,
 * through the same node-postgres driver the app uses in production. Its public schema is wiped.
 */
export async function freshDb({ seedDemo = false } = {}): Promise<Db> {
  db ??= process.env.TEST_DATABASE_URL ? await postgresDb(process.env.TEST_DATABASE_URL) : await pgliteDb();
  await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await setDb(db, { seedDemo });
  return db;
}
