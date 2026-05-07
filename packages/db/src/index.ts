import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export * from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

let _db: Db | null = null;

/**
 * Returns the singleton Drizzle database instance.
 * Must be called ONCE at application startup — never per-request.
 * Subsequent calls return the same instance.
 */
export function createDb(databaseUrl?: string) {
  if (_db) return _db;

  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // postgres-js connection pool with sane defaults for an API server
  const pool = postgres(url, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {}, // suppress NOTICE from migrations
  });

  _db = drizzle(pool, { schema, logger: process.env.NODE_ENV === "development" });
  return _db;
}

/** Reset the singleton (test use only). */
export function _resetDb(): void {
  _db = null;
}
