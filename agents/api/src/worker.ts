/**
 * Postgres-backed run worker.
 *
 * Polls `runs WHERE status='pending'` in FIFO order, claims one at a time with
 * `FOR UPDATE SKIP LOCKED`, creates the matching `sessions` row, dispatches
 * into the SDK `executeAgent()` with an onEvent hook that persists each
 * SDK message into `session_events`, then finalizes both rows on completion.
 *
 * Single-instance for slice-1 — one worker, one in-flight run at a time.
 * Multi-worker safety is already built in via SKIP LOCKED + the worker only
 * touching rows it successfully claimed.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  executeAgent,
  logger,
  type McpServerConfig,
  type RunEvent,
  type TriggerContext,
} from "@agents/sdk";
import { getDb, schema } from "@agents/core";
import { loadDbAgent } from "./db-agents.js";
import { getAgent } from "./registry.js";
import { fireAgentPipeline } from "./triggers/agent-pipeline.js";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 500);

/**
 * AbortControllers for runs the worker has claimed. Populated by processRun
 * when it starts a run, deleted in its finally. The api's abort route uses
 * this to signal cancellation by run id.
 *
 * Module-level (not per-worker) so the api server route can find any in-flight
 * run regardless of which worker instance claimed it. Single-worker for now,
 * but the multi-worker case will need a row-level lock + IPC; abort would
 * become a Postgres NOTIFY in that world.
 */
const activeAborts = new Map<number, AbortController>();

/**
 * Signal an in-flight run to stop. Returns true if a controller was found
 * and aborted; false if the run isn't in flight on THIS process (already
 * done, pending in the queue, or running on another worker).
 */
export function abortRun(runId: number): boolean {
  const ctl = activeAborts.get(runId);
  if (!ctl) return false;
  ctl.abort();
  return true;
}

export interface WorkerHandle {
  stop: () => Promise<void>;
}

interface ClaimedRun {
  id: number;
  agentId: string;
  triggerContext: TriggerContext;
  startedAt: Date;
}

interface ActiveRun {
  runId: number;
  sessionId: string;
  abort: AbortController;
  promise: Promise<void>;
}

/**
 * Atomically claim the oldest pending run. SKIP LOCKED so concurrent workers
 * (future) never block on a row another worker holds.
 *
 * Note: the postgres-js driver returns drizzle's `db.execute()` result as an
 * array of plain row objects — no `{ rows: [...] }` wrapper.
 */
async function claimNextPending(): Promise<ClaimedRun | undefined> {
  const db = getDb();
  const rows = (await db.execute(sql`
    UPDATE runs
       SET status = 'active', started_at = NOW()
     WHERE id = (
       SELECT id FROM runs
        WHERE status = 'pending'
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
 RETURNING id, agent_id, trigger_context, started_at
  `)) as unknown as Array<{
    id: number | string;
    agent_id: string;
    trigger_context: TriggerContext;
    started_at: Date | string;
  }>;
  const row = rows[0];
  if (!row) return undefined;
  // Raw SQL via postgres-js skips drizzle's timestamp → Date mapping; normalize.
  const startedAt = row.started_at instanceof Date
    ? row.started_at
    : new Date(row.started_at);
  return {
    id: Number(row.id),
    agentId: row.agent_id,
    triggerContext: row.trigger_context,
    startedAt,
  };
}

/**
 * Mark any rows the previous worker left in `active` as failed. Without this,
 * runs orphaned by a crash would stay `active` forever and never finish.
 */
async function recoverOrphanedRuns(): Promise<void> {
  const db = getDb();
  const now = new Date();
  const recoveredRuns = await db
    .update(schema.runs)
    .set({
      status: "failure",
      finishedAt: now,
      error: "Interrupted by api restart",
    })
    .where(eq(schema.runs.status, "active"))
    .returning({ id: schema.runs.id });
  if (recoveredRuns.length > 0) {
    logger.warn("Recovered orphaned active runs", { count: recoveredRuns.length });
  }
  const recoveredSessions = await db
    .update(schema.sessions)
    .set({ status: "failed", finishedAt: now })
    .where(eq(schema.sessions.status, "active"))
    .returning({ id: schema.sessions.id });
  if (recoveredSessions.length > 0) {
    logger.warn("Recovered orphaned active sessions", {
      count: recoveredSessions.length,
    });
  }
}

