/**
 * Trigger orchestrator.
 *
 * Called once at api boot, after syncFileAgents has populated the registry
 * AND after syncSkills/etc. Collects every agent's triggers and registers
 * them with the right module. Returns a `stop()` for graceful shutdown.
 *
 * Sources both file-source agents (from the in-memory registry) and any
 * db-source agents (configJson.triggers in the DB row).
 */

import { eq } from "drizzle-orm";
import {
  logger,
  type AgentConfig,
  type CronTrigger,
  type Trigger,
} from "@agents/sdk";
import { getDb, schema } from "@agents/core";
import { registeredNames, getAgent } from "../registry.js";
import { registerCronTriggers, stopAllCronTasks } from "./cron.js";

export interface TriggersHandle {
  stop: () => Promise<void>;
}

function isCron(t: Trigger): t is CronTrigger {
  return t.type === "cron";
}

interface CollectedAgent {
  name: string;
  triggers: Trigger[];
}

async function collectAgents(): Promise<CollectedAgent[]> {
  const out: CollectedAgent[] = [];

  // File-source agents — registry holds the live AgentConfig objects.
  for (const name of registeredNames()) {
    const entry = getAgent(name);
    if (!entry) continue;
    out.push({ name, triggers: entry.config.triggers ?? [] });
  }

  // DB-source agents — read triggers out of configJson.
  const dbAgents = await getDb()
    .select({
      name: schema.agents.name,
      configJson: schema.agents.configJson,
    })
    .from(schema.agents)
    .where(eq(schema.agents.source, "db"));
  for (const row of dbAgents) {
    const cfg = (row.configJson as { triggers?: AgentConfig["triggers"] }) ?? {};
    out.push({ name: row.name, triggers: cfg.triggers ?? [] });
  }

  return out;
}

export async function registerAllTriggers(): Promise<TriggersHandle> {
  const agents = await collectAgents();

  const cronAgents = agents
    .map((a) => ({ name: a.name, triggers: a.triggers.filter(isCron) }))
    .filter((a) => a.triggers.length > 0);
  const cronCount = registerCronTriggers(cronAgents);

  logger.info("Triggers registered", {
    agents: agents.length,
    cronCount,
  });

  return {
    async stop() {
      stopAllCronTasks();
    },
  };
}
