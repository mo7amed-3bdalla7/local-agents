# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the local-agents-me api service.
#
#  - deps   resolves the pnpm workspace and installs ALL dependencies
#  - build  compiles every package (api + web bundle + shared libs)
#  - runtime small image with node + pnpm + git + gh; serves the api
#           and the built web bundle on a single port.
#
# Agents shell out to `pnpm -w jira`, `gh pr create`, `git commit` etc.
# during runs, so the runtime image needs all three tools + the
# workspace source on disk.

# ---------------------------------------------------------------------------
# Stage 1: deps
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace metadata first for layer caching. Package manifests only —
# source comes in the build stage so a source edit doesn't bust the deps
# cache.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY agents/api/package.json                  agents/api/
COPY agents/cli/package.json                  agents/cli/
COPY agents/core/package.json                 agents/core/
COPY agents/jira-triage/package.json          agents/jira-triage/
COPY agents/pr-incoming-review/package.json   agents/pr-incoming-review/
COPY agents/pr-reviewer/package.json          agents/pr-reviewer/
COPY agents/scheduler/package.json            agents/scheduler/
COPY agents/sdk/package.json                  agents/sdk/
COPY agents/web/package.json                  agents/web/

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: build
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# Drizzle migrations are checked in at agents/core/drizzle/ — preserved
# automatically by COPY .
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# OS deps:
#   git  — repo cloning + the git_commit_push executor's workspace clones
#   gh   — pr_create / pr_comment / github_review executors
#   tini — proper PID 1 so SIGTERM reaches the node process cleanly
#   ca-certificates — HTTPS to GitHub / Slack / Anthropic
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       git \
       gnupg \
       tini \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       > /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy the whole built workspace. Agents need pnpm + the workspace tree
# present at runtime because they invoke `pnpm -w jira` etc. via Bash.
COPY --from=build /app /app

ENV NODE_ENV=production \
    AGENTS_DATA_DIR=/data \
    AGENTS_WORKSPACE_ROOT=/data/workspaces \
    AGENTS_SECRETS_BACKEND=file \
    PORT=3848

# /data persists secrets + task workspaces across container restarts —
# mount as a volume in docker-compose.
VOLUME ["/data"]

EXPOSE 3848

# Run migrations on every start (idempotent) and then boot the api.
# tini handles signal forwarding so SIGTERM from `docker stop` cleanly
# shuts down the worker + db pool.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "pnpm db:migrate && node agents/api/dist/server.js"]
