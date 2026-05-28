/**
 * File-backed secrets adapter — AES-256-GCM encrypted at rest, one file
 * per secret under $AGENTS_DATA_DIR/secrets/. The headless alternative to
 * the OS keychain, used when running in Docker / Linux containers where
 * keytar (libsecret + gnome-keyring) isn't viable.
 *
 * Ref format: `file:<uuid>`
 * File contents: { iv, tag, ct } as base64 strings.
 *
 * Master key:
 *   - From `AGENTS_SECRETS_KEY` (32 raw bytes base64, mint with
 *     `openssl rand -base64 32`).
 *   - If unset, an auto-generated key persists to
 *     `$AGENTS_DATA_DIR/secrets/.master.key` (0600). The user gets a
 *     loud warning on first boot — back it up immediately, losing the
 *     key means losing every connector secret.
 */

import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SecretsAdapter } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;

function dataDir(): string {
  return (
    process.env.AGENTS_DATA_DIR ?? join(homedir(), ".agents", "data")
  );
}

function secretsDir(): string {
  return join(dataDir(), "secrets");
}

function ensureDir(): void {
  mkdirSync(secretsDir(), { recursive: true, mode: 0o700 });
}

let _masterKey: Buffer | null = null;
let _warnedAboutAutoKey = false;

function loadMasterKey(): Buffer {
  if (_masterKey) return _masterKey;
  ensureDir();
  const envKey = process.env.AGENTS_SECRETS_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, "base64");
    if (buf.length !== 32) {
      throw new Error(
        `AGENTS_SECRETS_KEY must decode to 32 bytes (got ${buf.length}). Mint with: openssl rand -base64 32`,
      );
    }
    _masterKey = buf;
    return buf;
  }
  const keyPath = join(secretsDir(), ".master.key");
  if (existsSync(keyPath)) {
    const buf = Buffer.from(readFileSync(keyPath, "utf-8").trim(), "base64");
    if (buf.length !== 32) {
      throw new Error(`Stored master key at ${keyPath} is malformed`);
    }
    _masterKey = buf;
    return buf;
  }
  // First boot — generate, persist, scream.
  const generated = randomBytes(32);
  writeFileSync(keyPath, generated.toString("base64"));
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // ignore on platforms that reject chmod
  }
  if (!_warnedAboutAutoKey) {
    // eslint-disable-next-line no-console
    console.warn(
      [
        "",
        "==== AGENTS_SECRETS_KEY auto-generated ====",
        `Persisted to ${keyPath}.`,
        "BACK THIS UP NOW. Losing it means every stored secret",
        "(connector tokens, webhook HMACs, repo PATs) becomes unreadable.",
        "",
        "For a stable headless deploy, set AGENTS_SECRETS_KEY explicitly:",
        "  AGENTS_SECRETS_KEY=$(openssl rand -base64 32)",
        "===========================================",
        "",
      ].join("\n"),
    );
    _warnedAboutAutoKey = true;
  }
  _masterKey = generated;
  return generated;
}

interface EncryptedBlob {
  iv: string;
  tag: string;
  ct: string;
}

function parseRef(ref: string): string {
  if (!ref.startsWith("file:")) {
    throw new Error(`expected file:<uuid> ref, got ${ref}`);
  }
  const id = ref.slice("file:".length);
  if (!/^[0-9a-f-]{32,}$/i.test(id)) {
    throw new Error(`malformed file ref id: ${id}`);
  }
  return id;
}

function pathFor(id: string): string {
  return join(secretsDir(), `${id}.json`);
}

async function setSecret(_key: string, value: string): Promise<string> {
  const masterKey = loadMasterKey();
  const id = randomUUID();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ct = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
  ensureDir();
  writeFileSync(pathFor(id), JSON.stringify(blob), { mode: 0o600 });
  try {
    chmodSync(pathFor(id), 0o600);
  } catch {
    // ignore
  }
  return `file:${id}`;
}

async function getSecret(ref: string): Promise<string | null> {
  const id = parseRef(ref);
  const file = pathFor(id);
  if (!existsSync(file)) return null;
  const masterKey = loadMasterKey();
  const blob = JSON.parse(readFileSync(file, "utf-8")) as EncryptedBlob;
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const ct = Buffer.from(blob.ct, "base64");
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf-8");
}

async function deleteSecret(ref: string): Promise<void> {
  try {
    const id = parseRef(ref);
    if (existsSync(pathFor(id))) unlinkSync(pathFor(id));
  } catch {
    // best-effort
  }
}

async function listSecrets(): Promise<string[]> {
  ensureDir();
  return readdirSync(secretsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => `file:${f.replace(/\.json$/, "")}`);
}

export const fileAdapter: SecretsAdapter = {
  set: setSecret,
  get: getSecret,
  delete: deleteSecret,
  list: listSecrets,
};
