/**
 * Shared dispatcher: how every trigger type (cron, webhook, file, github)
 * turns "this trigger fired for agent X" into a row in the `runs` table.
 *
 * The worker picks up from there — triggers do NOT execute agents directly.
 * That keeps the trigger layer dumb and durable: if the api crashes between
 * "trigger fires" and "agent finishes", the pending run survives.
 */

import { eq } from "drizzle-orm";
import { logger, type TriggerContext } from "@agents/sdk";
import { getDb, schema } from "@agents/core";

/**
 * Enqueue a run for the given agent. Lookups the agent row by name (triggers
 * are keyed by name; the DB id is internal) and INSERTs into runs.
 *
 * Returns the new run id, or undefined if the agent doesn't exist / is
 * disabled. Doesn't throw — trigger callbacks are noisy by nature; one
 * misconfigured agent shouldn't take the whole trigger loop down.
 */
export async function enqueueRun(
  agentName: string,
  triggerContext: TriggerContext,
): Promise<number | undefined> {
  try {
    const db = getDb();
    const [agent] = await db
      .select({
        id: schema.agents.id,
        enabled: schema.agents.enabled,
      })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .limit(1);

    if (!agent) {
      logger.warn("Trigger fired for unknown agent", { agentName });
      return undefined;
    }
    if (!agent.enabled) {
      logger.info("Trigger fired for disabled agent — skipping", { agentName });
      return undefined;
    }

    const [row] = await db
      .insert(schema.runs)
      .values({
        agentId: agent.id,
        status: "pending",
        triggerContext,
      })
      .returning({ id: schema.runs.id });

    logger.info("Trigger enqueued run", {
      agentName,
      runId: row.id,
      triggerType: triggerContext.triggerType,
    });
    return row.id;
  } catch (err) {
    logger.error("Trigger dispatch failed", {
      agentName,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
