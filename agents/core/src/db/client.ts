/**
 * Singleton postgres client + Drizzle instance.
 *
 * Reads DATABASE_URL from the environment. Call `closeDb()` from shutdown
 * paths in long-running processes.
 */

import postgres, { type Sql } from "postgres";
import {
  drizzle,
  type PostgresJsDatabase,
} from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

let _db: Db | null = null;
let _sql: Sql | null = null;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Bring up the data layer with `pnpm compose:up`, " +
        "then copy .env.example to .env.",
    );
  }
  return url;
}

export function getDb(): Db {
  if (_db) return _db;
  _sql = postgres(databaseUrl(), { max: 10 });
  _db = drizzle(_sql, { schema, casing: "snake_case" });
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
  }
}

export { schema };
