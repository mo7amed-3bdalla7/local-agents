/**
 * Read-only routers for connectors, skills, MCP servers, repos, PR activity, runs.
 *
 * All tables are queryable; mutation endpoints land alongside their owning
 * registries (commit 5+ for connectors, skill registry commit, MCP commit).
 */

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@agents/core";

export const connectorsRouter = new Hono();
connectorsRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.connectors)
    .orderBy(schema.connectors.displayName);
  return c.json({ connectors: rows });
});

export const skillsRouter = new Hono();
skillsRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.skills)
    .orderBy(schema.skills.name);
  return c.json({ skills: rows });
});

export const mcpRouter = new Hono();
mcpRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.mcpServers)
    .orderBy(schema.mcpServers.name);
  return c.json({ mcpServers: rows });
});

export const reposRouter = new Hono();
reposRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.repos)
    .orderBy(schema.repos.githubFullName);
  return c.json({ repos: rows });
});

export const prActivityRouter = new Hono();
prActivityRouter.get("/", async (c) => {
  const limitParam = Number(c.req.query("limit") ?? "100");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 500)
    : 100;
  const rows = await getDb()
    .select()
    .from(schema.prActivity)
    .orderBy(desc(schema.prActivity.createdAt))
    .limit(limit);
  return c.json({ prActivity: rows });
});

export const runsRouter = new Hono();
runsRouter.get("/", async (c) => {
  const db = getDb();
  const agentId = c.req.query("agentId");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "100"), 1), 500);

  const query = db
    .select({
      id: schema.runs.id,
      agentId: schema.runs.agentId,
      agentName: schema.agents.name,
      sessionId: schema.runs.sessionId,
      status: schema.runs.status,
      createdAt: schema.runs.createdAt,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      durationMs: schema.runs.durationMs,
      error: schema.runs.error,
    })
    .from(schema.runs)
    .leftJoin(schema.agents, eq(schema.runs.agentId, schema.agents.id))
    .orderBy(desc(schema.runs.createdAt))
    .limit(limit);

  const rows = agentId
    ? await query.where(eq(schema.runs.agentId, agentId))
    : await query;
  return c.json({ runs: rows });
});
