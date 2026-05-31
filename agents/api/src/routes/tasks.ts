/**
 * /api/tasks — bundle (brief + repos + agent) into a single run.
 *
 * POST creates the row, materializes the workspace (clones each linked
 * repo as a sibling + writes BRIEF.md), and enqueues a run with
 * triggerContext={taskId}. The worker reads taskId and sets the agent's
 * cwd to the workspace path so the agent sees BRIEF.md + all checkouts.
 */

import { Hono } from "hono";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  createTask,
  forkTask,
  getDb,
  getTask,
  listTaskLineage,
  listTasks,
  materializeTaskWorkspace,
  removeTask,
  schema,
  setTaskStatus,
} from "@agents/core";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";

export const tasksRouter = new Hono();

tasksRouter.get("/", async (c) => {
  const rows = await listTasks(currentUserId(c));
  return c.json({ tasks: rows });
});

tasksRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const task = await getTask(id, currentUserId(c));
  if (!task) return c.json({ error: "not_found" }, 404);
  return c.json({ task });
});

tasksRouter.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const userId = currentUserId(c);
  const title = typeof body.title === "string" ? body.title : "";
  const brief = typeof body.brief === "string" ? body.brief : "";
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  const repoIds = Array.isArray(body.repoIds)
    ? (body.repoIds.filter((x) => typeof x === "string") as string[])
    : [];
  if (!title.trim()) return c.json({ error: "invalid_title" }, 400);
  if (!brief.trim()) return c.json({ error: "invalid_brief" }, 400);
  if (!isUuid(agentId)) return c.json({ error: "invalid_agent_id" }, 400);
  if (repoIds.length === 0) {
    return c.json({ error: "no_repos_linked" }, 400);
  }
  for (const r of repoIds) {
    if (!isUuid(r)) return c.json({ error: "invalid_repo_id", id: r }, 400);
  }

  const db = getDb();
  // Verify the agent is visible to the user (file-source allowed for now).
  const [agent] = await db
    .select({ id: schema.agents.id, enabled: schema.agents.enabled })
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.id, agentId),
        or(
          isNull(schema.agents.ownerId),
          eq(schema.agents.ownerId, userId),
        ),
      ),
    )
    .limit(1);
  if (!agent) return c.json({ error: "agent_not_found" }, 404);
  if (!agent.enabled) return c.json({ error: "agent_disabled" }, 409);

  // Verify each repo belongs to the user (file-source repos are owned).
  const accessibleRepos = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(eq(schema.repos.ownerId, userId));
  const accessibleSet = new Set(accessibleRepos.map((r) => r.id));
  for (const r of repoIds) {
    if (!accessibleSet.has(r)) {
      return c.json({ error: "repo_not_accessible", id: r }, 403);
    }
  }

  let task;
  try {
    task = await createTask({
      ownerId: userId,
      agentId,
      title,
      brief,
      repoIds,
    });
  } catch (err) {
    return c.json(
      {
        error: "create_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }

  // Materialize workspace (clones + BRIEF.md). Slow on first run; do it
  // inline so the user gets a deterministic ready-state in the response.
  let workspacePath: string;
  try {
    workspacePath = await materializeTaskWorkspace(task.id);
  } catch (err) {
    await setTaskStatus(task.id, "failed", { finishedAt: new Date() });
    return c.json(
      {
        error: "materialize_failed",
        message: err instanceof Error ? err.message : String(err),
        taskId: task.id,
      },
      500,
    );
  }

  // Enqueue the run with triggerContext.taskId so the worker can pick up
  // the workspace path + brief at execution time.
  const [run] = await db
    .insert(schema.runs)
    .values({
      agentId,
      status: "pending",
      triggerContext: {
        triggerType: "manual" as const,
        triggeredAt: new Date().toISOString(),
        meta: { source: "task", taskId: task.id, workspacePath },
      },
    })
    .returning({ id: schema.runs.id });

  await setTaskStatus(task.id, "active", {
    runId: run.id,
    workspacePath,
    startedAt: new Date(),
  });

  return c.json(
    { task: await getTask(task.id, userId), runId: run.id },
    201,
  );
});

tasksRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const ok = await removeTask(id, currentUserId(c));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

/**
 * GET /api/tasks/:id/lineage
 *
 * Returns every task in the fork tree this task belongs to (root + all
 * descendants), sorted oldest-first. The UI uses parentTaskId edges to
 * render the run-history tree on TaskDetail.
 */
tasksRouter.get("/:id/lineage", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const lineage = await listTaskLineage(id, currentUserId(c));
  if (!lineage) return c.json({ error: "not_found" }, 404);
  return c.json({ lineage });
});

/**
 * POST /api/tasks/:id/rerun
 *
 * Forks an existing task. Creates a new task row inheriting the brief +
 * repos + agent, with parentTaskId set to the original. Materializes a
 * fresh workspace (separate dir from the parent's) and enqueues a run —
 * same code path as POST /tasks.
 */
tasksRouter.post("/:id/rerun", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const userId = currentUserId(c);

  let task;
  try {
    task = await forkTask(id, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "task not found") return c.json({ error: "not_found" }, 404);
    return c.json({ error: "fork_failed", message: msg }, 400);
  }

  let workspacePath: string;
  try {
    workspacePath = await materializeTaskWorkspace(task.id);
  } catch (err) {
    await setTaskStatus(task.id, "failed", { finishedAt: new Date() });
    return c.json(
      {
        error: "materialize_failed",
        message: err instanceof Error ? err.message : String(err),
        taskId: task.id,
      },
      500,
    );
  }

  const db = getDb();
  const [run] = await db
    .insert(schema.runs)
    .values({
      agentId: task.agentId,
      status: "pending",
      triggerContext: {
        triggerType: "manual" as const,
        triggeredAt: new Date().toISOString(),
        meta: {
          source: "task",
          taskId: task.id,
          workspacePath,
          rerunOf: id,
        },
      },
    })
    .returning({ id: schema.runs.id });

  await setTaskStatus(task.id, "active", {
    runId: run.id,
    workspacePath,
    startedAt: new Date(),
  });

  return c.json(
    { task: await getTask(task.id, userId), runId: run.id },
    201,
  );
});
