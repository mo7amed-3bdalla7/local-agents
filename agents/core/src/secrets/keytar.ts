/**
 * keytar-backed SecretsAdapter.
 *
 * On macOS, values go into the user's Keychain. On Linux, libsecret /
 * gnome-keyring. On Windows, Credential Vault.
 *
 * This module imports the keytar package eagerly, which dlopens its
 * native binding (libsecret on Linux). When the binding isn't available
 * (typical inside a Linux container) any consumer that imports this file
 * will crash with ERR_DLOPEN_FAILED. The platform's secrets/index.ts
 * loads this module via createRequire inside a try/catch so the crash is
 * containable — but only if no static path eagerly re-exports from here.
 * Pure ref helpers live in `keytar-ref.ts` for that reason.
 */

import keytar from "keytar";
import type { SecretsAdapter } from "./types.js";
import {
  buildKeytarRef,
  keytarService,
  parseKeytarRef,
} from "./keytar-ref.js";

// Re-export the pure helpers so external consumers can still import them
// from this module path (back-compat with code that grew up with one file).
export {
  DEFAULT_SERVICE,
  buildKeytarRef,
  parseKeytarRef,
} from "./keytar-ref.js";

export const keytarAdapter: SecretsAdapter = {
  async set(key, value) {
    const service = keytarService();
    await keytar.setPassword(service, key, value);
    return buildKeytarRef(key, service);
  },

  async get(keychainRef) {
    const { service, account } = parseKeytarRef(keychainRef);
    return keytar.getPassword(service, account);
  },

  async delete(keychainRef) {
    const { service, account } = parseKeytarRef(keychainRef);
    await keytar.deletePassword(service, account);
  },

  async list() {
    const creds = await keytar.findCredentials(keytarService());
    return creds.map((c) => c.account);
  },
};
