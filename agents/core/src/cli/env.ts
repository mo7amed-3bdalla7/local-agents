/**
 * Shared `.env` loader for @agents/core CLIs.
 *
 * Walks up from cwd looking for `pnpm-workspace.yaml` and loads the .env at
 * that root. Lets `pnpm repo ...` and `pnpm pr-activity ...` work from any
 * directory inside the workspace without requiring an env prefix.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadWorkspaceEnv(): void {
  let dir = process.cwd();
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      const envPath = resolve(dir, ".env");
      if (existsSync(envPath)) {
        try {
          process.loadEnvFile(envPath);
        } catch {
          // .env is optional
        }
      }
      return;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) return;
    dir = parent;
  }
}
