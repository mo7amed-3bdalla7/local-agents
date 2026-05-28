/**
 * /api/agents/:id/memory — read/clear the agent's per-owner scratchpad
 * (MEMORY.md). Writes happen implicitly when the agent edits MEMORY.md
 * during a run; this surface lets users inspect and reset between runs.
 */

import { Hono } from "hono";
import {
  and,
  eq,
  isNull,
  or,
} from "drizzle-orm";
import {
  deleteAgentMemory,
  getAgentMemory,
  getDb,
  schema,
  setAgentMemory,
} from "@agents/core";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";

export const agentMemoryRouter = new Hono();

function visibleAgent(userId: string) {
  return or(isNull(schema.agents.ownerId), eq(schema.agents.ownerId, userId));
}

async function assertAgentVisible(id: string, userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleAgent(userId)))
    .limit(1);
  return Boolean(row);
}

agentMemoryRouter.get("/:id/memory", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const userId = currentUserId(c);
  if (!(await assertAgentVisible(id, userId))) {
    return c.json({ error: "agent_not_found" }, 404);
  }
  const row = await getAgentMemory(userId, id);
  return c.json({ body: row?.body ?? "", updatedAt: row?.updatedAt ?? null });
});

agentMemoryRouter.put("/:id/memory", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const userId = currentUserId(c);
  if (!(await assertAgentVisible(id, userId))) {
    return c.json({ error: "agent_not_found" }, 404);
  }
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) {
    await deleteAgentMemory(userId, id);
    return c.json({ body: "", updatedAt: null });
  }
  const row = await setAgentMemory(userId, id, text);
  return c.json({ body: row.body, updatedAt: row.updatedAt });
});
