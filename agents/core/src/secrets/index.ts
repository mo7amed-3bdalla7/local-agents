/**
 * Public secrets API.
 *
 * Two backends ship today:
 *   - keytar  → OS keychain (macOS / Windows / Linux with gnome-keyring)
 *   - file    → AES-256-GCM encrypted files under $AGENTS_DATA_DIR/secrets/
 *               (the headless option, required when running in a container)
 *
 * Selection at boot:
 *   AGENTS_SECRETS_BACKEND=file   → file adapter
 *   AGENTS_SECRETS_BACKEND=keytar → keytar (errors if native binding missing)
 *   unset                         → keytar if its native binding loads, else
 *                                   fall back to file (with the auto-key
 *                                   warning, see file.ts).
 *
 * `getByRef()` dispatches on ref prefix so reads work regardless of which
 * backend wrote the secret. This means migrating between backends is a
 * straight one-time copy through the database — no lookups break.
 */

import { createRequire } from "node:module";
import { fileAdapter } from "./file.js";
import { UnknownBackendError, type SecretsAdapter } from "./types.js";

const _req = createRequire(import.meta.url);

export type { SecretsAdapter } from "./types.js";
export {
  MalformedKeychainRefError,
  UnknownBackendError,
} from "./types.js";
export { buildKeytarRef, parseKeytarRef } from "./keytar.js";

let _adapter: SecretsAdapter | null = null;

function tryLoadKeytarAdapter(): SecretsAdapter | null {
  try {
    // Lazy require via createRequire — the keytar package has a native
    // binding that fails to load if libsecret isn't around (typical in
    // headless Linux containers). Catching here lets the platform start
    // and fall back to the file adapter.
    const mod = _req("./keytar.js") as { keytarAdapter: SecretsAdapter };
    return mod.keytarAdapter;
  } catch {
    return null;
  }
}

function selectAdapter(): SecretsAdapter {
  const explicit = (process.env.AGENTS_SECRETS_BACKEND ?? "").toLowerCase();
  if (explicit === "file") return fileAdapter;
  if (explicit === "keytar") {
    const kt = tryLoadKeytarAdapter();
    if (!kt) {
      throw new Error(
        "AGENTS_SECRETS_BACKEND=keytar but the keytar native binding failed to load. " +
          "Install libsecret-1-0 + gnome-keyring (Linux), or set AGENTS_SECRETS_BACKEND=file.",
      );
    }
    return kt;
  }
  // Auto: prefer keytar when it's available, fall back to file.
  return tryLoadKeytarAdapter() ?? fileAdapter;
}

/** Active adapter for new writes. */
export function getSecrets(): SecretsAdapter {
  if (!_adapter) _adapter = selectAdapter();
  return _adapter;
}

/** Override the active backend. Used by tests. */
export function setSecrets(adapter: SecretsAdapter): void {
  _adapter = adapter;
}

/** Re-exported only when keytar's native binding loads. */
export const keytarAdapter: SecretsAdapter | null = tryLoadKeytarAdapter();

/** Re-export for headless deploys that want to force file. */
export { fileAdapter } from "./file.js";

/** Resolve a value regardless of which backend originally wrote it. */
export async function getByRef(keychainRef: string): Promise<string | null> {
  if (keychainRef.startsWith("file:")) return fileAdapter.get(keychainRef);
  if (keychainRef.startsWith("keytar:")) {
    const kt = tryLoadKeytarAdapter();
    if (!kt) {
      throw new Error(
        `Secret ref ${keychainRef} requires the keytar backend, which isn't available in this environment.`,
      );
    }
    return kt.get(keychainRef);
  }
  throw new UnknownBackendError(keychainRef);
}
