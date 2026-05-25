/**
 * @agents/api — Hono REST server.
 *
 * Runs on port 3848 (configurable via API_PORT). Serves read-only views over
 * the platform state for the web UI. Mutating endpoints land alongside their
 * owning registries in later commits.
 */

import { serve } from "@hono/node-server";
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

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.route("/agents", agentsRouter);
  app.route("/sessions", sessionsRouter);
  app.route("/runs", runsRouter);
  app.route("/connectors", connectorsRouter);
  app.route("/skills", skillsRouter);
  app.route("/mcp-servers", mcpRouter);
  app.route("/repos", reposRouter);
  app.route("/pr-activity", prActivityRouter);

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

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info("api listening", { port: PORT });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("api shutting down");
    server.close();
    if (worker) await worker.stop();
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
