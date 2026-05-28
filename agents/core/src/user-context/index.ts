/**
 * Per-owner CONTEXT.md — single markdown document materialized at the root
 * of every task workspace. The place for coding style, on-call rotation,
 * sprint goals, project glossary — anything that should apply across all
 * repos this user touches, without forcing them to copy/paste it into every
 * per-repo AGENTS.md.
 *
 * One row per user. getUserContext returns undefined when the user hasn't
 * set one yet; materialization treats that as "no CONTEXT.md needed".
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";

export type UserContext = typeof schema.userContexts.$inferSelect;

export async function getUserContext(
  ownerId: string,
): Promise<UserContext | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.userContexts)
    .where(eq(schema.userContexts.ownerId, ownerId))
    .limit(1);
  return row;
}

export async function setUserContext(
  ownerId: string,
  body: string,
): Promise<UserContext> {
  const db = getDb();
  const trimmed = body.trim();
  // Upsert by primary key.
  const existing = await getUserContext(ownerId);
  if (existing) {
    const [row] = await db
      .update(schema.userContexts)
      .set({ body: trimmed, updatedAt: new Date() })
      .where(eq(schema.userContexts.ownerId, ownerId))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(schema.userContexts)
    .values({ ownerId, body: trimmed })
    .returning();
  return row;
}

export async function deleteUserContext(ownerId: string): Promise<boolean> {
  const result = await getDb()
    .delete(schema.userContexts)
    .where(eq(schema.userContexts.ownerId, ownerId))
    .returning({ ownerId: schema.userContexts.ownerId });
  return result.length > 0;
}
