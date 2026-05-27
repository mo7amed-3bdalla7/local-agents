# Local Agents

A self-hosted platform for running autonomous AI agents locally, powered by the [Claude Agent SDK](https://docs.anthropic.com). Each agent is a self-contained package with a system prompt and an execution config; a shared scheduler drives them on cron / webhook / GitHub / file / inter-agent triggers, the Hono API exposes everything as REST + SSE, and a React dashboard plus a Bearer-auth CLI give you two ways to drive the system.

## Structure

```
agents/
├── sdk/                ← @agents/sdk — runner, defineAgent, runtime types
├── core/               ← @agents/core — Postgres schema (Drizzle), secrets (OS keychain),
│                              auth, tokens, approvals, notifications
├── scheduler/          ← @agents/scheduler — orchestration engine (5 trigger types)
├── api/                ← @agents/api — Hono REST + Vite-embedded UI + Postgres queue worker
│                              (single process on port 3848)
├── web/                ← @agents/web — React dashboard (mounted by the api server)
├── cli/                ← @agents/cli — `agents …` Bearer-auth control plane
├── pr-reviewer/        ← example agent — generic PR reviewer
├── pr-incoming-review/ ← example agent — first-pass review for external PRs
└── jira-triage/        ← example agent — classify the Jira backlog
```

## Prerequisites

- Node.js **20+**
- pnpm **9.15+** (`npm install -g pnpm`)
- Docker (for the Postgres stack)
- A Claude Max subscription OAuth token

## Quick start

```bash
# 1. Install
pnpm install

# 2. Env
cp .env.example .env
# Edit .env and set CLAUDE_CODE_OAUTH_TOKEN=<run `claude setup-token` to mint one>

# 3. Postgres
pnpm compose:up                                          # postgres on :5432, adminer on :8080

# 4. Build everything
pnpm build

# 5. Migrate the database
pnpm db:migrate

# 6. Start the platform (API + dashboard on a single port)
pnpm api                                                 # http://localhost:3848

# 7. Open the dashboard, sign in with the bootstrap admin
#    Default user: admin@local / admin   (override via AGENTS_DEFAULT_ADMIN_PASSWORD)
open http://localhost:3848
```

Click into `pr-reviewer` and hit **Run now**. The session-detail page streams events live over SSE.

## Authentication, in two layers

There are two distinct credentials at play, easy to confuse:

1. **Claude Max OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`) — how *agents* talk to Claude. Stored in `.env`, used by every run. Mint via `claude setup-token` once.
2. **User session** (cookies) or **API token** (`Bearer agt_...`) — how *you* talk to this platform. The dashboard uses cookies after `/login`; the CLI uses tokens minted at `/tokens`.

The default admin is `admin@local` / `admin`. Override before first boot with `AGENTS_DEFAULT_ADMIN_PASSWORD` (and `_EMAIL`, `_NAME`). Subsequent users are created by the admin via the API.

Resources are owned per-user — `db`-source agents, connectors, MCP servers, repos, secrets, tokens, and notification channels are private to their owner. `file`-source agents (discovered on disk) are shared baseline.

## CLI

`@agents/cli` lets you script everything the dashboard does:

```bash
# Mint a token at /tokens in the UI, then:
pnpm cli login --token agt_...
pnpm cli whoami
pnpm cli agents list
pnpm cli agents run pr-reviewer
pnpm cli runs tail 42                # streams the SSE event timeline
pnpm cli sessions list --limit 10
pnpm cli tokens mint my-cron-job
pnpm cli tokens revoke <id>
```

Config persists at `~/.config/agents/config.json` (0600). Override at runtime with `AGENTS_API` and `AGENTS_TOKEN`.

## Dashboard tour

`pnpm api` boots everything on `http://localhost:3848`:

| Page | What it shows |
|---|---|
| **Agents** | All visible agents, source badge (file/db), a **DRY RUN** badge if mutating tools are stripped, **Run now** button on the detail page |
| **Sessions** | Filterable list (status chips, agent, date range — URL-state-driven) + per-session live event timeline (typed cards) |
| **Approvals** | Side-effecting actions agents have proposed (PR comments, Slack messages, …) waiting for human approval. Tabs for Pending / Executed / Rejected / Failed |
| **Notifications** | Channels (console, webhook, slack), Subscriptions matrix (events × channels), Deliveries audit log |
| **Connectors / Skills / MCP servers / Repos** | Registries with CRUD + Test buttons |
| **API tokens** | Mint (plaintext shown once), revoke, see last-used |
| **Usage** | Per-agent + per-day cost / token rollups (last 7 days by default) |
| **PR activity** | Audit log of comments and commits agents have posted under your GitHub identity |

Per-agent **stats panel** above each agent detail page: success rate, p50/p95 duration, total cost, recent failures.

## Triggers

Defined in each agent's `agent.config.ts` and registered automatically when the API server starts. Five types:

| Type | Shape | Notes |
|---|---|---|
| **cron** | `{type:"cron", schedule:"0 9 * * *", timezone?, skipIfRunning?}` | node-cron, agent-side timezone aware |
| **webhook** | `{type:"webhook", path?, secret?, passBody?}` | `POST /api/triggers/<path>`, HMAC-SHA256 verified, exempt from user auth |
| **file** | `{type:"file", patterns:["src/**/*.ts"], debounceMs?}` | chokidar (polling on macOS) |
| **github** | `{type:"github", repo:"owner/name", events:["pr:opened",…]}` | gh CLI poller, state-diffed across cycles |
| **agent** | `{type:"agent", source:"upstream-name", onSuccess?, onFailure?}` | pipeline — fires downstream on completion |

Cycles in inter-agent pipelines are detected at startup and logged.

## Approvals + Notifications

**Approvals**: agents stage side-effecting actions via a built-in MCP tool `propose_action({kind, title, description, payload})`. Each action lands in `pending_actions` with `status=pending`; a human approves in the UI, the registered executor for that `kind` runs synchronously and writes back `executed` or `failed` with the result/error.

Shipped executors:
- `pr_comment` — `gh pr comment <num> --repo owner/name --body …`
- `slack_message` — posts via the owner's `slack` notification channel

**Notifications**: `dispatchEvent({ownerId, event, …})` fans out to every enabled subscribed channel. Events: `run_succeeded | run_failed | approval_pending | approval_failed`. Senders are pluggable — shipped: `console`, `webhook` (HMAC-signed JSON POST), `slack` (incoming webhook).

Adding a new executor or sender is a single file + one `registerExecutor` / `registerSender` call at startup.

## Creating a new agent

Each agent needs 4 files: `AGENTS.md`, `agent.config.ts`, `package.json`, `tsconfig.json`. No `src/index.ts` — the runner handles execution.

```bash
mkdir -p agents/my-agent
# scaffold the 4 files (see agents/pr-reviewer/ as a reference)
pnpm turbo build --filter=@agents/my-agent
pnpm cli agents list                # confirms discovery
pnpm cli agents run my-agent        # smoke test
```

See [`AGENTS.md`](./AGENTS.md) for the full guide on structure, triggers, skills, and orchestration.

Set `execution.dryRun: true` in `agent.config.ts` to strip `Edit`, `Write`, `Bash`, `NotebookEdit` from the agent's allowed tools at runtime — useful for testing prompts without letting the agent modify anything.

## Tests

```bash
pnpm test                                                # all packages (skips DB tests without DATABASE_URL)
DATABASE_URL=postgres://agents:agents@localhost:5432/agents pnpm test    # full suite
```

Node's built-in test runner via tsx. Today the suite covers password hashing, token format + lifecycle, and keychain round-trips; new tests live alongside the modules they cover (`*.test.ts`).

## Commands

```bash
# Infrastructure
pnpm compose:up | compose:down | compose:logs           # Postgres
pnpm db:migrate                                          # Drizzle migrations

# Platform
pnpm api                                                 # API + UI, port 3848
pnpm web                                                 # standalone web dev (rare; UI is mounted in api)
pnpm cli <command>                                       # talk to the API as a user

# Build / typecheck / test
pnpm build | check-types | test

# Scheduler (legacy stand-alone process — most users won't need this;
# the api server hosts the scheduler internally)
pnpm scheduler              | scheduler:start | scheduler:stop | scheduler:restart
pnpm agent-list | agent-run -- <name> | agent-logs -- <name>
```

## License

Private — for personal use.
