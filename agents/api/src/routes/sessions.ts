import { Hono } from "hono";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@agents/core";

export const sessionsRouter = new Hono();

sessionsRouter.get("/", async (c) => {
  const db = getDb();
  const limitParam = Number(c.req.query("limit") ?? "50");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 200)
    : 50;

  const rows = await db
    .select({
      id: schema.sessions.id,
      agentId: schema.sessions.agentId,
      agentName: schema.agents.name,
      status: schema.sessions.status,
      startedAt: schema.sessions.startedAt,
      finishedAt: schema.sessions.finishedAt,
    })
    .from(schema.sessions)
    .leftJoin(schema.agents, eq(schema.sessions.agentId, schema.agents.id))
    .orderBy(desc(schema.sessions.startedAt))
    .limit(limit);

  return c.json({ sessions: rows });
});

sessionsRouter.get("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) {
    return c.json({ error: "session not found" }, 404);
  }
  return c.json({ session });
});

sessionsRouter.get("/:id/events", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const limitParam = Number(c.req.query("limit") ?? "500");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 5000)
    : 500;

  const events = await db
    .select()
    .from(schema.sessionEvents)
    .where(eq(schema.sessionEvents.sessionId, id))
    .orderBy(asc(schema.sessionEvents.id))
    .limit(limit);
  return c.json({ events });
});
