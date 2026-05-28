/**
 * Agent memory — per (owner, agent) markdown scratchpad that persists across
 * runs. The senior-engineer template reads MEMORY.md at run start and is
 * instructed to update it before exiting; the worker reads the file back
 * and saves it after the run finishes.
 *
 * Contract: agents write their own memory. Don't add an approval gate —
 * memory is the agent's reasoning scratch, not a side effect.
 */

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";

export type AgentMemory = typeof schema.agentMemory.$inferSelect;

export async function getAgentMemory(
  ownerId: string,
  agentId: string,
): Promise<AgentMemory | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.agentMemory)
    .where(
      and(
        eq(schema.agentMemory.ownerId, ownerId),
        eq(schema.agentMemory.agentId, agentId),
      ),
    )
    .limit(1);
  return row;
}

export async function setAgentMemory(
  ownerId: string,
  agentId: string,
  body: string,
): Promise<AgentMemory> {
  const db = getDb();
  const existing = await getAgentMemory(ownerId, agentId);
  if (existing) {
    const [row] = await db
      .update(schema.agentMemory)
      .set({ body, updatedAt: new Date() })
      .where(
        and(
          eq(schema.agentMemory.ownerId, ownerId),
          eq(schema.agentMemory.agentId, agentId),
        ),
      )
      .returning();
    return row;
  }
  const [row] = await db
    .insert(schema.agentMemory)
    .values({ ownerId, agentId, body })
    .returning();
  return row;
}

export async function deleteAgentMemory(
  ownerId: string,
  agentId: string,
): Promise<boolean> {
  const result = await getDb()
    .delete(schema.agentMemory)
    .where(
      and(
        eq(schema.agentMemory.ownerId, ownerId),
        eq(schema.agentMemory.agentId, agentId),
      ),
    )
    .returning({ agentId: schema.agentMemory.agentId });
  return result.length > 0;
}
