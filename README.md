# Local Agents

A Turborepo monorepo for running autonomous AI agents locally, powered by the [Claude Agent SDK](https://docs.anthropic.com).

Each agent is a self-contained package under `agents/` — defined by a system prompt (`AGENTS.md`) and an execution config (`agent.config.ts`). A shared scheduler orchestrates triggers (cron, webhooks, GitHub events, file watchers) and runs agents via the Claude Agent SDK. A REST API and React dashboard expose the platform for inspection and manual control.

## Structure

```
agents/
├── sdk/              ← @agents/sdk — shared runtime (defineAgent, runner, logger, types)
├── core/             ← @agents/core — Postgres schema (Drizzle), secrets adapter (OS keychain)
├── scheduler/        ← @agents/scheduler — orchestration engine (cron, webhooks, GitHub poller)
├── api/              ← @agents/api — Hono REST server + Postgres-queue worker (port 3848)
├── web/              ← @agents/web — Vite + React dashboard (port 5173)
├── pr-reviewer/      ← example agent — reviews PRs across GitHub repos
└── your-agent/       ← add your own agents here
```

## Prerequisites

- Node.js **20+**
- pnpm **9.15+** (`npm install -g pnpm`)
- Docker (for the Postgres + Redis stack)
- A Claude Max subscription OAuth token (see [Authentication](#authentication))

## Quick start

From a fresh clone:

```bash
# 1. Install dependencies
pnpm install

# 2. Copy the env template and fill in your OAuth token
cp .env.example .env
# Edit .env and set CLAUDE_CODE_OAUTH_TOKEN=<your-token>

# 3. Bring up Postgres + Redis (+ Adminer on :8080)
pnpm compose:up

# 4. Build everything
pnpm build

# 5. Run database migrations (creates the 14 platform tables)
pnpm db:migrate

# 6. Start the API + web dashboard (in two terminals)
pnpm api      # → http://localhost:3848
pnpm web      # → http://localhost:5173

# 7. Open the dashboard
open http://localhost:5173
```

Click into the `pr-reviewer` agent and hit **Run now** to enqueue a run. The session-detail page polls live as the SDK streams events into the timeline.

## Authentication

Agents authenticate via a Claude Max subscription OAuth token:

```bash
claude setup-token
```

Set the token in `.env` at the repo root:

```
CLAUDE_CODE_OAUTH_TOKEN=<your-token>
```

`.env.example` documents every environment variable the platform reads (database URL, redis URL, ports, optional Slack webhook, optional GitHub state dir).

## Common commands

```bash
# Infrastructure
pnpm compose:up                 # start Postgres + Redis + Adminer
pnpm compose:down               # stop the stack
pnpm compose:logs               # follow container logs
pnpm db:migrate                 # apply Drizzle migrations

# API + UI
pnpm api                        # REST server, port 3848
pnpm web                        # React dashboard, port 5173 (proxies /api/* → 3848)
pnpm api:build                  # build just the api package
pnpm web:build                  # build just the web package

# Build / test / typecheck (whole monorepo)
pnpm build                      # turbo build
pnpm check-types                # turbo check-types
pnpm test                       # turbo test

# Agents (CLI, scheduler-driven)
pnpm agent-list                 # show discovered agents and triggers
pnpm agent-run -- pr-reviewer   # manually trigger an agent
pnpm agent-logs -- pr-reviewer  # tail the latest run log
pnpm scheduler                  # start the scheduler daemon (dev)

# Scheduler (pm2, production)
pnpm scheduler:start            # start scheduler via pm2
pnpm scheduler:stop             # stop scheduler
pnpm scheduler:restart          # rebuild + restart
pnpm scheduler:logs             # tail pm2 logs
```

## Web UI

`pnpm web` brings up a dashboard at `http://localhost:5173` with:

- **Agents** — list of discovered agents, each with system prompt, config, recent runs, and a **Run now** button
- **Sessions** — every agent execution with status (active → completed/failed/timeout/aborted) and a live event timeline
- **Connectors / Skills / MCP servers / PR activity** — registries surfaced as they land

Both detail pages auto-poll while a run is in flight, so the UI updates without a refresh.

## Creating a new agent

Each agent needs 4 files: `AGENTS.md`, `agent.config.ts`, `package.json`, `tsconfig.json`. No `src/index.ts` — the SDK runner handles execution.

```bash
mkdir -p agents/my-agent
# scaffold the 4 files (see agents/pr-reviewer/ as a reference)
pnpm turbo build --filter=@agents/my-agent
pnpm agent-list                # confirms discovery
pnpm agent-run -- my-agent     # smoke test
```

See [`AGENTS.md`](./AGENTS.md) for the full guide on agent structure, triggers, skills, and orchestration.

## Example: PR reviewer

The included `pr-reviewer` agent demonstrates a GitHub-triggered agent that:

- Watches for PR events (opened, reopened, synchronized) on configured repos
- Clones the repo, checks out the PR branch, reads the diff
- Discovers project conventions from docs (CLAUDE.md, README, etc.)
- Posts a structured code review via `gh` CLI
- Supports both formal GitHub reviews and PR comments
- Optionally labels PRs based on review outcome

Configure repos in `agents/pr-reviewer/agent.config.ts`.

## Scheduler triggers

- **Cron** — run on a schedule
- **Webhook** — `POST /trigger/{agent}` (port 3847)
- **GitHub** — react to PR/issue events via polling
- **File watch** — react to file changes
- **Inter-agent** — chain agents together
- **Manual** — always available via `pnpm agent-run` or the dashboard's **Run now** button

## License

Private — for personal use.
