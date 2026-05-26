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

import { resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "@agents/sdk";
import { closeDb } from "@agents/core";
import { agentsRouter } from "./routes/agents.js";
import { sessionsRouter } from "./routes/sessions.js";
import {
  connectorsRouter,
  mcpRouter,
  prActivityRouter,
  reposRouter,
  runsRouter,
  skillsRouter,
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

export function createApp(): Hono {
  const app = new Hono();

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

  const api = new Hono();
  api.get("/healthz", (c) => c.json({ status: "ok" }));

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
  api.route("/agents", agentsRouter);
  api.route("/sessions", sessionsRouter);
  api.route("/runs", runsRouter);
  api.route("/connectors", connectorsRouter);
  api.route("/skills", skillsRouter);
  api.route("/mcp-servers", mcpRouter);
  api.route("/repos", reposRouter);
  api.route("/pr-activity", prActivityRouter);
  app.route("/api", api);

  app.onError((err, c) => {
    logger.error("api error", { error: err.message, stack: err.stack });
    return c.json({ error: "internal_error", message: err.message }, 500);
  });

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  return app;
}

async function main() {
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

  const { createServer: createViteServer } = await import("vite");
  const webDir = resolve(workspaceRoot(), "agents", "web");
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
  logger.info("listening", { port: PORT, url: `http://localhost:${PORT}` });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down");
    if (triggers) await triggers.stop();
    if (worker) await worker.stop();
    await vite.close().catch(() => undefined);
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
