/**
 * Approvals router — list pending actions, approve/reject, replay.
 *
 * Scoped to the authenticated user — `pending_actions.owner_id` is
 * stamped at enqueue time from the originating agent's owner. Cross-user
 * access returns 404 (consistent with the rest of the API).
 *
 * Approve hits the executor synchronously; UI gets back the executed
 * row in the same response. If the executor fails the row is flipped
 * to status='failed' and the response surfaces the error.
 */

import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  approveAction,
  dispatchEvent,
  executePendingAction,
  getDb,
  getPendingAction,
  listExecutors,
  rejectAction,
  schema,
  type PendingActionStatus,
} from "@agents/core";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";

export const approvalsRouter = new Hono();

const ALL_STATUSES: PendingActionStatus[] = [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
];

function parseStatuses(q: string | undefined): PendingActionStatus[] | undefined {
  if (!q) return undefined;
  const parts = q.split(",").map((s) => s.trim()).filter(Boolean);
  const valid = parts.filter((p): p is PendingActionStatus =>
    ALL_STATUSES.includes(p as PendingActionStatus),
  );
  return valid.length > 0 ? valid : undefined;
}

approvalsRouter.get("/", async (c) => {
  const statuses =
    parseStatuses(c.req.query("status")) ?? (["pending"] as PendingActionStatus[]);
  const rows = await getDb()
    .select()
    .from(schema.pendingActions)
    .where(
      and(
        eq(schema.pendingActions.ownerId, currentUserId(c)),
        inArray(schema.pendingActions.status, statuses),
      ),
    )
    .orderBy(desc(schema.pendingActions.createdAt))
    .limit(200);
  return c.json({ approvals: rows, executors: listExecutors() });
});

approvalsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const action = await getPendingAction(id);
  if (!action || action.ownerId !== currentUserId(c)) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ approval: action });
});

approvalsRouter.post("/:id/approve", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const userId = currentUserId(c);
  const existing = await getPendingAction(id);
  if (!existing || existing.ownerId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (existing.status !== "pending") {
    return c.json(
      { error: "not_pending", status: existing.status },
      409,
    );
  }
  const approved = await approveAction(id, userId);
  if (!approved) {
    return c.json({ error: "race_lost" }, 409);
  }
  // Execute synchronously — for the action kinds we ship today
  // (pr_comment, etc.) the side effect is a single API call,
  // bounded by the underlying client's timeout. UI gets the
  // final state in one response.
  try {
    const executed = await executePendingAction(id);
    if (executed.status === "failed") {
      // Executor ran but its side-effect failed (e.g. gh returned non-zero).
      // dispatch approval_failed so the user knows without polling the page.
      await dispatchEvent({
        ownerId: userId,
        event: "approval_failed",
        title: `Approval execution failed: ${executed.title}`,
        body: executed.executorError ?? undefined,
        subjectRef: {
          kind: "approval",
          id: executed.id,
          agentId: executed.agentId,
        },
        extra: { actionKind: executed.kind },
      }).catch(() => undefined);
    }
    return c.json({ approval: executed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "execute_failed", message }, 500);
  }
});

approvalsRouter.post("/:id/reject", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const userId = currentUserId(c);
  const existing = await getPendingAction(id);
  if (!existing || existing.ownerId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (existing.status !== "pending") {
    return c.json(
      { error: "not_pending", status: existing.status },
      409,
    );
  }
  const rejected = await rejectAction(id, userId);
  if (!rejected) return c.json({ error: "race_lost" }, 409);
  return c.json({ approval: rejected });
});
