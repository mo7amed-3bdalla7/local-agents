/**
 * /api/tokens — personal access tokens for Bearer auth.
 *
 * Create returns the plaintext token *once* in the response. Subsequent
 * list calls never include the secret — only its 8-char prefix and
 * metadata, so a user can identify and revoke each token from the UI.
 */

import { Hono } from "hono";
import { createApiToken, listApiTokens, revokeApiToken } from "@agents/core";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";

export const tokensRouter = new Hono();

tokensRouter.get("/", async (c) => {
  const rows = await listApiTokens(currentUserId(c));
  return c.json({
    tokens: rows.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
      revokedAt: t.revokedAt,
    })),
  });
});

tokensRouter.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const name =
    typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "invalid_name" }, 400);

  let expiresAt: Date | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) {
      return c.json({ error: "invalid_expires_at" }, 400);
    }
    if (d.getTime() <= Date.now()) {
      return c.json({ error: "expires_in_past" }, 400);
    }
    expiresAt = d;
  }

  try {
    const result = await createApiToken({
      ownerId: currentUserId(c),
      name,
      expiresAt,
    });
    return c.json(
      {
        // Plaintext shown ONCE. Client must capture it now.
        token: result.token,
        id: result.row.id,
        name: result.row.name,
        prefix: result.row.prefix,
        createdAt: result.row.createdAt,
        expiresAt: result.row.expiresAt,
      },
      201,
    );
  } catch (err) {
    return c.json(
      {
        error: "create_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

tokensRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const ok = await revokeApiToken(id, currentUserId(c));
  if (!ok) return c.json({ error: "not_found_or_already_revoked" }, 404);
  return c.body(null, 204);
});
