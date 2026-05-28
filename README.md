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

- Docker + Docker Compose
- A Claude Max subscription OAuth token (mint with `claude setup-token`)
- *(Only for dev mode from source)* Node.js **20+**, pnpm **9.15+**

## Quick start — one command

```bash
# 1. Env
cp .env.example .env
# Edit .env and set at minimum:
#   CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`>
#   AGENTS_SECRETS_KEY=$(openssl rand -base64 32)
#   (optional) AGENTS_DEFAULT_ADMIN_PASSWORD=<something not "admin">
#   (optional) GH_TOKEN=<a github PAT for the pr_create / git_commit_push executors>

# 2. Up
docker compose up -d
#    Brings up postgres, redis, adminer (db viewer on :8080), and the api+dashboard
#    on :3848. The api container runs db:migrate automatically before booting.

# 3. Open the dashboard
open http://localhost:3848
#    Sign in as admin@local / admin (or whatever you set AGENTS_DEFAULT_ADMIN_PASSWORD to).
```

The api container bundles `git`, `gh`, `pnpm`, and the full workspace, so every executor (pr_create, git_commit_push, shell_command, pr_comment, github_review, slack_message) and every CLI agents shell out to (`pnpm -w jira`, `gh pr review`) works inside the container. Secrets live AES-GCM-encrypted under `./data/agents/secrets/`. Task workspaces under `./data/agents/workspaces/`. Both survive `docker compose down`.

Click into `pr-reviewer` and hit **Run now**. The session-detail page streams events live over SSE.

### From source (dev mode)

For HMR on the web bundle and tsx-watch on the api:

```bash
pnpm install
pnpm build
pnpm compose:up                       # just postgres / redis / adminer
DATABASE_URL=postgres://agents:agents@localhost:5432/agents pnpm db:migrate
DATABASE_URL=postgres://agents:agents@localhost:5432/agents pnpm api
```

On macOS the dev mode picks up keytar automatically (secrets land in the OS Keychain). Inside the container the file-backed adapter is used unconditionally so secrets survive restarts.

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

Whichever path you took above (`docker compose up -d` or `pnpm api` from source), everything lives on `http://localhost:3848`:

| Page | What it shows |
|---|---|
| **Agents** | All visible agents, source badge (file/db), a **DRY RUN** badge if mutating tools are stripped, **Run now** + **Refine with AI** buttons on the detail page. Per-agent **Memory** editor (MEMORY.md scratchpad that persists across runs) |
| **Templates** | Pre-built recipes you can Clone into your own db-source agents. Includes `senior-engineer`, `pr-review-lite`, `daily-digest`, `jira-triage-lite` |
| **Tasks** | Bundle a brief + N linked repos for a single agent run. The platform clones each linked repo into a shared workspace dir + writes `BRIEF.md` + (optional) `CONTEXT.md` at the root; the agent runs with that as `cwd` |
| **Context** | Single per-owner markdown doc materialized as `CONTEXT.md` at the root of every task workspace. The place for coding style, on-call, sprint goals, glossary — anything that should apply across every repo. Edit, save; next task picks it up |
| **Sessions** | Filterable list (status chips, agent, date range — URL-state-driven) + per-session live event timeline (typed cards) |
| **Approvals** | Side-effecting actions agents have proposed waiting for human approval. Tabs for Pending / Executed / Rejected / Failed |
| **Capabilities** | Self-documenting surface: every registered executor (with payload field tables + example JSON) and every notification sender. Discovery for users authoring agent prompts |
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
| **github** | `{type:"github", repo:"owner/name", events:["pr:opened",…], materializeTask?:boolean}` | gh CLI poller, state-diffed across cycles. `materializeTask:true` on a PR event auto-creates a task with the PR branch checked out (see Tasks below) |
| **agent** | `{type:"agent", source:"upstream-name", onSuccess?, onFailure?}` | pipeline — fires downstream on completion |

Cycles in inter-agent pipelines are detected at startup and logged.

## Approvals + Notifications

