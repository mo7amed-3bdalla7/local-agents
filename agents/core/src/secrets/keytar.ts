/**
 * keytar-backed SecretsAdapter.
 *
 * On macOS, values go into the user's Keychain. On Linux, libsecret /
 * gnome-keyring. On Windows, Credential Vault.
 *
 * Refs are formatted `keytar:<service>:<account>`. The service is configurable
 * via AGENTS_KEYCHAIN_SERVICE so multiple installs don't collide.
 */

import keytar from "keytar";
import {
  MalformedKeychainRefError,
  type SecretsAdapter,
} from "./types.js";

export const DEFAULT_SERVICE = "agents-platform";

function currentService(): string {
  return process.env.AGENTS_KEYCHAIN_SERVICE ?? DEFAULT_SERVICE;
}

const PREFIX = "keytar:";

export function buildKeytarRef(account: string, service?: string): string {
  return `${PREFIX}${service ?? currentService()}:${account}`;
}

export function parseKeytarRef(ref: string): {
  service: string;
  account: string;
} {
  if (!ref.startsWith(PREFIX)) {
    throw new MalformedKeychainRefError(ref, `${PREFIX}<service>:<account>`);
  }
  const rest = ref.slice(PREFIX.length);
  // The account portion can contain ':' (e.g. 'github-pat:owner/repo'),
  // so split only on the first separator.
  const sep = rest.indexOf(":");
  if (sep < 1 || sep === rest.length - 1) {
    throw new MalformedKeychainRefError(ref, `${PREFIX}<service>:<account>`);
  }
  return {
    service: rest.slice(0, sep),
    account: rest.slice(sep + 1),
  };
}

export const keytarAdapter: SecretsAdapter = {
  async set(key, value) {
    const service = currentService();
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
    const creds = await keytar.findCredentials(currentService());
    return creds.map((c) => c.account);
  },
};
