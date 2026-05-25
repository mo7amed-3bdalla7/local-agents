/**
 * Filesystem → DB agent sync.
 *
 * Walks `agents/<name>/dist/agent.config.js` via the scheduler's existing
 * discovery and upserts file-based agents into the `agents` table on each
 * api boot. The DB stays the read source for the UI; the filesystem is the
 * source of truth for file-defined agents.
 */

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { discoverAgents } from "@agents/scheduler";
import { logger, type AgentConfig } from "@agents/sdk";
import { getDb, schema } from "@agents/core";
import { clearRegistry, registerAgent } from "./registry.js";

export interface SyncResult {
  discovered: number;
  inserted: number;
  updated: number;
  disabled: number;
}

function agentsRoot(): string {
  if (process.env.AGENTS_ROOT) return resolve(process.env.AGENTS_ROOT);
  // Walk up from cwd looking for `<root>/agents/` next to pnpm-workspace.yaml.
  // Robust when the api is run from a sub-package (tsx watch in agents/api).
  let dir = process.cwd();
  while (true) {
    const candidate = resolve(dir, "agents");
    if (
      existsSync(candidate) &&
      existsSync(resolve(dir, "pnpm-workspace.yaml"))
    ) {
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), "agents");
}

async function readSystemPrompt(agentDir: string): Promise<string | null> {
  const path = resolve(agentDir, "AGENTS.md");
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function configForDb(config: AgentConfig): unknown {
  // Strip non-serializable fields (function prompts) before persisting.
  const { prompt, ...serializable } = config;
  return {
    ...serializable,
    promptKind: typeof prompt === "function" ? "function" : typeof prompt,
  };
}

export async function syncFileAgents(): Promise<SyncResult> {
  const root = agentsRoot();
  const discovered = await discoverAgents(root);
  const db = getDb();

  clearRegistry();

  let inserted = 0;
  let updated = 0;
  const seenNames = new Set<string>();

  for (const { config, dir } of discovered) {
    seenNames.add(config.name);
    registerAgent({ config, dir });
    const systemPrompt = await readSystemPrompt(dir);
    const payload = {
      name: config.name,
      description: config.description,
      source: "file" as const,
      systemPrompt,
      configJson: configForDb(config),
      enabled: config.enabled !== false,
      updatedAt: new Date(),
    };

    const existing = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.name, config.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(schema.agents).values(payload);
      inserted++;
    } else {
      await db
        .update(schema.agents)
        .set(payload)
        .where(eq(schema.agents.name, config.name));
      updated++;
    }
  }

  // Disable file-source agents that no longer exist on disk. We don't delete —
  // their sessions/runs FK back here. Disabled rows hide from the active list
  // but stay queryable from history views.
  const disableResult = await db
    .update(schema.agents)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      sql`${schema.agents.source} = 'file' AND ${schema.agents.name} NOT IN ${
        seenNames.size === 0
          ? sql`(SELECT NULL WHERE FALSE)`
          : sql`(${sql.join(
              [...seenNames].map((n) => sql`${n}`),
              sql.raw(", "),
            )})`
      } AND ${schema.agents.enabled} = true`,
    );

  const disabled =
    typeof (disableResult as { count?: number }).count === "number"
      ? (disableResult as { count: number }).count
      : 0;

  logger.info("File-agent sync complete", {
    discovered: discovered.length,
    inserted,
    updated,
    disabled,
  });

  return {
    discovered: discovered.length,
    inserted,
    updated,
    disabled,
  };
}
