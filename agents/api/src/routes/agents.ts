import { Hono, type Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "@agents/sdk";
import { getDb, schema } from "@agents/core";
import { isUuid } from "../util.js";
import { reloadAllTriggers } from "../triggers/index.js";

/**
 * Fire-and-forget trigger reload after agent CRUD so a freshly created /
 * updated / deleted agent's triggers register without a process restart.
 * Runs in the background; failure is logged but doesn't fail the request.
 */
function reloadTriggersInBackground(reason: string): void {
  void reloadAllTriggers().catch((err) =>
    logger.warn("Trigger reload failed", {
      reason,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

export const agentsRouter = new Hono();

/** Look up the agent row and return 400/404 in a uniform shape. */
async function loadAgent(id: string) {
  if (!isUuid(id)) {
    return { error: { status: 400 as const, body: { error: "invalid_id", message: "id must be a UUID" } } };
  }
  const [agent] = await getDb()
    .select({ id: schema.agents.id, name: schema.agents.name, enabled: schema.agents.enabled })
    .from(schema.agents)
    .where(eq(schema.agents.id, id))
    .limit(1);
  if (!agent) {
    return { error: { status: 404 as const, body: { error: "agent not found" } } };
  }
  return { agent };
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

agentsRouter.post("/", async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body", message: "body must be JSON" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!NAME_PATTERN.test(name)) {
    return c.json(
      {
        error: "invalid_name",
        message:
          "name must be 1-63 chars, start with a letter or digit, and contain only [a-z0-9-]",
      },
      400,
    );
  }
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return c.json(
      { error: "invalid_description", message: "description is required" },
      400,
    );
  }
  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt : null;
  const configJson =
    body.configJson && typeof body.configJson === "object" && !Array.isArray(body.configJson)
      ? (body.configJson as Record<string, unknown>)
      : {};

  const db = getDb();
  // Reject collisions early with a clean 409 instead of letting the unique
  // constraint blow up as a 500.
  const [existing] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.name, name))
    .limit(1);
  if (existing) {
    return c.json({ error: "name_taken", message: `agent "${name}" already exists` }, 409);
  }

  const [row] = await db
    .insert(schema.agents)
    .values({
      name,
      description,
      source: "db",
      systemPrompt,
      configJson,
      enabled: true,
    })
    .returning();
  reloadTriggersInBackground(`agent created: ${row.name}`);
  return c.json({ agent: row }, 201);
});

agentsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body", message: "body must be JSON" }, 400);
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "agent not found" }, 404);
  if (existing.source !== "db") {
    return c.json(
      {
        error: "read_only",
        message:
          "file-source agents are read-only; edit the source files and rebuild",
      },
      409,
    );
  }

  const update: Partial<typeof schema.agents.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.description === "string") {
    const trimmed = body.description.trim();
    if (!trimmed) {
      return c.json({ error: "invalid_description" }, 400);
    }
    update.description = trimmed;
  }
  if (body.systemPrompt === null || typeof body.systemPrompt === "string") {
    update.systemPrompt = body.systemPrompt as string | null;
  }
  if (
    body.configJson &&
    typeof body.configJson === "object" &&
    !Array.isArray(body.configJson)
  ) {
    update.configJson = body.configJson as Record<string, unknown>;
  }
  if (typeof body.enabled === "boolean") {
    update.enabled = body.enabled;
  }

  const [row] = await db
    .update(schema.agents)
    .set(update)
    .where(eq(schema.agents.id, id))
    .returning();
  // Reload only when something that triggers care about changed.
  if (update.configJson !== undefined || update.enabled !== undefined) {
    reloadTriggersInBackground(`agent updated: ${row.name}`);
  }
  return c.json({ agent: row });
});

agentsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.agents.id, source: schema.agents.source })
    .from(schema.agents)
    .where(eq(schema.agents.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "agent not found" }, 404);
  if (existing.source !== "db") {
    return c.json(
      { error: "read_only", message: "file-source agents cannot be deleted via the API" },
      409,
    );
  }
  await db.delete(schema.agents).where(eq(schema.agents.id, id));
  reloadTriggersInBackground(`agent deleted: ${id}`);
  return c.body(null, 204);
});

