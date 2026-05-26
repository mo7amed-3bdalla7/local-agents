/**
 * Auth helpers for route handlers — extract the authenticated user out of
 * the Hono context. The auth middleware in server.ts guarantees `c.var.user`
 * is set on every non-public request; these helpers just narrow the type.
 */

import type { Context } from "hono";
import type { User } from "@agents/core";

export function currentUser(c: Context): User {
  const u = c.var.user as User | undefined;
  if (!u) {
    // Should never happen for routes mounted under the auth middleware.
    // Throwing instead of returning undefined keeps handler code simple.
    throw new Error("currentUser() called outside an authenticated route");
  }
  return u;
}

export function currentUserId(c: Context): string {
  return currentUser(c).id;
}