**Approvals**: agents stage side-effecting actions via a built-in MCP tool `propose_action({kind, title, description, payload})`. Each action lands in `pending_actions` with `status=pending`; a human approves in the UI, the registered executor for that `kind` runs synchronously and writes back `executed` or `failed` with the result/error.

Shipped executors (see [/capabilities](http://localhost:3848/capabilities) for live schemas):

| Kind | Category | What it does |
|---|---|---|
| `pr_comment` | github | `gh pr comment <num> --body …` |
| `pr_create` | github | `gh pr create --head <branch> --title --body` — opens the PR after a commit branch is pushed |
| `github_review` | github | `gh pr review --<event> --body …` (`approve` / `request_changes` / `comment`) |
| `git_commit_push` | github | Stages files, commits, pushes from the task workspace → central clone → github. Only runs on task-bound actions |
| `shell_command` | workspace | `bash -c <cmd>` in the task workspace. cwd is confined; path-escape attempts reject before exec |
| `slack_message` | messaging | Posts via the owner's `slack` notification channel |

**Notifications**: `dispatchEvent({ownerId, event, …})` fans out to every enabled subscribed channel. Events: `run_succeeded | run_failed | approval_pending | approval_failed`. Senders are pluggable — shipped: `console`, `webhook` (HMAC-signed JSON POST), `slack` (incoming webhook).

Adding a new executor or sender is a single file + one `registerExecutor` / `registerSender` call at startup.

## Tasks + senior engineer

A **task** bundles a free-form brief and N linked repos into a single agent invocation. Use it when you want one requirement that spans multiple codebases — "migrate the auth layer", "bump the shared schema in every consumer", "draft the README updates for these three services". The platform handles the cross-repo plumbing so the agent gets a clean workspace and well-structured context.

**Workflow:**
1. **Set your context (once, persistent).** Open [/context](http://localhost:3848/context) and write the cross-cutting things that should apply across every repo: coding style, on-call rotation, sprint goals, glossary. This becomes `CONTEXT.md` at the root of every task workspace you create.
2. **Pick or clone an agent.** The shipped `senior-engineer` template under [/templates](http://localhost:3848/templates) is built for this — Opus, 30-turn budget, $5 cost cap, system prompt that says "read CONTEXT.md and BRIEF.md first, follow project conventions, minimal diffs, run tests, stage every commit + PR via `propose_action`."
3. **Create the task at [/tasks](http://localhost:3848/tasks)** with: title, brief (markdown ok), agent, repo multiselect. Or skip the form — wire a github trigger with `materializeTask:true` so an incoming `pr:opened` / `pr:reviewed` event auto-creates a task pre-checked-out on the PR branch.
4. **The platform materializes a workspace** at `$HOME/.agents/workspaces/<task-id>/` (override with `AGENTS_WORKSPACE_ROOT`):
   ```
   workspaces/<task-id>/
   ├── CONTEXT.md                     ← your /context body (when set)
   ├── MEMORY.md                      ← the agent's scratchpad from prior runs (persisted back after each run)
   ├── BRIEF.md                       ← this task's brief + linked-repo metadata
   ├── owner__repo-a/                 ← fresh local clone of repo A's default branch
   └── owner__repo-b/                 ← fresh local clone of repo B's default branch
   ```
   Clones are local-clones from the central worktree dir (fast — hardlinks where possible) and disconnected from origin, so accidental pushes can't escape. When the task was bridged from a github PR trigger, the linked repo is already checked out on the PR's head branch.
5. **The agent runs with that workspace as `cwd`.** It reads CONTEXT.md → MEMORY.md → BRIEF.md → each touched repo's own `AGENTS.md`/`CLAUDE.md`/`README.md`, in that order. Before exiting, it edits MEMORY.md (via `Edit`/`Write`) with any insights worth carrying forward; the worker persists those changes after the run finishes so the next task on the same agent inherits them.
6. **Commits, PRs, reviews always go through `propose_action`.** The senior-engineer template instructs the agent to stage every side effect for human approval:
   - `propose_action({kind: "git_commit_push", payload: { repo, branch, message, files }})` to commit + push a branch
   - `propose_action({kind: "pr_create", payload: { repo, head, base, title, body }})` to open the PR
   - `propose_action({kind: "github_review", ... })` / `propose_action({kind: "pr_comment", ... })` to respond to a review
   - `propose_action({kind: "shell_command", payload: { cmd } })` to run tests/builds in the workspace before staging anything
   A human reviews on the Approvals page before any change reaches a real remote. Direct `git commit` / `git push` / `gh pr create` from the agent is a contract violation.

**Four layers of context.** A task agent sees four sources of context, smallest scope wins on project-specific patterns:

| Layer | Scope | Direction | Source | Lives at |
|---|---|---|---|---|
| `CONTEXT.md` | Per owner (cross-cutting) | static | `/context` UI | Workspace root |
| `MEMORY.md` | Per agent (across runs) | read + write | `agent_memory` table — written by the agent during runs, persisted by the worker | Workspace root |
| `BRIEF.md` | Per task (this requirement) | static | task `brief` field | Workspace root |
| `AGENTS.md` / `CLAUDE.md` / `README.md` | Per repo (project conventions) | static | the repo itself | Each repo dir |

**Branch policy.** Tasks link repos at their default branch by default. The senior-engineer can target a different branch in the `git_commit_push` payload; the github→task bridge pre-checks-out the PR's head branch when the trigger fires with `materializeTask:true`.

**Task lifecycle.** `pending → active → completed | failed`. The detail page polls 3s while in-flight, 10s otherwise. Workspaces are left on disk after the task finishes for inspection; clean up with `rm -rf $HOME/.agents/workspaces/<task-id>` when you're done.

## Real-world workflows

The four most common ways to use this platform:

| Goal | Path |
|---|---|
| **Verify a Jira ticket against code** (single or multi-repo, output open questions + impact) | Task with brief = "Verify JIRA-123 against the linked repos, list open questions and impact" → senior-engineer (with jira connector attached so it can `pnpm jira issue get` via Bash). Read-only — no `propose_action` calls. |
| **Develop a Jira ticket → open PR(s)** | Task with brief = the ticket body, linked repos = the codebases in scope → senior-engineer → `git_commit_push` per repo → `pr_create` per repo. Every step human-approved. |
| **Address review feedback on my PR + push fix locally** | Github trigger with `events:["pr:reviewed"]` + `materializeTask:true` on an owned agent. Trigger auto-creates a task pre-checked-out on the PR branch with review comments in BRIEF.md. Agent reads, fixes, `git_commit_push({branch: <PR head>})`. |
| **Review other team members' PRs** | Use `pr-incoming-review` (file-source agent in this repo). Fill in `repos` in its `agent.config.ts`, restart, `gh auth login`. The github poller fires on `pr:opened`/`synchronize`/`reopened`; the agent reviews, stages the verdict via `propose_action({kind:"github_review"})`. |

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

### Docker (the default path)

```bash
docker compose up -d                                    # whole platform: postgres + api+UI on :3848 + adminer on :8080
docker compose down                                     # stop everything (volume at ./data/agents/ persists)
docker compose down -v                                  # also drop the volume — full reset
docker compose logs -f api                              # tail api logs (request/response, run lifecycle)
docker compose build api                                # rebuild after a code change (~30s)
docker compose up -d --no-deps --build api              # rebuild + restart just api, keep db running
docker compose exec api sh                              # shell into the running api container
docker compose exec api pnpm -w jira issue search ...   # invoke a workspace CLI inside the container
```

### From source (dev mode)

```bash
# Infrastructure
pnpm compose:up | compose:down | compose:logs           # Postgres only
pnpm db:migrate                                          # Drizzle migrations

# Platform
pnpm api                                                 # API + UI with Vite HMR, port 3848
pnpm web                                                 # standalone web dev (rare; UI is mounted in api)
pnpm cli <command>                                       # talk to the API as a user (mint a token at /tokens first)

# Build / typecheck / test
pnpm build | check-types | test

# Scheduler (legacy stand-alone process — most users won't need this;
# the api server hosts the scheduler internally)
pnpm scheduler              | scheduler:start | scheduler:stop | scheduler:restart
pnpm agent-list | agent-run -- <name> | agent-logs -- <name>
```

## License

Private — for personal use.
