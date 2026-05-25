/**
 * @agents/core — shared platform library.
 *
 * Connectors, registries, and the repo manager land in subsequent commits.
 */

export * as schema from "./db/schema.js";
export { getDb, closeDb, type Db } from "./db/client.js";
export { runMigrations } from "./db/migrate.js";

export {
  getSecrets,
  setSecrets,
  getByRef,
  keytarAdapter,
  buildKeytarRef,
  parseKeytarRef,
  MalformedKeychainRefError,
  UnknownBackendError,
  type SecretsAdapter,
} from "./secrets/index.js";
