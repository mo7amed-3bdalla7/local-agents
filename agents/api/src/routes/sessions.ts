import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@agents/core";
import { isUuid } from "../util.js";

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
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }
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
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }
  const limitParam = Number(c.req.query("limit") ?? "500");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 5000)
    : 500;

  const [session] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) {
    return c.json({ error: "session not found" }, 404);
  }

  const events = await db
    .select()
    .from(schema.sessionEvents)
    .where(eq(schema.sessionEvents.sessionId, id))
    .orderBy(asc(schema.sessionEvents.id))
    .limit(limit);
  return c.json({ events });
});

/**
 * Server-Sent Events stream for a session.
 *
 * Pushes every existing event on connect (so a late subscriber sees the full
 * timeline), then polls the DB at SSE_POLL_INTERVAL_MS for new rows (gt
 * lastEventId) and pushes them as they appear. Closes the stream with a
 * `done` event once the session reaches a terminal state and no new events
 * have arrived for one poll cycle.
 *
 * Polling rather than LISTEN/NOTIFY keeps the worker code unchanged; the
 * latency floor is the poll interval (default 500ms) — plenty live for the
 * UI's purpose.
 */
const SSE_POLL_INTERVAL_MS = Number(process.env.SSE_POLL_INTERVAL_MS ?? 500);

sessionsRouter.get("/:id/stream", (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json({ error: "invalid_id", message: "id must be a UUID" }, 400);
  }

  return streamSSE(c, async (stream) => {
    const db = getDb();
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    // Confirm the session exists up front; emit an error event + close
    // otherwise so the client knows to stop.
    const [session] = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .limit(1);
    if (!session) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: "session not found" }),
      });
      return;
    }

    let lastEventId = 0;
    let lastEmptyCycleWasTerminal = false;

    while (!aborted) {
      const newEvents = await db
        .select()
        .from(schema.sessionEvents)
        .where(
          and(
            eq(schema.sessionEvents.sessionId, id),
            gt(schema.sessionEvents.id, lastEventId),
          ),
        )
        .orderBy(asc(schema.sessionEvents.id))
        .limit(500);

      for (const e of newEvents) {
        if (aborted) return;
        await stream.writeSSE({
          id: String(e.id),
          event: "event",
          data: JSON.stringify(e),
        });
        lastEventId = e.id;
      }

      // Decide whether to keep polling: only after we've seen no new rows
      // AND the session is terminal AND we already saw a quiet cycle
      // (debounce against the writer + reader racing the status flip).
      if (newEvents.length === 0) {
        const [s] = await db
          .select({ status: schema.sessions.status })
          .from(schema.sessions)
          .where(eq(schema.sessions.id, id))
          .limit(1);
        const terminal = s && s.status !== "active";
        if (terminal && lastEmptyCycleWasTerminal) {
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ status: s.status }),
          });
          return;
        }
        lastEmptyCycleWasTerminal = Boolean(terminal);
      } else {
        lastEmptyCycleWasTerminal = false;
      }

      await stream.sleep(SSE_POLL_INTERVAL_MS);
    }
  });
});
