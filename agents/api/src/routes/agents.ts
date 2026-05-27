import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { logger } from "@agents/sdk";
import { getDb, schema } from "@agents/core";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";
import { reloadAllTriggers } from "../triggers/index.js";

/**
 * Ownership policy on agents:
 *   - file-source agents (ownerId IS NULL) are shared baseline — visible to
 *     everyone, read-only via the API regardless of who you are.
 *   - db-source agents (ownerId = some user) are private to that user.
 *
 * For list endpoints this becomes `WHERE ownerId IS NULL OR ownerId = me`.
 * For mutating endpoints we additionally check the row's ownerId matches
 * the caller after the file-source-readonly guard runs.
 */
function visibleToUser(userId: string) {
  return or(isNull(schema.agents.ownerId), eq(schema.agents.ownerId, userId));
}

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

/**
 * Look up the agent row + check visibility. 404s on non-existent OR not-
 * visible (treating "you can't see this" identically to "doesn't exist" so
 * we don't leak other users' agent ids by probing).
 */
async function loadAgent(c: Context, id: string) {
  if (!isUuid(id)) {
    return { error: { status: 400 as const, body: { error: "invalid_id", message: "id must be a UUID" } } };
  }
  const userId = currentUserId(c);
  const [agent] = await getDb()
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      enabled: schema.agents.enabled,
      source: schema.agents.source,
      ownerId: schema.agents.ownerId,
    })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleToUser(userId)))
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
      ownerId: currentUserId(c),
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
  const userId = currentUserId(c);
  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleToUser(userId)))
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
  if (existing.ownerId !== userId) {
    return c.json({ error: "forbidden", message: "not your agent" }, 403);
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
  const userId = currentUserId(c);
  const [existing] = await db
    .select({
      id: schema.agents.id,
      source: schema.agents.source,
      ownerId: schema.agents.ownerId,
    })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleToUser(userId)))
    .limit(1);
  if (!existing) return c.json({ error: "agent not found" }, 404);
  if (existing.source !== "db") {
    return c.json(
      { error: "read_only", message: "file-source agents cannot be deleted via the API" },
      409,
    );
  }
  if (existing.ownerId !== userId) {
    return c.json({ error: "forbidden", message: "not your agent" }, 403);
  }
  await db.delete(schema.agents).where(eq(schema.agents.id, id));
  reloadTriggersInBackground(`agent deleted: ${id}`);
  return c.body(null, 204);
});

agentsRouter.get("/", async (c) => {
  const db = getDb();
  const userId = currentUserId(c);
  const rows = await db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      description: schema.agents.description,
      source: schema.agents.source,
      enabled: schema.agents.enabled,
      updatedAt: schema.agents.updatedAt,
      configJson: schema.agents.configJson,
    })
    .from(schema.agents)
    .where(visibleToUser(userId))
    .orderBy(schema.agents.name);
  const agents = rows.map(({ configJson, ...rest }) => ({
    ...rest,
    dryRun: isDryRun(configJson),
    maxCostUsd: getMaxCostUsd(configJson),
  }));
  return c.json({ agents });
});

function isDryRun(configJson: unknown): boolean {
  if (!configJson || typeof configJson !== "object") return false;
  const exec = (configJson as { execution?: { dryRun?: unknown } }).execution;
  return exec?.dryRun === true;
}

function getMaxCostUsd(configJson: unknown): number | null {
  if (!configJson || typeof configJson !== "object") return null;
  const exec = (configJson as { execution?: { maxCostUsd?: unknown } })
    .execution;
  return typeof exec?.maxCostUsd === "number" && exec.maxCostUsd > 0
    ? exec.maxCostUsd
    : null;
}

agentsRouter.get("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }
  const userId = currentUserId(c);
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleToUser(userId)))
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
  const { error, agent } = await loadAgent(c, c.req.param("id"));
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
  const { error, agent } = await loadAgent(c, c.req.param("id"));
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
  const { error, agent } = await loadAgent(c, c.req.param("id"));
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
  const { error, agent } = await loadAgent(c, c.req.param("id"));
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
  const { error, agent } = await loadAgent(c, c.req.param("id"));
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
  const { error, agent } = await loadAgent(c, c.req.param("id"));
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
  const userId = currentUserId(c);
  const [agent] = await db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      enabled: schema.agents.enabled,
    })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleToUser(userId)))
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

/**
 * GET /:id/stats — aggregate run metrics for a single agent.
 *
 * Returns counts by status, p50/p95 duration, total cost, plus the last 5
 * failures with their error message so the user has something to click into.
 * Ownership-scoped — file-source + own db-source agents only.
 */
agentsRouter.get("/:id/stats", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id" }, 400);
  }
  const db = getDb();
  const userId = currentUserId(c);

  const [agent] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleToUser(userId)))
    .limit(1);
  if (!agent) return c.json({ error: "agent not found" }, 404);

  // Aggregates pulled in one query for cheapness. postgres-js returns
  // numerics as strings — cast inside SQL so the body parses cleanly.
  const [totals] = (await db.execute(sql`
    SELECT
      COUNT(*)::int                                                   AS total,
      COUNT(*) FILTER (WHERE status = 'success')::int                 AS successes,
      COUNT(*) FILTER (WHERE status IN ('failure','timeout','aborted'))::int AS failures,
      COUNT(*) FILTER (WHERE status IN ('pending','active'))::int     AS in_flight,
      COALESCE(SUM(cost_usd), 0)::float                               AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0)::int                             AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::int                            AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0)::int                        AS cache_read_tokens,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms)::int  AS p50_duration_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int  AS p95_duration_ms,
      MAX(created_at)                                                 AS last_run_at
    FROM runs
    WHERE agent_id = ${id}
  `)) as unknown as Array<{
    total: number;
    successes: number;
    failures: number;
    in_flight: number;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    p50_duration_ms: number | null;
    p95_duration_ms: number | null;
    last_run_at: string | null;
  }>;

  const recentFailures = await db
    .select({
      id: schema.runs.id,
      status: schema.runs.status,
      error: schema.runs.error,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.agentId, id),
        inArray(schema.runs.status, ["failure", "timeout", "aborted"] as const),
      ),
    )
    .orderBy(desc(schema.runs.createdAt))
    .limit(5);

  const t = totals ?? {
    total: 0,
    successes: 0,
    failures: 0,
    in_flight: 0,
    total_cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    p50_duration_ms: null,
    p95_duration_ms: null,
    last_run_at: null,
  };

  return c.json({
    stats: {
      total: t.total,
      successes: t.successes,
      failures: t.failures,
      inFlight: t.in_flight,
      successRate: t.total > 0 ? t.successes / t.total : null,
      totalCostUsd: t.total_cost_usd,
      inputTokens: t.input_tokens,
      outputTokens: t.output_tokens,
      cacheReadTokens: t.cache_read_tokens,
      p50DurationMs: t.p50_duration_ms,
      p95DurationMs: t.p95_duration_ms,
      lastRunAt: t.last_run_at,
    },
    recentFailures,
  });
});
