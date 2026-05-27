/**
 * CLI config — `{ api, token }` stored at `~/.config/agents/config.json`.
 *
 * Env vars override file values:
 *   AGENTS_API     — base URL (default: http://localhost:3848)
 *   AGENTS_TOKEN   — Bearer token, used as `Authorization: Bearer <tok>`
 *   AGENTS_CONFIG  — override the config file path
 *
 * Permissions: the file is written 0600 to keep the token off other users.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

export interface CliConfig {
  api: string;
  token?: string;
}

const DEFAULT_API = "http://localhost:3848";

export function configPath(): string {
  return (
    process.env.AGENTS_CONFIG ??
    join(homedir(), ".config", "agents", "config.json")
  );
}

export function loadConfig(): CliConfig {
  let file: Partial<CliConfig> = {};
  try {
    const raw = readFileSync(configPath(), "utf-8");
    file = JSON.parse(raw) as Partial<CliConfig>;
  } catch {
    // missing or unreadable — fall through to env / defaults
  }
  return {
    api: process.env.AGENTS_API ?? file.api ?? DEFAULT_API,
    token: process.env.AGENTS_TOKEN ?? file.token,
  };
}

export function saveConfig(cfg: CliConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2));
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows or sandboxed envs may reject chmod — best-effort.
  }
}
