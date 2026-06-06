/**
 * Read + write routers for the registries surface: connectors, skills, MCP
 * servers, repos, PR activity, runs. Connector/MCP/repo POST + DELETE were
 * CLI-only until slice-4; they're now mounted here so the dashboard can drive
 * full lifecycle without dropping to a shell.
 *
 * Skill mutation stays read-only — skills are filesystem-resolved via
 * `.claude/skills/<name>/SKILL.md`. Editing them happens in the file.
 */

import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  addConnector,
  addMcpServer,
  deleteRepoContext,
  ensureRepo,
  getRepoContext,
  linkLocalRepo,
  getDb,
  removeConnector,
  schema,
  setRepoContext,
  testConnector,
  testMcpServer,
  type McpTransport,
} from "@agents/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";
import { abortRun } from "../worker.js";
import { syncSkills } from "../skills/sync.js";
import { workspaceRoot } from "../paths.js";

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export const connectorsRouter = new Hono();

connectorsRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.connectors)
    .where(eq(schema.connectors.ownerId, currentUserId(c)))
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
      ownerId: currentUserId(c),
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
  // Verify ownership before delegating — removeConnector also wipes the
  // keychain entry, which we don't want to do for someone else's row.
  const [row] = await getDb()
    .select({ ownerId: schema.connectors.ownerId })
    .from(schema.connectors)
    .where(eq(schema.connectors.id, id))
    .limit(1);
  if (!row) return c.json({ error: "connector not found" }, 404);
  if (row.ownerId !== currentUserId(c)) {
    return c.json({ error: "connector not found" }, 404);
  }
  const ok = await removeConnector(id);
  if (!ok) return c.json({ error: "connector not found" }, 404);
  return c.body(null, 204);
});

connectorsRouter.post("/:id/test", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const [row] = await getDb()
    .select({ ownerId: schema.connectors.ownerId })
    .from(schema.connectors)
    .where(eq(schema.connectors.id, id))
    .limit(1);
  if (!row || row.ownerId !== currentUserId(c)) {
    return c.json({ error: "connector not found" }, 404);
  }
  const result = await testConnector(id);
  return c.json(result, result.ok ? 200 : 400);
});

// ---------------------------------------------------------------------------
// Skills (read-only — edit SKILL.md on disk)
// ---------------------------------------------------------------------------

export const skillsRouter = new Hono();

// Proxy to skills.sh's search API. Public registry; we still gate the
// proxy behind our own auth middleware so unauthenticated requests can't
// drive arbitrary outbound calls.
skillsRouter.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q) return c.json({ skills: [] });
  try {
    const res = await fetch(
      `https://skills.sh/api/search?q=${encodeURIComponent(q)}`,
      { headers: { "user-agent": "agents-platform" } },
    );
    if (!res.ok) {
      return c.json({ error: "search_failed", status: res.status }, 502);
    }
    const data = (await res.json()) as {
      skills?: Array<{
        id: string;
        skillId: string;
        name: string;
        installs?: number;
        source: string;
      }>;
    };
    return c.json({ skills: data.skills ?? [] });
  } catch (err) {
    return c.json(
      {
        error: "search_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
});

// Install a skill via `npx -y skills add <package> [-s <skill>] -y --copy`.
// After install, re-scan the filesystem so the skills table picks up the
// new row. Bounded to 120s; output buffer 4 MiB.
skillsRouter.post("/install", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const pkg = typeof body.package === "string" ? body.package.trim() : "";
  const skill = typeof body.skill === "string" ? body.skill.trim() : "";

  if (!pkg || !/^[^\s]+$/.test(pkg)) {
    return c.json(
      {
        error: "invalid_package",
        message: 'Provide a package spec like "owner/repo" or a github URL.',
      },
      400,
    );
  }

  const args = ["-y", "skills", "add", pkg, "-y", "--copy"];
  if (skill) args.push("--skill", skill);

  try {
    const { stdout, stderr } = await exec("npx", args, {
      cwd: workspaceRoot(),
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const result = await syncSkills(workspaceRoot());
    return c.json({
      ok: true,
      output: (stdout || stderr || "").slice(-4000),
      synced: result,
    });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    return c.json(
      {
        ok: false,
        error: "install_failed",
        message: (e.stderr || e.stdout || e.message || String(err)).slice(-4000),
      },
      500,
    );
  }
});

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
    .where(eq(schema.mcpServers.ownerId, currentUserId(c)))
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
      ownerId: currentUserId(c),
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
    .where(
      and(
        eq(schema.mcpServers.id, id),
        eq(schema.mcpServers.ownerId, currentUserId(c)),
      ),
    )
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
    .where(
      and(
        eq(schema.mcpServers.id, id),
        eq(schema.mcpServers.ownerId, currentUserId(c)),
      ),
    )
    .limit(1);
  if (!row) return c.json({ error: "mcp server not found" }, 404);
  const result = await testMcpServer(row.name);
  return c.json(result, result.ok ? 200 : 400);
});

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export const reposRouter = new Hono();