/**
 * Load the names of the agent's attached + enabled skills. Passed to the SDK's
 * `query({ skills })` option so only these skills load into the agent's system
 * prompt; the rest of the discovered registry stays hidden.
 */
async function loadAttachedSkills(agentId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ name: schema.skills.name })
    .from(schema.agentSkills)
    .innerJoin(
      schema.skills,
      eq(schema.skills.name, schema.agentSkills.skillName),
    )
    .where(
      and(
        eq(schema.agentSkills.agentId, agentId),
        eq(schema.agentSkills.enabled, true),
        eq(schema.skills.enabled, true),
      ),
    );
  return rows.map((r) => r.name);
}

/**
 * Load the agent's attached + enabled MCP servers and translate the DB
 * config_json into the SDK's `mcpServers` shape (keyed by server name,
 * with the `type` discriminator on each entry).
 */
async function loadAttachedMcpServers(
  agentId: string,
): Promise<Record<string, McpServerConfig>> {
  const rows = await getDb()
    .select({
      name: schema.mcpServers.name,
      transport: schema.mcpServers.transport,
      configJson: schema.mcpServers.configJson,
      attachedEnabled: schema.agentMcpServers.enabled,
      registryEnabled: schema.mcpServers.enabled,
    })
    .from(schema.agentMcpServers)
    .innerJoin(
      schema.mcpServers,
      eq(schema.mcpServers.id, schema.agentMcpServers.mcpId),
    )
    .where(
      and(
        eq(schema.agentMcpServers.agentId, agentId),
        eq(schema.agentMcpServers.enabled, true),
        eq(schema.mcpServers.enabled, true),
      ),
    );

  const out: Record<string, McpServerConfig> = {};
  for (const row of rows) {
    const cfg = row.configJson as Record<string, unknown>;
    switch (row.transport) {
      case "stdio":
        out[row.name] = {
          type: "stdio",
          command: String(cfg.command ?? ""),
          args: Array.isArray(cfg.args) ? (cfg.args as string[]) : undefined,
          env: (cfg.env as Record<string, string> | undefined) ?? undefined,
        };
        break;
      case "http":
        out[row.name] = {
          type: "http",
          url: String(cfg.url ?? ""),
          headers:
            (cfg.headers as Record<string, string> | undefined) ?? undefined,
        };
        break;
      case "sse":
        out[row.name] = {
          type: "sse",
          url: String(cfg.url ?? ""),
          headers:
            (cfg.headers as Record<string, string> | undefined) ?? undefined,
        };
        break;
    }
  }
  return out;
}

async function failRun(runId: number, message: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.runs)
    .set({
      status: "failure",
      finishedAt: new Date(),
      error: message,
    })
    .where(eq(schema.runs.id, runId));
}

const RUN_STATUS_TO_SESSION: Record<string, "completed" | "failed" | "aborted" | "timeout"> = {
  success: "completed",
  failure: "failed",
  aborted: "aborted",
  timeout: "timeout",
};

