/**
 * @agents/api — single-server entry point.
 *
 * One HTTP server, one port. Vite owns the listener and serves the React
 * dashboard (with HMR over the same socket); a Vite plugin mounts the Hono
 * REST app at `/api/*` so the dashboard's typed client just works without a
 * proxy. Everything outside /api falls through to Vite's middleware chain
 * (transforms, /@vite/client, static, SPA fallback).
 *
 * Port defaults to 3848 (override with API_PORT). All API routes are under
 * /api — see agents/api/src/routes/.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { logger as honoLogger } from "hono/logger";
import { logger } from "@agents/sdk";
import {
  bootstrapDefaultUser,
  seedDefaultTemplates,
  closeDb,
  validateSession,
  verifyApiToken,
  type User,
} from "@agents/core";
import { authRouter, COOKIE_NAME } from "./routes/auth.js";
import { agentsRouter } from "./routes/agents.js";
import { agentsGenerateRouter } from "./routes/agents-generate.js";
import { agentsRefineRouter } from "./routes/agents-refine.js";
import { agentMemoryRouter } from "./routes/agent-memory.js";
import { approvalsRouter } from "./routes/approvals.js";
import { capabilitiesRouter } from "./routes/capabilities.js";
import { notificationsRouter } from "./routes/notifications.js";
import { sessionsRouter } from "./routes/sessions.js";
import { tasksRouter } from "./routes/tasks.js";
import { templatesRouter } from "./routes/templates.js";
import { tokensRouter } from "./routes/tokens.js";
import { userContextRouter } from "./routes/user-context.js";
import { registerGitCommitPushExecutor } from "./executors/git-commit-push.js";
import { registerGithubReviewExecutor } from "./executors/github-review.js";
import { registerPrCommentExecutor } from "./executors/pr-comment.js";
import { registerPrCreateExecutor } from "./executors/pr-create.js";
import { registerShellCommandExecutor } from "./executors/shell-command.js";
import { registerSlackMessageExecutor } from "./executors/slack-message.js";
import { registerConsoleSender } from "./senders/console.js";
import { registerSlackSender } from "./senders/slack.js";
import { registerWebhookSender } from "./senders/webhook.js";
import {
  connectorsRouter,
  mcpRouter,
  prActivityRouter,
  reposRouter,
  runsRouter,
  skillsRouter,
  usageRouter,
} from "./routes/registries.js";
import { syncFileAgents } from "./sync.js";
import { syncSkills } from "./skills/sync.js";
import { workspaceRoot } from "./paths.js";
import { startWorker, type WorkerHandle } from "./worker.js";
import { registerAllTriggers, type TriggersHandle } from "./triggers/index.js";
import { dispatchWebhook } from "./triggers/webhook.js";

// Load the repo-root .env (not the sub-package one) so `pnpm api` from the
// workspace root or `pnpm --filter=@agents/api dev` from anywhere both work.
try {
  const envPath = `${workspaceRoot()}/.env`;
  process.loadEnvFile(envPath);
} catch {
  // .env is optional
}

const PORT = Number(process.env.API_PORT ?? 3848);

/**
 * Routes that don't require auth. /healthz so health checks work without a
 * cookie; /auth/* so users can sign in.
 */
const PUBLIC_PATHS = new Set([
  "/api/healthz",
  // Auth submission endpoints have to be reachable without a session.
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/signup",
  "/api/auth/signup-open",
]);
function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  // Webhook triggers are auth'd by their own HMAC signature, not the user
  // session — external systems posting here don't carry cookies.
  if (path.startsWith("/api/triggers/")) return true;
  return false;
}

/** Hono context variables keyed by name — see c.get("user") downstream. */
export type AppVariables = { user: User };

