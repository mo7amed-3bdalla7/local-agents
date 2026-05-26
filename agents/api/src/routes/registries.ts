/**
 * Read + write routers for the registries surface: connectors, skills, MCP
 * servers, repos, PR activity, runs. Connector/MCP/repo POST + DELETE were
 * CLI-only until slice-4; they're now mounted here so the dashboard can drive
 * full lifecycle without dropping to a shell.
 *
 * Skill mutation stays read-only — skills are filesystem-resolved via
 * `.claude/skills/<name>/SKILL.md`. Editing them happens in the file.
 */

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import {
  addConnector,
  addMcpServer,
  ensureRepo,
  getDb,
  removeConnector,
  schema,
  testConnector,
  testMcpServer,
  type McpTransport,
} from "@agents/core";
import { isUuid } from "../util.js";

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export const connectorsRouter = new Hono();

connectorsRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.connectors)
    .orderBy(schema.connectors.displayName);
  return c.json({ connectors: rows });
});

connectorsRouter.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body", message: "body must be JSON" }, 400);
  }
  const type = typeof body.connectorType === "string" ? body.connectorType : "";
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!type) return c.json({ error: "invalid_type" }, 400);
  if (!displayName) return c.json({ error: "invalid_display_name" }, 400);

  const cfg =
    body.configJson && typeof body.configJson === "object" && !Array.isArray(body.configJson)
      ? (body.configJson as Record<string, unknown>)
      : {};
  const secret = typeof body.secret === "string" ? body.secret : undefined;

  try {
    const row = await addConnector({
      connectorType: type,
      displayName,
      configJson: cfg,
      secret,
    });
    return c.json({ connector: row }, 201);
  } catch (err) {
    return c.json(
      { error: "create_failed", message: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

connectorsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const ok = await removeConnector(id);
  if (!ok) return c.json({ error: "connector not found" }, 404);
  return c.body(null, 204);
});

connectorsRouter.post("/:id/test", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const result = await testConnector(id);
  return c.json(result, result.ok ? 200 : 400);
});

// ---------------------------------------------------------------------------
// Skills (read-only — edit SKILL.md on disk)
// ---------------------------------------------------------------------------

export const skillsRouter = new Hono();
skillsRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.skills)
    .orderBy(schema.skills.name);
  return c.json({ skills: rows });
});

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

const MCP_TRANSPORTS: McpTransport[] = ["stdio", "http", "sse"];

export const mcpRouter = new Hono();

mcpRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.mcpServers)
    .orderBy(schema.mcpServers.name);
  return c.json({ mcpServers: rows });
});

mcpRouter.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const transport = body.transport as McpTransport | undefined;
  if (!name) return c.json({ error: "invalid_name" }, 400);
  if (!transport || !MCP_TRANSPORTS.includes(transport)) {
    return c.json(
      { error: "invalid_transport", message: `transport must be one of: ${MCP_TRANSPORTS.join(", ")}` },
      400,
    );
  }
  const cfg =
    body.configJson && typeof body.configJson === "object" && !Array.isArray(body.configJson)
      ? (body.configJson as Record<string, unknown>)
      : {};

  try {
    const row = await addMcpServer({
      name,
      transport,
      configJson: cfg as unknown as Parameters<typeof addMcpServer>[0]["configJson"],
    });
    return c.json({ mcpServer: row }, 201);
  } catch (err) {
    return c.json(
      { error: "create_failed", message: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

mcpRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const db = getDb();
  const deleted = await db
    .delete(schema.mcpServers)
    .where(eq(schema.mcpServers.id, id))
    .returning({ id: schema.mcpServers.id });
  if (deleted.length === 0) return c.json({ error: "mcp server not found" }, 404);
  return c.body(null, 204);
});

mcpRouter.post("/:id/test", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const db = getDb();
  const [row] = await db
    .select({ name: schema.mcpServers.name })
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.id, id))
    .limit(1);
  if (!row) return c.json({ error: "mcp server not found" }, 404);
  const result = await testMcpServer(row.name);
  return c.json(result, result.ok ? 200 : 400);
});

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export const reposRouter = new Hono();

reposRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.repos)
    .orderBy(schema.repos.githubFullName);
  return c.json({ repos: rows });
});

reposRouter.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const githubFullName =
    typeof body.githubFullName === "string" ? body.githubFullName.trim() : "";
  if (!githubFullName.includes("/")) {
    return c.json(
      {
        error: "invalid_github_full_name",
        message: 'must be "owner/name"',
      },
      400,
    );
  }
  const defaultBranch =
    typeof body.defaultBranch === "string" ? body.defaultBranch : undefined;
  const testCommand =
    typeof body.testCommand === "string" ? body.testCommand : undefined;

  try {
    // Note: ensureRepo() runs `git clone` if missing — can be slow on a fresh
    // repo. UI should show a loading spinner.
    const row = await ensureRepo({ githubFullName, defaultBranch, testCommand });
    return c.json({ repo: row }, 201);
  } catch (err) {
    return c.json(
      { error: "create_failed", message: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

reposRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const db = getDb();
  // We don't rm the local clone — the user may want it. Just drop the row.
  const deleted = await db
    .delete(schema.repos)
    .where(eq(schema.repos.id, id))
    .returning({ id: schema.repos.id });
  if (deleted.length === 0) return c.json({ error: "repo not found" }, 404);
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// PR activity (read-only)
// ---------------------------------------------------------------------------

export const prActivityRouter = new Hono();
prActivityRouter.get("/", async (c) => {
  const limitParam = Number(c.req.query("limit") ?? "100");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 500)
    : 100;
  const rows = await getDb()
    .select()
    .from(schema.prActivity)
    .orderBy(desc(schema.prActivity.createdAt))
    .limit(limit);
  return c.json({ prActivity: rows });
});

// ---------------------------------------------------------------------------
// Runs (read-only)
// ---------------------------------------------------------------------------

export const runsRouter = new Hono();
runsRouter.get("/", async (c) => {
  const db = getDb();
  const agentId = c.req.query("agentId");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "100"), 1), 500);

  const query = db
    .select({
      id: schema.runs.id,
      agentId: schema.runs.agentId,
      agentName: schema.agents.name,
      sessionId: schema.runs.sessionId,
      status: schema.runs.status,
      createdAt: schema.runs.createdAt,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      durationMs: schema.runs.durationMs,
      error: schema.runs.error,
    })
    .from(schema.runs)
    .leftJoin(schema.agents, eq(schema.runs.agentId, schema.agents.id))
    .orderBy(desc(schema.runs.createdAt))
    .limit(limit);

  const rows = agentId
    ? await query.where(eq(schema.runs.agentId, agentId))
    : await query;
  return c.json({ runs: rows });
});
