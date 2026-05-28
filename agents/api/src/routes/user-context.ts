/**
 * /api/context — per-owner CONTEXT.md. Single document per user; gets
 * materialized at the root of every task workspace this user creates.
 */

import { Hono } from "hono";
import { deleteUserContext, getUserContext, setUserContext } from "@agents/core";
import { currentUserId } from "../auth-util.js";

export const userContextRouter = new Hono();

userContextRouter.get("/", async (c) => {
  const row = await getUserContext(currentUserId(c));
  return c.json({
    body: row?.body ?? "",
    updatedAt: row?.updatedAt ?? null,
  });
});

userContextRouter.put("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const text = typeof body.body === "string" ? body.body : "";
  // Empty string deletes the document so we don't write empty CONTEXT.md
  // files into workspaces.
  if (!text.trim()) {
    await deleteUserContext(currentUserId(c));
    return c.json({ body: "", updatedAt: null });
  }
  const row = await setUserContext(currentUserId(c), text);
  return c.json({ body: row.body, updatedAt: row.updatedAt });
});