/**
 * GET /api/repos/browse?path=<abs>
 *
 * Server-side directory listing used by the /repos/new "Link local clone"
 * picker. Returns child dirs of `path` and marks the ones that are git
 * repos (have a .git/ subdir). Dotfiles are skipped (except `.git` which
 * we never list as a child anyway since we filter to dirs).
 *
 * Defaults to the API process's home dir when no path is given. Path must
 * be absolute. Permission-denied / dangling-symlink children are silently
 * skipped so a single unreadable subtree doesn't break the picker.
 */
reposRouter.get("/browse", async (c) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { homedir } = await import("node:os");

  let requested = c.req.query("path");
  if (!requested) requested = homedir();
  if (!path.isAbsolute(requested)) {
    return c.json(
      { error: "path_not_absolute", message: "path must be absolute" },
      400,
    );
  }
  const abs = path.resolve(requested);

  if (!fs.existsSync(abs)) {
    return c.json({
      path: abs,
      parent: path.dirname(abs),
      exists: false,
      isDir: false,
      isGitRepo: false,
      entries: [],
    });
  }
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    return c.json(
      {
        error: "stat_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
  if (!stat.isDirectory()) {
    return c.json({
      path: abs,
      parent: path.dirname(abs),
      exists: true,
      isDir: false,
      isGitRepo: false,
      entries: [],
    });
  }

  let names: string[] = [];
  try {
    names = fs.readdirSync(abs);
  } catch (err) {
    return c.json(
      {
        error: "readdir_failed",
        message: err instanceof Error ? err.message : String(err),
        path: abs,
        parent: path.dirname(abs),
        exists: true,
        isDir: true,
        isGitRepo: fs.existsSync(path.join(abs, ".git")),
        entries: [],
      },
      400,
    );
  }
  const entries: Array<{ name: string; isDir: boolean; isGitRepo: boolean }> = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const childAbs = path.join(abs, name);
    try {
      const childStat = fs.statSync(childAbs);
      if (!childStat.isDirectory()) continue;
      entries.push({
        name,
        isDir: true,
        isGitRepo: fs.existsSync(path.join(childAbs, ".git")),
      });
    } catch {
      // permission denied / dangling symlink — skip
    }
  }
  // Git repos first, then alpha.
  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return c.json({
    path: abs,
    parent: path.dirname(abs),
    exists: true,
    isDir: true,
    isGitRepo: fs.existsSync(path.join(abs, ".git")),
    entries,
  });
});

reposRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.ownerId, currentUserId(c)))
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
  const localPath =
    typeof body.localPath === "string" ? body.localPath.trim() : "";
  const githubFullName =
    typeof body.githubFullName === "string" ? body.githubFullName.trim() : "";
  const defaultBranch =
    typeof body.defaultBranch === "string" ? body.defaultBranch : undefined;
  const testCommand =
    typeof body.testCommand === "string" ? body.testCommand : undefined;

  // Two modes — link an existing local clone, or clone a github repo fresh.
  if (localPath) {
    try {
      const row = await linkLocalRepo({
        localPath,
        defaultBranch,
        githubFullName: githubFullName || undefined,
        testCommand,
        ownerId: currentUserId(c),
      });
      return c.json({ repo: row }, 201);
    } catch (err) {
      return c.json(
        {
          error: "link_failed",
          message: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
  }

  if (!githubFullName.includes("/")) {
    return c.json(
      {
        error: "invalid_github_full_name",
        message: 'must be "owner/name" — or provide localPath to link an existing clone',
      },
      400,
    );
  }

  try {
    // Note: ensureRepo() runs `git clone` if missing — can be slow on a fresh
    // repo. UI should show a loading spinner.
    const row = await ensureRepo({
      githubFullName,
      defaultBranch,
      testCommand,
      ownerId: currentUserId(c),
    });
    return c.json({ repo: row }, 201);
  } catch (err) {
    return c.json(
      { error: "create_failed", message: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

/**
 * Per-repo CONTEXT.md. GET returns the current body ("" when unset); PUT
 * upserts, and an empty/whitespace body deletes the row so no empty CONTEXT.md
 * gets materialized. Both require the repo to belong to the caller.
 */
async function ownedRepo(c: Context, id: string) {
  const [repo] = await getDb()
    .select()
    .from(schema.repos)
    .where(and(eq(schema.repos.id, id), eq(schema.repos.ownerId, currentUserId(c))))
    .limit(1);
  return repo;
}

reposRouter.get("/:id/context", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  if (!(await ownedRepo(c, id))) return c.json({ error: "repo not found" }, 404);
  const row = await getRepoContext(id);
  return c.json({ body: row?.body ?? "", updatedAt: row?.updatedAt ?? null });
});

reposRouter.put("/:id/context", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  if (!(await ownedRepo(c, id))) return c.json({ error: "repo not found" }, 404);
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) {
    await deleteRepoContext(id);
    return c.json({ body: "", updatedAt: null });
  }
  const row = await setRepoContext(id, text);
  return c.json({ body: row.body, updatedAt: row.updatedAt });
});

reposRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const db = getDb();
  // We don't rm the local clone — the user may want it. Just drop the row.
  const deleted = await db
    .delete(schema.repos)
    .where(
      and(eq(schema.repos.id, id), eq(schema.repos.ownerId, currentUserId(c))),
    )
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

/**
 * Stop an in-flight run. Looks up the row's status to give the right error
 * shape (404 / 409) before signaling the worker's AbortController.
 *
 * Run id is a bigserial integer, not a UUID.
 */
runsRouter.post("/:id/abort", async (c) => {
  const idParam = c.req.param("id");
  const runId = Number(idParam);
  if (!Number.isInteger(runId) || runId < 1) {
    return c.json({ error: "invalid_id", message: "id must be a positive integer" }, 400);
  }
  const db = getDb();
  const [row] = await db
    .select({ id: schema.runs.id, status: schema.runs.status })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .limit(1);
  if (!row) return c.json({ error: "run not found" }, 404);

  // Only active runs can be cancelled mid-flight. Pending runs aren't
  // executing yet — we just dequeue them by marking aborted directly.
  if (row.status === "pending") {
    await db
      .update(schema.runs)
      .set({ status: "aborted", finishedAt: new Date(), error: "Aborted before start" })
      .where(
        and(
          eq(schema.runs.id, runId),
          inArray(schema.runs.status, ["pending"] as const),
        ),
      );
    return c.json({ runId, status: "aborted", method: "dequeue" }, 202);
  }
  if (row.status !== "active") {
    return c.json(
      { error: "not_in_flight", message: `run is ${row.status}; can only abort pending/active runs` },
      409,
    );
  }

  const signalled = abortRun(runId);
  if (!signalled) {
    return c.json(
      {
        error: "no_worker",
        message:
          "run is active in the DB but no worker on this process holds its controller (multi-worker setup?)",
      },
      409,
    );
  }
  return c.json({ runId, status: "abort_signalled", method: "signal" }, 202);
});

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

// ---------------------------------------------------------------------------
// Usage rollups — cost + tokens by agent and by day
// ---------------------------------------------------------------------------

export const usageRouter = new Hono();

usageRouter.get("/", async (c) => {
  const daysParam = Number(c.req.query("days") ?? "30");
  const days = Number.isFinite(daysParam)
    ? Math.min(Math.max(daysParam, 1), 365)
    : 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const db = getDb();

  // Per-agent totals over the window.
  const perAgent = await db
    .select({
      agentId: schema.runs.agentId,
      agentName: schema.agents.name,
      runs: sql<number>`COUNT(*)::int`,
      successes: sql<number>`COUNT(*) FILTER (WHERE ${schema.runs.status} = 'success')::int`,
      failures: sql<number>`COUNT(*) FILTER (WHERE ${schema.runs.status} IN ('failure','timeout','aborted'))::int`,
      inputTokens: sql<number>`COALESCE(SUM(${schema.runs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${schema.runs.outputTokens}), 0)::int`,
      cacheCreationTokens: sql<number>`COALESCE(SUM(${schema.runs.cacheCreationTokens}), 0)::int`,
      cacheReadTokens: sql<number>`COALESCE(SUM(${schema.runs.cacheReadTokens}), 0)::int`,
      costUsd: sql<string>`COALESCE(SUM(${schema.runs.costUsd}), 0)::text`,
    })
    .from(schema.runs)
    .leftJoin(schema.agents, eq(schema.runs.agentId, schema.agents.id))
    .where(gte(schema.runs.createdAt, since))
    .groupBy(schema.runs.agentId, schema.agents.name)
    .orderBy(desc(sql`COALESCE(SUM(${schema.runs.costUsd}), 0)`));

  // Per-day totals across all agents.
  const perDay = await db
    .select({
      day: sql<string>`DATE(${schema.runs.createdAt})::text`,
      runs: sql<number>`COUNT(*)::int`,
      inputTokens: sql<number>`COALESCE(SUM(${schema.runs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${schema.runs.outputTokens}), 0)::int`,
      costUsd: sql<string>`COALESCE(SUM(${schema.runs.costUsd}), 0)::text`,
    })
    .from(schema.runs)
    .where(gte(schema.runs.createdAt, since))
    .groupBy(sql`DATE(${schema.runs.createdAt})`)
    .orderBy(desc(sql`DATE(${schema.runs.createdAt})`));

  // Window totals (cheap rollup over the per-agent rows).
  const totals = {
    runs: perAgent.reduce((s, r) => s + Number(r.runs), 0),
    successes: perAgent.reduce((s, r) => s + Number(r.successes), 0),
    failures: perAgent.reduce((s, r) => s + Number(r.failures), 0),
    inputTokens: perAgent.reduce((s, r) => s + Number(r.inputTokens), 0),
    outputTokens: perAgent.reduce((s, r) => s + Number(r.outputTokens), 0),
    cacheReadTokens: perAgent.reduce((s, r) => s + Number(r.cacheReadTokens), 0),
    costUsd: perAgent.reduce((s, r) => s + Number(r.costUsd), 0),
  };

  return c.json({
    windowDays: days,
    since: since.toISOString(),
    totals,
    perAgent,
    perDay,
  });
});