async function processRun(run: ClaimedRun): Promise<ActiveRun> {
  const db = getDb();
  const abort = new AbortController();

  // Look up the agent by id to get its name (registry is keyed by name).
  const [agentRow] = await db
    .select({
      name: schema.agents.name,
      enabled: schema.agents.enabled,
    })
    .from(schema.agents)
    .where(eq(schema.agents.id, run.agentId))
    .limit(1);

  if (!agentRow) {
    await failRun(run.id, "Agent row not found");
    return { runId: run.id, sessionId: "", abort, promise: Promise.resolve() };
  }
  if (!agentRow.enabled) {
    await failRun(run.id, "Agent is disabled");
    return { runId: run.id, sessionId: "", abort, promise: Promise.resolve() };
  }

  // File-source agents live in the in-memory registry, populated at boot from
  // dist/agent.config.js. DB-source agents (created in the UI) are materialized
  // to disk on demand so the runner's filesystem assumptions still hold.
  const entry = getAgent(agentRow.name) ?? (await loadDbAgent(agentRow.name));
  if (!entry) {
    await failRun(
      run.id,
      `Agent "${agentRow.name}" not loaded — missing dist/agent.config.js (file) or agents row (db)`,
    );
    return { runId: run.id, sessionId: "", abort, promise: Promise.resolve() };
  }

  // Create a session row up front so events have somewhere to land.
  const [session] = await db
    .insert(schema.sessions)
    .values({
      agentId: run.agentId,
      status: "active",
      triggerContext: run.triggerContext as unknown as object,
      startedAt: run.startedAt,
    })
    .returning({ id: schema.sessions.id });

  await db
    .update(schema.runs)
    .set({ sessionId: session.id })
    .where(eq(schema.runs.id, run.id));

  const onEvent = async (event: RunEvent): Promise<void> => {
    try {
      await db.insert(schema.sessionEvents).values({
        sessionId: session.id,
        kind: event.kind,
        ts: new Date(event.ts),
        payload: event.payload as object,
      });
    } catch (err) {
      logger.warn("Failed to persist session event", {
        sessionId: session.id,
        kind: event.kind,
        error: String(err),
      });
    }
  };

  // Register so the api's abort route can find this run's controller.
  activeAborts.set(run.id, abort);

  const promise = (async () => {
    const startMs = Date.now();
    try {
      const [mcpServers, skills] = await Promise.all([
        loadAttachedMcpServers(run.agentId),
        loadAttachedSkills(run.agentId),
      ]);
      if (Object.keys(mcpServers).length > 0) {
        logger.info("Injecting MCP servers into run", {
          agentId: run.agentId,
          servers: Object.keys(mcpServers),
        });
      }
      if (skills.length > 0) {
        logger.info("Injecting skills into run", { agentId: run.agentId, skills });
      }

      const result = await executeAgent({
        config: entry.config,
        agentDir: entry.dir,
        triggerContext: run.triggerContext,
        signal: abort.signal,
        onEvent,
        extraEnv: {
          AGENTS_SESSION_ID: session.id,
          AGENTS_AGENT_ID: run.agentId,
        },
        mcpServers,
        skills,
      });

      const finishedAt = new Date(result.finishedAt);
      await db
        .update(schema.runs)
        .set({
          status: result.status,
          finishedAt,
          durationMs: result.durationMs,
          output: result.output ?? null,
          error: result.error ?? null,
        })
        .where(eq(schema.runs.id, run.id));

      await db
        .update(schema.sessions)
        .set({
          status: RUN_STATUS_TO_SESSION[result.status] ?? "failed",
          finishedAt,
        })
        .where(eq(schema.sessions.id, session.id));

      // Pipeline triggers: any agent subscribed to this one via an
      // `{type: "agent", source: <name>}` trigger gets enqueued now,
      // filtered by onSuccess/onFailure as the subscriber declared.
      await fireAgentPipeline(agentRow.name, result).catch((err) =>
        logger.warn("Pipeline dispatch failed", {
          source: agentRow.name,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const finishedAt = new Date();
      await db
        .update(schema.runs)
        .set({
          status: "failure",
          finishedAt,
          durationMs: Date.now() - startMs,
          error: message,
        })
        .where(eq(schema.runs.id, run.id));
      await db
        .update(schema.sessions)
        .set({ status: "failed", finishedAt })
        .where(eq(schema.sessions.id, session.id));
      logger.error("Worker run threw", { runId: run.id, error: message });
    } finally {
      activeAborts.delete(run.id);
    }
  })();

  return { runId: run.id, sessionId: session.id, abort, promise };
}

export function startWorker(): WorkerHandle {
  let stopping = false;
  let inFlight: ActiveRun | null = null;
  let loopDone: Promise<void>;

  const loop = async () => {
    await recoverOrphanedRuns().catch((err) =>
      logger.warn("Worker recovery failed", { error: String(err) }),
    );

    while (!stopping) {
      let claimed: ClaimedRun | undefined;
      try {
        claimed = await claimNextPending();
      } catch (err) {
        logger.error("Worker claim failed", { error: String(err) });
      }

      if (!claimed) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      logger.info("Worker claimed run", { runId: claimed.id, agentId: claimed.agentId });
      try {
        inFlight = await processRun(claimed);
        await inFlight.promise;
      } catch (err) {
        logger.error("Worker dispatch failed", {
          runId: claimed.id,
          error: String(err),
        });
      } finally {
        inFlight = null;
      }
    }
  };

  loopDone = loop();

  return {
    async stop() {
      stopping = true;
      if (inFlight) {
        inFlight.abort.abort();
        await inFlight.promise.catch(() => undefined);
      }
      await loopDone;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
