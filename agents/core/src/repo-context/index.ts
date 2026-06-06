/**
 * Per-repo CONTEXT.md — the repo-scoped sibling of `user-context`. While the
 * owner-wide CONTEXT.md (see ../user-context) is materialized once at the root
 * of every task workspace, this one is materialized at the root of an
 * individual repo's checkout — the place for conventions, gotchas, or pointers
 * that apply to one repo but that the user doesn't want to commit into that
 * repo's own AGENTS.md/CLAUDE.md.
 *
 * One row per repo. getRepoContext returns undefined when none is set;
 * materialization treats that as "no per-repo CONTEXT.md needed".
 */

import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";

export type RepoContext = typeof schema.repoContexts.$inferSelect;

export async function getRepoContext(
  repoId: string,
): Promise<RepoContext | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.repoContexts)
    .where(eq(schema.repoContexts.repoId, repoId))
    .limit(1);
  return row;
}

/**
 * Bulk fetch for a set of repos — used by workspace materialization so it can
 * resolve every linked repo's context in one round-trip. Returns a Map keyed
 * by repoId; repos with no context are simply absent.
 */
export async function getRepoContexts(
  repoIds: string[],
): Promise<Map<string, RepoContext>> {
  if (repoIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(schema.repoContexts)
    .where(inArray(schema.repoContexts.repoId, repoIds));
  return new Map(rows.map((r) => [r.repoId, r]));
}

export async function setRepoContext(
  repoId: string,
  body: string,
): Promise<RepoContext> {
  const db = getDb();
  const trimmed = body.trim();
  // Upsert by primary key.
  const existing = await getRepoContext(repoId);
  if (existing) {
    const [row] = await db
      .update(schema.repoContexts)
      .set({ body: trimmed, updatedAt: new Date() })
      .where(eq(schema.repoContexts.repoId, repoId))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(schema.repoContexts)
    .values({ repoId, body: trimmed })
    .returning();
  return row;
}

export async function deleteRepoContext(repoId: string): Promise<boolean> {
  const result = await getDb()
    .delete(schema.repoContexts)
    .where(eq(schema.repoContexts.repoId, repoId))
    .returning({ repoId: schema.repoContexts.repoId });
  return result.length > 0;
}
