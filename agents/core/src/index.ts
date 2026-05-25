/**
 * @agents/core — shared platform library.
 *
 * Slice 1 exposes only the database layer. Connectors, registries, secrets,
 * and the repo manager land in subsequent commits.
 */

export * as schema from "./db/schema.js";
export { getDb, closeDb, type Db } from "./db/client.js";
export { runMigrations } from "./db/migrate.js";
