/**
 * Public secrets API.
 *
 * `getSecrets()` returns the active adapter for write operations (which always
 * use the active backend). `getByRef()` dispatches on ref prefix so reads work
 * regardless of which backend wrote a given secret.
 */

import { keytarAdapter } from "./keytar.js";
import { UnknownBackendError, type SecretsAdapter } from "./types.js";

export type { SecretsAdapter } from "./types.js";
export {
  MalformedKeychainRefError,
  UnknownBackendError,
} from "./types.js";
export { keytarAdapter, buildKeytarRef, parseKeytarRef } from "./keytar.js";

let _adapter: SecretsAdapter = keytarAdapter;

/** Active adapter for new writes. */
export function getSecrets(): SecretsAdapter {
  return _adapter;
}

/** Override the active backend. Used by tests and future age support. */
export function setSecrets(adapter: SecretsAdapter): void {
  _adapter = adapter;
}

/** Resolve a value regardless of which backend originally wrote it. */
export async function getByRef(keychainRef: string): Promise<string | null> {
  if (keychainRef.startsWith("keytar:")) return keytarAdapter.get(keychainRef);
  throw new UnknownBackendError(keychainRef);
}
