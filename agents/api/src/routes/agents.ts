import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@agents/core";

export const agentsRouter = new Hono();

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

  return c.json({ agent, recentSessions, recentRuns });
});

agentsRouter.post("/:id/run", (c) =>
  c.json(
    {
      error: "not_implemented",
      message:
        "Run-triggering via the API needs the SDK runner to be wired to the Postgres queue. " +
        "Until that lands, trigger agents via `pnpm agent-run -- <name>` from the CLI.",
    },
    501,
  ),
);