export function createApp(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", honoLogger());
  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  const api = new Hono<{ Variables: AppVariables }>();
  api.get("/healthz", (c) => c.json({ status: "ok" }));

  // Auth middleware: every /api/* request except the explicitly-public
  // routes (healthz + login/logout/signup) must be authenticated. Two
  // paths accepted:
  //   1. Authorization: Bearer agt_<token>  — programmatic / CLI access
  //   2. Cookie session                     — browser UI
  // First match wins; downstream handlers read `c.var.user`.
  api.use("*", async (c, next) => {
    const path = c.req.path;
    if (isPublicPath(path)) return next();

    const authz = c.req.header("authorization") ?? c.req.header("Authorization");
    if (authz && authz.startsWith("Bearer ")) {
      const token = authz.slice("Bearer ".length).trim();
      const user = await verifyApiToken(token);
      if (user) {
        c.set("user", user);
        return next();
      }
      return c.json({ error: "invalid_token" }, 401);
    }

    const sid = getCookie(c, COOKIE_NAME);
    if (!sid) {
      return c.json({ error: "not_authenticated" }, 401);
    }
    const user = await validateSession(sid);
    if (!user) {
      return c.json({ error: "not_authenticated" }, 401);
    }
    c.set("user", user);
    return next();
  });

  api.route("/auth", authRouter);

  // Webhook triggers — `POST /api/triggers/<path>`. The path-to-agent map is
  // populated by registerAllTriggers() at boot.
  api.post("/triggers/:path", async (c) => {
    const path = c.req.param("path");
    const rawBody = await c.req.text();
    const sigHeader =
      c.req.header("X-Signature") ?? c.req.header("X-Hub-Signature-256");
    const result = await dispatchWebhook({
      path,
      rawBody,
      signatureHeader: sigHeader,
    });
    return c.json(result.body, result.status);
  });
  // Generate must mount BEFORE /agents to avoid the catch-all "/:id" route
  // matching "/generate" as an id lookup.
  api.route("/agents/generate", agentsGenerateRouter);
  // Refine sits at /agents/:id/refine — share the :id pattern with the main
  // agents router; mount BEFORE it so the path is resolved before the
  // PATCH/DELETE /:id handlers swallow it.
  api.route("/agents", agentsRefineRouter);
  api.route("/agents", agentMemoryRouter);
  api.route("/agents", agentsRouter);
  api.route("/sessions", sessionsRouter);
  api.route("/runs", runsRouter);
  api.route("/connectors", connectorsRouter);
  api.route("/skills", skillsRouter);
  api.route("/mcp-servers", mcpRouter);
  api.route("/repos", reposRouter);
  api.route("/pr-activity", prActivityRouter);
  api.route("/usage", usageRouter);
  api.route("/approvals", approvalsRouter);
  api.route("/capabilities", capabilitiesRouter);
  api.route("/notifications", notificationsRouter);
  api.route("/tokens", tokensRouter);
  api.route("/templates", templatesRouter);
  api.route("/tasks", tasksRouter);
  api.route("/context", userContextRouter);
  app.route("/api", api);

  app.onError((err, c) => {
    logger.error("api error", { error: err.message, stack: err.stack });
    return c.json({ error: "internal_error", message: err.message }, 500);
  });

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  return app;
}

