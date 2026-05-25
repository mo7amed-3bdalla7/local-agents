import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Walk up from cwd looking for the pnpm-workspace.yaml marker. Lets the api
 * boot from either the repo root or the agents/api sub-package without
 * resolving paths differently in each call site.
 */
export function workspaceRoot(): string {
  if (process.env.WORKSPACE_ROOT) return resolve(process.env.WORKSPACE_ROOT);
  let dir = process.cwd();
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
