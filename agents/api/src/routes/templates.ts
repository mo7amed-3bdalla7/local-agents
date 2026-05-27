/**
 * /api/templates — list pre-built agent recipes; clone into a db-source
 * agent owned by the caller. Templates are global (system-owned), so
 * listing is open to any authenticated user.
 */

import { Hono } from "hono";
import {
  cloneTemplate,
  getTemplateBySlug,
  listTemplates,
} from "@agents/core";
import { currentUserId } from "../auth-util.js";
import { reloadAllTriggers } from "../triggers/index.js";
import { logger } from "@agents/sdk";

export const templatesRouter = new Hono();

templatesRouter.get("/", async (c) => {
  const templates = await listTemplates();
  return c.json({ templates });
});

templatesRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const template = await getTemplateBySlug(slug);
  if (!template) return c.json({ error: "not_found" }, 404);
  return c.json({ template });
});

templatesRouter.post("/:slug/clone", async (c) => {
  const slug = c.req.param("slug");
  const template = await getTemplateBySlug(slug);
  if (!template) return c.json({ error: "not_found" }, 404);

  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine — defaults below kick in.
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const description =
    typeof body.description === "string" ? body.description : undefined;

  try {
    const agent = await cloneTemplate({
      template,
      ownerId: currentUserId(c),
      name,
      description,
    });
    // Reload triggers in the background so the cloned agent's cron/webhook
    // entries register without a process restart.
    void reloadAllTriggers().catch((err) =>
      logger.warn("Trigger reload after clone failed", {
        slug,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json({ agent }, 201);
  } catch (err) {
    return c.json(
      {
        error: "clone_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});