agentsRouter.get("/", async (c) => {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      description: schema.agents.description,
      source: schema.agents.source,
      enabled: schema.agents.enabled,
      updatedAt: schema.agents.updatedAt,
    })
    .from(schema.agents)
    .orderBy(schema.agents.name);
  return c.json({ agents: rows });
});

agentsRouter.get("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id))
    .limit(1);
  if (!agent) {
    return c.json({ error: "agent not found" }, 404);
  }

  const recentSessions = await db
    .select({
      id: schema.sessions.id,
      status: schema.sessions.status,
      startedAt: schema.sessions.startedAt,
      finishedAt: schema.sessions.finishedAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.agentId, id))
    .orderBy(desc(schema.sessions.startedAt))
    .limit(10);

  const recentRuns = await db
    .select({
      id: schema.runs.id,
      status: schema.runs.status,
      createdAt: schema.runs.createdAt,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      durationMs: schema.runs.durationMs,
      error: schema.runs.error,
    })
    .from(schema.runs)
    .where(eq(schema.runs.agentId, id))
    .orderBy(desc(schema.runs.createdAt))
    .limit(10);

  const skills = await db
    .select({
      skill: schema.skills,
      enabled: schema.agentSkills.enabled,
    })
    .from(schema.agentSkills)
    .innerJoin(
      schema.skills,
      eq(schema.skills.name, schema.agentSkills.skillName),
    )
    .where(eq(schema.agentSkills.agentId, id))
    .orderBy(schema.skills.name);

  const connectors = await db
    .select({
      connector: schema.connectors,
      enabled: schema.agentConnectors.enabled,
    })
    .from(schema.agentConnectors)
    .innerJoin(
      schema.connectors,
      eq(schema.connectors.id, schema.agentConnectors.connectorId),
    )
    .where(eq(schema.agentConnectors.agentId, id))
    .orderBy(schema.connectors.displayName);

  const mcpServers = await db
    .select({
      mcpServer: schema.mcpServers,
      enabled: schema.agentMcpServers.enabled,
    })
    .from(schema.agentMcpServers)
    .innerJoin(
      schema.mcpServers,
      eq(schema.mcpServers.id, schema.agentMcpServers.mcpId),
    )
    .where(eq(schema.agentMcpServers.agentId, id))
    .orderBy(schema.mcpServers.name);

  return c.json({
    agent,
    recentSessions,
    recentRuns,
    skills,
    connectors,
    mcpServers,
  });
});

// ---------------------------------------------------------------------------
// Per-agent capability links
//
// Three registries (skills, connectors, mcp servers) attach to an agent via
// join tables. PUT idempotently attaches (and accepts an optional `enabled`
// flag in the body); DELETE detaches.
// ---------------------------------------------------------------------------

async function parseEnabled(c: Context): Promise<boolean> {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine — default enabled=true
  }
  if (body && typeof body === "object" && "enabled" in body) {
    return Boolean((body as { enabled: unknown }).enabled);
  }
  return true;
}

agentsRouter.put("/:id/skills/:skillName", async (c) => {
  const { error, agent } = await loadAgent(c.req.param("id"));
  if (error) return c.json(error.body, error.status);
  const skillName = c.req.param("skillName");
  const enabled = await parseEnabled(c);

  const db = getDb();
  const [skill] = await db
    .select({ name: schema.skills.name })
    .from(schema.skills)
    .where(eq(schema.skills.name, skillName))
    .limit(1);
  if (!skill) return c.json({ error: "skill not found" }, 404);

  await db
    .insert(schema.agentSkills)
    .values({ agentId: agent.id, skillName, enabled })
    .onConflictDoUpdate({
      target: [schema.agentSkills.agentId, schema.agentSkills.skillName],
      set: { enabled },
    });
  return c.json({ agentId: agent.id, skillName, enabled }, 200);
});

agentsRouter.delete("/:id/skills/:skillName", async (c) => {
  const { error, agent } = await loadAgent(c.req.param("id"));
  if (error) return c.json(error.body, error.status);
  const skillName = c.req.param("skillName");
  const db = getDb();
  await db
    .delete(schema.agentSkills)
    .where(
      and(
        eq(schema.agentSkills.agentId, agent.id),
        eq(schema.agentSkills.skillName, skillName),
      ),
    );
  return c.body(null, 204);
});

