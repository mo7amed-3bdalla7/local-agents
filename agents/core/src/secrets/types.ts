/**
 * Secrets adapter — pluggable backend for storing secret values.
 *
 * The DB only ever holds `keychainRef` strings. Values live in the backend
 * (OS keychain today; age-encrypted file is the planned headless path).
 *
 * Ref format: `<backend>:<backend-specific>`
 *   keytar:<service>:<account>    OS keychain entry
 *   age:<absolute-path>           age-encrypted file (future)
 */

export interface SecretsAdapter {
  /** Store a value under a logical key. Returns the keychain ref to persist in DB. */
  set(key: string, value: string): Promise<string>;
  /** Retrieve a value by its keychain ref. Returns null if missing. */
  get(keychainRef: string): Promise<string | null>;
  /** Delete the entry behind a keychain ref. Idempotent. */
  delete(keychainRef: string): Promise<void>;
  /** Best-effort enumeration of logical keys this adapter manages. */
  list?(): Promise<string[]>;
}

export class MalformedKeychainRefError extends Error {
  constructor(ref: string, expected: string) {
    super(`Malformed keychain ref "${ref}" (expected ${expected})`);
    this.name = "MalformedKeychainRefError";
  }
}

export class UnknownBackendError extends Error {
  constructor(ref: string) {
    super(`Unknown secrets backend for ref "${ref}"`);
    this.name = "UnknownBackendError";
  }
}
