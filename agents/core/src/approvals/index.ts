/**
 * Approvals — human-in-the-loop queue for side-effecting agent actions.
 *
 * An agent calls `enqueueAction({ kind, payload, ... })` to stage a side
 * effect (post a comment, push a commit, send a Slack message). The row
 * lives in `pending_actions` with status='pending' until a human acts.
 *
 * `approveAction()` flips status -> 'approved', `executePendingAction()`
 * then dispatches to a per-kind executor (see `executors` map) and writes
 * back the result.
 *
 * Executors register themselves via `registerExecutor(kind, fn)`. The
 * `pr_comment` executor lands alongside the runner integration in a
 * later commit — this module only contains the queue + dispatch loop.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";
import { dispatchEvent } from "../notifications/index.js";

export type PendingAction = typeof schema.pendingActions.$inferSelect;
export type PendingActionStatus = PendingAction["status"];

export interface EnqueueActionArgs {
  /** Session that produced the action — null is allowed but discouraged. */
  sessionId?: string | null;
  agentId: string;
  ownerId?: string | null;
  kind: string;
  title: string;
  description?: string | null;
  payload: Record<string, unknown>;
}

export async function enqueueAction(
  args: EnqueueActionArgs,
): Promise<PendingAction> {
  const db = getDb();
  const [row] = await db
    .insert(schema.pendingActions)
    .values({
      sessionId: args.sessionId ?? null,
      agentId: args.agentId,
      ownerId: args.ownerId ?? null,
      kind: args.kind,
      title: args.title,
      description: args.description ?? null,
      payload: args.payload,
      status: "pending",
    })
    .returning();

  // Notify the owner that an approval is waiting. Fire-and-forget; failures
  // are captured in notification_deliveries inside the dispatcher.
  if (args.ownerId) {
    await dispatchEvent({
      ownerId: args.ownerId,
      event: "approval_pending",
      title: `Approval needed: ${args.title}`,
      body: args.description ?? undefined,
      subjectRef: {
        kind: "approval",
        id: row.id,
        agentId: args.agentId,
        sessionId: args.sessionId ?? null,
      },
      extra: { actionKind: args.kind },
    }).catch(() => undefined);
  }

  return row;
}

export interface ListPendingArgs {
  ownerId?: string;
  /** Defaults to all statuses if omitted. */
  statuses?: PendingActionStatus[];
  limit?: number;
}

export async function listPendingActions(
  args: ListPendingArgs = {},
): Promise<PendingAction[]> {
  const db = getDb();
  const where = [] as ReturnType<typeof eq>[];
  if (args.ownerId) where.push(eq(schema.pendingActions.ownerId, args.ownerId));
  if (args.statuses && args.statuses.length > 0) {
    where.push(inArray(schema.pendingActions.status, args.statuses));
  }
  return db
    .select()
    .from(schema.pendingActions)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(schema.pendingActions.createdAt))
    .limit(args.limit ?? 100);
}

export async function getPendingAction(
  id: string,
): Promise<PendingAction | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.pendingActions)
    .where(eq(schema.pendingActions.id, id))
    .limit(1);
  return row;
}

/** Mark `pending` → `approved`. No-op if already decided. */
export async function approveAction(
  id: string,
  decidedBy: string,
): Promise<PendingAction | undefined> {
  const db = getDb();
  const [row] = await db
    .update(schema.pendingActions)
    .set({ status: "approved", decidedBy, decidedAt: new Date() })
    .where(
      and(
        eq(schema.pendingActions.id, id),
        eq(schema.pendingActions.status, "pending"),
      ),
    )
    .returning();
  return row;
}

export async function rejectAction(
  id: string,
  decidedBy: string,
): Promise<PendingAction | undefined> {
  const db = getDb();
  const [row] = await db
    .update(schema.pendingActions)
    .set({ status: "rejected", decidedBy, decidedAt: new Date() })
    .where(
      and(
        eq(schema.pendingActions.id, id),
        eq(schema.pendingActions.status, "pending"),
      ),
    )
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Executor dispatch
// ---------------------------------------------------------------------------

export type ExecutorFn = (
  action: PendingAction,
) => Promise<Record<string, unknown>>;

const executors = new Map<string, ExecutorFn>();

export function registerExecutor(kind: string, fn: ExecutorFn): void {
  executors.set(kind, fn);
}

export function listExecutors(): string[] {
  return [...executors.keys()];
}

/**
 * Execute an `approved` action. Writes result/error back and flips status
 * to `executed` or `failed`. Throws if the action isn't approved or no
 * executor is registered for its kind.
 */
export async function executePendingAction(
  id: string,
): Promise<PendingAction> {
  const db = getDb();
  const action = await getPendingAction(id);
  if (!action) throw new Error(`pending action ${id} not found`);
  if (action.status !== "approved") {
    throw new Error(
      `pending action ${id} is ${action.status}, not approved`,
    );
  }
  const fn = executors.get(action.kind);
  if (!fn) {
    throw new Error(`no executor registered for kind=${action.kind}`);
  }

  try {
    const result = await fn(action);
    const [row] = await db
      .update(schema.pendingActions)
      .set({
        status: "executed",
        executedAt: new Date(),
        executorResult: result,
        executorError: null,
      })
      .where(eq(schema.pendingActions.id, id))
      .returning();
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [row] = await db
      .update(schema.pendingActions)
      .set({
        status: "failed",
        executedAt: new Date(),
        executorError: message,
      })
      .where(eq(schema.pendingActions.id, id))
      .returning();
    return row;
  }
}
