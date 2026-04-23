/**
 * @mes/db — database client factory and schema re-exports.
 *
 * Usage in apps/api:
 *
 *   import { createDb } from "@mes/db";
 *   const db = createDb(process.env.DATABASE_URL);
 *
 *   import { workOrders } from "@mes/db/schema";
 *   const rows = await db.select().from(workOrders).where(...);
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle database client.
 *
 * @param connectionString - PostgreSQL connection string.
 *   Defaults to DATABASE_URL env var; throws if neither is provided.
 *
 * Note: the `postgres` driver handles connection pooling internally.
 * For apps/api, call createDb() once at startup and reuse the instance.
 * Do NOT call createDb() per-request — that creates a new connection pool
 * each time and will exhaust PostgreSQL max_connections under load.
 */
export function createDb(connectionString?: string) {
  const url =
    connectionString ??
    process.env["DATABASE_URL"];

  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Set it in .env.local or pass it to createDb()."
    );
  }

  const client = postgres(url, {
    max: 10,           // connection pool size — tune per service
    idle_timeout: 30,  // seconds before idle connections are closed
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

// Re-export schema so consumers can do: import { workOrders } from "@mes/db"
export * from "./schema/index.js";
