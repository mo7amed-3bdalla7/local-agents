/**
 * Pure ref helpers for the keytar backend.
 *
 * Split from keytar.ts so consumers can import the ref format without
 * dragging in keytar's native libsecret binding — which fails to dlopen
 * on Linux containers without gnome-keyring.
 */

import { MalformedKeychainRefError } from "./types.js";

export const DEFAULT_SERVICE = "agents-platform";

function currentService(): string {
  return process.env.AGENTS_KEYCHAIN_SERVICE ?? DEFAULT_SERVICE;
}

export const KEYTAR_PREFIX = "keytar:";

export function buildKeytarRef(account: string, service?: string): string {
  return `${KEYTAR_PREFIX}${service ?? currentService()}:${account}`;
}

export function parseKeytarRef(ref: string): {
  service: string;
  account: string;
} {
  if (!ref.startsWith(KEYTAR_PREFIX)) {
    throw new MalformedKeychainRefError(
      ref,
      `${KEYTAR_PREFIX}<service>:<account>`,
    );
  }
  const rest = ref.slice(KEYTAR_PREFIX.length);
  // The account portion can contain ':' (e.g. 'github-pat:owner/repo'),
  // so split only on the first separator.
  const sep = rest.indexOf(":");
  if (sep < 1 || sep === rest.length - 1) {
    throw new MalformedKeychainRefError(
      ref,
      `${KEYTAR_PREFIX}<service>:<account>`,
    );
  }
  return {
    service: rest.slice(0, sep),
    account: rest.slice(sep + 1),
  };
}

export { currentService as keytarService };