agentsRouter.put("/:id/connectors/:connectorId", async (c) => {
  const { error, agent } = await loadAgent(c.req.param("id"));
  if (error) return c.json(error.body, error.status);
  const connectorId = c.req.param("connectorId");
  if (!isUuid(connectorId)) {
    return c.json({ error: "invalid_id", message: "connectorId must be a UUID" }, 400);
  }
  const enabled = await parseEnabled(c);

  const db = getDb();
  const [connector] = await db
    .select({ id: schema.connectors.id })
    .from(schema.connectors)
    .where(eq(schema.connectors.id, connectorId))
    .limit(1);
  if (!connector) return c.json({ error: "connector not found" }, 404);

  await db
    .insert(schema.agentConnectors)
    .values({ agentId: agent.id, connectorId, enabled })
    .onConflictDoUpdate({
      target: [schema.agentConnectors.agentId, schema.agentConnectors.connectorId],
      set: { enabled },
    });
  return c.json({ agentId: agent.id, connectorId, enabled }, 200);
});

agentsRouter.delete("/:id/connectors/:connectorId", async (c) => {
  const { error, agent } = await loadAgent(c.req.param("id"));
  if (error) return c.json(error.body, error.status);
  const connectorId = c.req.param("connectorId");
  if (!isUuid(connectorId)) {
    return c.json({ error: "invalid_id", message: "connectorId must be a UUID" }, 400);
  }
  const db = getDb();
  await db
    .delete(schema.agentConnectors)
    .where(
      and(
        eq(schema.agentConnectors.agentId, agent.id),
        eq(schema.agentConnectors.connectorId, connectorId),
      ),
    );
  return c.body(null, 204);
});

agentsRouter.put("/:id/mcp-servers/:mcpServerId", async (c) => {
  const { error, agent } = await loadAgent(c.req.param("id"));
  if (error) return c.json(error.body, error.status);
  const mcpServerId = c.req.param("mcpServerId");
  if (!isUuid(mcpServerId)) {
    return c.json({ error: "invalid_id", message: "mcpServerId must be a UUID" }, 400);
  }
  const enabled = await parseEnabled(c);

  const db = getDb();
  const [mcp] = await db
    .select({ id: schema.mcpServers.id })
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.id, mcpServerId))
    .limit(1);
  if (!mcp) return c.json({ error: "mcp server not found" }, 404);

  await db
    .insert(schema.agentMcpServers)
    .values({ agentId: agent.id, mcpId: mcpServerId, enabled })
    .onConflictDoUpdate({
      target: [schema.agentMcpServers.agentId, schema.agentMcpServers.mcpId],
      set: { enabled },
    });
  return c.json({ agentId: agent.id, mcpServerId, enabled }, 200);
});

agentsRouter.delete("/:id/mcp-servers/:mcpServerId", async (c) => {
  const { error, agent } = await loadAgent(c.req.param("id"));
  if (error) return c.json(error.body, error.status);
  const mcpServerId = c.req.param("mcpServerId");
  if (!isUuid(mcpServerId)) {
    return c.json({ error: "invalid_id", message: "mcpServerId must be a UUID" }, 400);
  }
  const db = getDb();
  await db
    .delete(schema.agentMcpServers)
    .where(
      and(
        eq(schema.agentMcpServers.agentId, agent.id),
        eq(schema.agentMcpServers.mcpId, mcpServerId),
      ),
    );
  return c.body(null, 204);
});

agentsRouter.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }

  const db = getDb();
  const [agent] = await db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      enabled: schema.agents.enabled,
    })
    .from(schema.agents)
    .where(eq(schema.agents.id, id))
    .limit(1);

  if (!agent) {
    return c.json({ error: "agent not found" }, 404);
  }
  if (!agent.enabled) {
    return c.json({ error: "agent_disabled" }, 409);
  }

  const triggerContext = {
    triggerType: "manual" as const,
    triggeredAt: new Date().toISOString(),
    meta: { source: "api" },
  };

  const [run] = await db
    .insert(schema.runs)
    .values({
      agentId: agent.id,
      status: "pending",
      triggerContext,
    })
    .returning({ id: schema.runs.id });

  return c.json({ runId: run.id, status: "pending" }, 202);
});