async function main() {
  // Bootstrap auth before anything else — creates the default admin user
  // on first boot and claims orphan resources. Idempotent on subsequent
  // boots (no-op if any user exists).
  const bootstrapped = await bootstrapDefaultUser().catch((err) => {
    logger.warn("Auth bootstrap failed", { error: String(err) });
    return undefined;
  });
  if (bootstrapped) {
    const usingDefaults =
      !process.env.AGENTS_DEFAULT_ADMIN_PASSWORD ||
      process.env.AGENTS_DEFAULT_ADMIN_PASSWORD === "admin";
    logger.warn("Default admin user created", {
      email: bootstrapped.email,
      usingDefaultPassword: usingDefaults,
      hint: usingDefaults
        ? "Set AGENTS_DEFAULT_ADMIN_PASSWORD before first boot in production. Change the password via the UI now."
        : undefined,
    });
  }

  // Seed the built-in agent template catalog (idempotent upsert).
  const templateCount = await seedDefaultTemplates().catch((err) => {
    logger.warn("Template seed failed", { error: String(err) });
    return 0;
  });
  if (templateCount > 0) {
    logger.info("Templates seeded", { count: templateCount });
  }

  // Register action executors so approve calls can dispatch them
  // synchronously. New action kinds register here.
  registerPrCommentExecutor();
  registerPrCreateExecutor();
  registerSlackMessageExecutor();
  registerGitCommitPushExecutor();
  registerGithubReviewExecutor();
  registerShellCommandExecutor();

  // Register notification senders. New transports plug in here.
  registerConsoleSender();
  registerWebhookSender();
  registerSlackSender();

  await syncFileAgents().catch((err) =>
    logger.warn("File-agent sync failed", { error: String(err) }),
  );
  await syncSkills(workspaceRoot()).catch((err) =>
    logger.warn("Skill sync failed", { error: String(err) }),
  );

  let worker: WorkerHandle | undefined;
  if (process.env.API_DISABLE_WORKER !== "1") {
    worker = startWorker();
    logger.info("worker started");
  } else {
    logger.info("worker disabled via API_DISABLE_WORKER=1");
  }

  let triggers: TriggersHandle | undefined;
  if (process.env.API_DISABLE_TRIGGERS !== "1") {
    triggers = await registerAllTriggers();
  } else {
    logger.info("triggers disabled via API_DISABLE_TRIGGERS=1");
  }

  const app = createApp();
  const apiHandler = getRequestListener(app.fetch);

  // Two listen paths: dev runs Vite middleware-mode for HMR; production
  // skips Vite entirely and serves the prebuilt web bundle as static
  // files (smaller surface, smaller container, no need for Vite at runtime).
  const webDir = resolve(workspaceRoot(), "agents", "web");
  const isProd = process.env.NODE_ENV === "production";

  let stop: () => Promise<void>;

  if (isProd) {
    const webDist = resolve(webDir, "dist");
    if (!existsSync(webDist)) {
      throw new Error(
        `NODE_ENV=production but ${webDist} doesn't exist. Build the web bundle first: \`pnpm web:build\`.`,
      );
    }
    const indexPath = resolve(webDist, "index.html");
    const indexHtml = await readFile(indexPath, "utf-8");

    const { serve } = await import("@hono/node-server");
    const { serveStatic } = await import("@hono/node-server/serve-static");
    // Static under /assets and the root index, then a catch-all that
    // serves index.html for SPA routing. The api routes are already
    // mounted under /api by createApp().
    app.use(
      "/assets/*",
      serveStatic({ root: relative(process.cwd(), webDist) }),
    );
    app.use(
      "/vite.svg",
      serveStatic({ root: relative(process.cwd(), webDist) }),
    );
    app.get("*", (c) => c.html(indexHtml));

    const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
    logger.info("listening", {
      port: PORT,
      url: `http://localhost:${PORT}`,
      mode: "production",
    });
    stop = () =>
      new Promise<void>((resolve) => server.close(() => resolve()));
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: webDir,
      appType: "spa",
      server: { port: PORT, strictPort: true },
      // Quiet Vite's own "ready in Xms" line — we log our own.
      logLevel: "warn",
      plugins: [
        {
          name: "agents-api",
          configureServer(server) {
            // Pre-hook: runs BEFORE Vite's transform / static / SPA middlewares.
            // Anything under /api/* is handed to Hono; everything else falls
            // through to Vite via next().
            server.middlewares.use((req, res, next) => {
              const url = req.url ?? "/";
              if (url === "/api" || url.startsWith("/api/")) {
                apiHandler(req, res);
              } else {
                next();
              }
            });
          },
        },
      ],
    });

    await vite.listen(PORT);
    logger.info("listening", {
      port: PORT,
      url: `http://localhost:${PORT}`,
      mode: "dev",
    });
    stop = () => vite.close().catch(() => undefined) as Promise<void>;
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down");
    if (triggers) await triggers.stop();
    if (worker) await worker.stop();
    await stop();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  const entryUrl = new URL(import.meta.url).pathname;
  return entryUrl === process.argv[1];
})();

if (isMain) {
  main().catch((err) => {
    logger.error("api startup failed", { error: String(err) });
    process.exit(1);
  });
}
