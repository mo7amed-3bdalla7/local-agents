/**
 * Migration runner.
 *
 * Applies all SQL migrations in ./drizzle (relative to the package root) to the
 * database identified by DATABASE_URL. Ensures pgvector is installed.
 *
 * Usage:
 *   - As a library:  await runMigrations()
 *   - As a script:   node dist/db/migrate.js
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
// dist/db/migrate.js → ../../drizzle
const MIGRATIONS_FOLDER = join(here, "..", "..", "drizzle");

export async function runMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for migrations");
  }

  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);
    // pgvector is referenced by future retrieval features; install up front so
    // tables that add vector columns don't need a coordinated migration step.
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  const entry = fileURLToPath(new URL(import.meta.url));
  return entry === process.argv[1];
})();

if (isMain) {
  try {
    process.loadEnvFile();
  } catch {
    // .env is optional
  }
  runMigrations()
    .then(() => {
      console.log("Migrations applied.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
