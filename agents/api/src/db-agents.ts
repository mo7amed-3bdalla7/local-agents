/**
 * DB-source agents — materialization helpers.
 *
 * Agents created in the UI live entirely in Postgres (system prompt + config
 * JSON in the `agents` table, source='db'). The runner still expects an
 * `agentDir` on disk for AGENTS.md and per-run logs, so before each run we
 * stage a stable directory at `$HOME/.agents/db-agents/<name>/` and re-write
 * AGENTS.md from the DB. The runner's existing code path then works unchanged.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@agents/core";
import type { AgentConfig } from "@agents/sdk";
import type { AgentEntry } from "./registry.js";

function dbAgentsRoot(): string {
  return (
    process.env.AGENTS_DB_AGENTS_ROOT ?? join(homedir(), ".agents", "db-agents")
  );
}

/**
 * Look up a db-source agent by name. Returns undefined if there's no agent
 * row, or if the row is `source='file'` (those load through the registry).
 *
 * On hit, materializes the synthetic agentDir and refreshes AGENTS.md so a
 * just-edited system prompt is visible to the very next run.
 */
export async function loadDbAgent(name: string): Promise<AgentEntry | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.name, name))
    .limit(1);
  if (!row || row.source !== "db") return undefined;

  const dir = join(dbAgentsRoot(), row.name);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "AGENTS.md"), row.systemPrompt ?? "", "utf-8");

  const json = (row.configJson as Record<string, unknown> | null) ?? {};
  const config: AgentConfig = {
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    schedule: typeof json.schedule === "string" ? json.schedule : undefined,
    triggers: Array.isArray(json.triggers)
      ? (json.triggers as AgentConfig["triggers"])
      : [],
    execution: (json.execution as AgentConfig["execution"]) ?? {},
    maxConcurrency:
      typeof json.maxConcurrency === "number" ? json.maxConcurrency : 1,
    maxQueueSize:
      typeof json.maxQueueSize === "number" ? json.maxQueueSize : undefined,
    // UI-authored agents don't ship a function prompt — the first-turn
    // message is intentionally generic. AGENTS.md does the heavy lifting.
    prompt: () => "Follow the workflow defined in your AGENTS.md.",
  };
  return { config, dir };
}
