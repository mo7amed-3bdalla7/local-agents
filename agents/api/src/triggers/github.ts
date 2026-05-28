/**
 * GitHub PR/issue poller. Polls each subscribed repo with the local `gh`
 * CLI, diffs the response against persisted state, and on each detected
 * transition (pr:opened, pr:merged, issue:labeled, …) enqueues a run for
 * every subscribed agent.
 *
 * Lifted from agents/scheduler/src/github-poller.ts — the scheduler keeps
 * its own copy for the legacy `pnpm agent-run` CLI path. The only diff
 * is the single dispatch call: ExecutionManager.run → enqueueRun.
 *
 * State persists to $HOME/.agents-scheduler/github-state.json (override
 * with GITHUB_STATE_DIR). First poll per repo — both initial AND post-
 * restart — snapshots silently so we don't replay history.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  logger,
  type GitHubEvent,
  type GitHubTrigger,
  type TriggerContext,
} from "@agents/sdk";
import { enqueueRun } from "./dispatch.js";

// ---------- gh CLI JSON shapes (subset we care about) ----------

interface GhLabel { name: string }
interface GhAuthor { login: string }
interface GhReview { state: string; author: GhAuthor }
interface GhPR {
  number: number;
  state: string;
  title: string;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  isDraft: boolean;
  mergedAt: string | null;
  updatedAt: string;
  url: string;
  author: GhAuthor;
  labels: GhLabel[];
  reviews: GhReview[];
}

interface GhIssueLabel { name: string }
interface GhIssueAuthor { login: string }
interface GhIssueAssignee { login: string }
interface GhIssue {
  number: number;
  state: string;
  title: string;
  body: string;
  url: string;
  updatedAt: string;
  author: GhIssueAuthor;
  labels: GhIssueLabel[];
  assignees: GhIssueAssignee[];
  comments: { totalCount: number }[];
}

// ---------- Persisted state ----------

interface StoredPR {
  state: string;
  headRefOid: string;
  isDraft: boolean;
  merged: boolean;
  labels: string[];
  reviewCount: number;
}
interface StoredIssue {
  state: string;
  labels: string[];
  assignees: string[];
  commentCount: number;
}
interface RepoState {
  lastPoll: string;
  prs: Record<string, StoredPR>;
  issues?: Record<string, StoredIssue>;
}
type PollerState = Record<string, RepoState>;

// ---------- Registration ----------

interface RepoSubscription {
  agentName: string;
  events: GitHubEvent[];
  /** When true on PR events, materialize a task + workspace before enqueueing. */
  materializeTask: boolean;
  /**
   * Owner of the subscribing agent. Required when materializeTask is true
   * (tasks need an owner). Null for file-source agents — materializeTask
   * is silently ignored for those at fire time.
   */
  ownerId: string | null;
}
interface RepoPoller {
  repo: string;
  intervalMs: number;
  subscribers: RepoSubscription[];
  timer: ReturnType<typeof setInterval> | null;
}

const pollers: RepoPoller[] = [];
let stateDir = join(homedir(), ".agents-scheduler");
const freshRepos = new Set<string>();

function getStatePath(): string {
  return join(stateDir, "github-state.json");
}

async function loadState(): Promise<PollerState> {
  try {
    const raw = await readFile(getStatePath(), "utf-8");
    return JSON.parse(raw) as PollerState;
  } catch {
    return {};
  }
}

async function saveState(state: PollerState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(getStatePath(), JSON.stringify(state, null, 2));
}

// ---------- Retry ----------

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 2,
  baseDelayMs = 2000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(
          `${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`,
          { error: lastError.message },
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ---------- gh CLI wrappers ----------

const GH_PR_FIELDS = [
  "number", "state", "title", "headRefName", "baseRefName",
  "headRefOid", "isDraft", "mergedAt", "updatedAt", "url",
  "author", "labels", "reviews",
].join(",");

function ghPrList(repo: string): Promise<GhPR[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["pr", "list", "--repo", repo, "--state", "all", "--limit", "50", "--json", GH_PR_FIELDS],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`gh pr list failed for ${repo}: ${stderr || err.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as GhPR[]);
        } catch (parseErr) {
          reject(new Error(`Failed to parse gh output for ${repo}: ${String(parseErr)}`));
        }
      },
    );
  });
}

const GH_ISSUE_FIELDS = [
  "number", "state", "title", "body", "url", "updatedAt",
  "author", "labels", "assignees", "comments",
].join(",");

function ghIssueList(repo: string): Promise<GhIssue[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["issue", "list", "--repo", repo, "--state", "all", "--limit", "50", "--json", GH_ISSUE_FIELDS],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`gh issue list failed for ${repo}: ${stderr || err.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as GhIssue[]);
        } catch (parseErr) {
          reject(new Error(`Failed to parse gh issue output for ${repo}: ${String(parseErr)}`));
        }
      },
    );
  });
}

// ---------- Event diffing ----------

interface DetectedEvent {
  event: GitHubEvent;
  pr?: GhPR;
  issue?: GhIssue;
  addedLabels?: string[];
}

function snapshotPR(pr: GhPR): StoredPR {
  return {
    state: pr.state,
    headRefOid: pr.headRefOid,
    isDraft: pr.isDraft,
    merged: pr.mergedAt !== null,
    labels: pr.labels.map((l) => l.name).sort(),
    reviewCount: pr.reviews.length,
  };
}

function detectPREvents(current: GhPR[], stored: Record<string, StoredPR>): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  for (const pr of current) {
    const key = String(pr.number);
    const prev = stored[key];
    if (!prev) {
      if (pr.state === "OPEN") events.push({ event: "pr:opened", pr });
      continue;
    }
    const wasMerged = prev.merged;
    const isMerged = pr.mergedAt !== null;
    if (prev.state === "OPEN" && pr.state === "CLOSED" && isMerged) {
      events.push({ event: "pr:merged", pr });
    } else if (prev.state === "OPEN" && pr.state === "CLOSED" && !isMerged) {
      events.push({ event: "pr:closed", pr });
    } else if (prev.state === "CLOSED" && pr.state === "OPEN" && !wasMerged) {
      events.push({ event: "pr:reopened", pr });
    } else if (prev.state === "MERGED" && pr.state === "OPEN") {
      events.push({ event: "pr:reopened", pr });
    }
    if (pr.state === "OPEN" && prev.headRefOid !== pr.headRefOid) {
      events.push({ event: "pr:synchronize", pr });
    }
    if (pr.reviews.length > prev.reviewCount) {
      events.push({ event: "pr:reviewed", pr });
    }
    const currentLabels = pr.labels.map((l) => l.name).sort();
    const addedLabels = currentLabels.filter((l) => !prev.labels.includes(l));
    if (addedLabels.length > 0) {
      events.push({ event: "pr:labeled", pr, addedLabels });
    }
    if (prev.isDraft && !pr.isDraft) {
      events.push({ event: "pr:ready_for_review", pr });
    }
  }
  return events;
}

function snapshotIssue(issue: GhIssue): StoredIssue {
  return {
    state: issue.state,
    labels: issue.labels.map((l) => l.name).sort(),
    assignees: issue.assignees.map((a) => a.login).sort(),
    commentCount: Array.isArray(issue.comments)
      ? issue.comments.length
      : (issue.comments as unknown as { totalCount: number })?.totalCount ?? 0,
  };
}

function detectIssueEvents(current: GhIssue[], stored: Record<string, StoredIssue>): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  for (const issue of current) {
    const key = String(issue.number);
    const prev = stored[key];
    if (!prev) {
      if (issue.state === "OPEN") events.push({ event: "issue:opened", issue });
      continue;
    }
    if (prev.state === "OPEN" && issue.state === "CLOSED") {
      events.push({ event: "issue:closed", issue });
    } else if (prev.state === "CLOSED" && issue.state === "OPEN") {
      events.push({ event: "issue:reopened", issue });
    }
    const currentLabels = issue.labels.map((l) => l.name).sort();
    const addedLabels = currentLabels.filter((l) => !prev.labels.includes(l));
    if (addedLabels.length > 0) {
      events.push({ event: "issue:labeled", issue, addedLabels });
    }
    const currentAssignees = issue.assignees.map((a) => a.login).sort();
    const newAssignees = currentAssignees.filter((a) => !prev.assignees.includes(a));
    if (newAssignees.length > 0) {
      events.push({ event: "issue:assigned", issue });
    }
    const currentCommentCount = Array.isArray(issue.comments)
      ? issue.comments.length
      : (issue.comments as unknown as { totalCount: number })?.totalCount ?? 0;
    if (currentCommentCount > prev.commentCount) {
      events.push({ event: "issue:commented", issue });
    }
  }
  return events;
}

function buildPRMeta(
  repo: string,
  event: GitHubEvent,
  pr: GhPR,
  addedLabels?: string[],
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    event,
    repo,
    pr: {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      headRefOid: pr.headRefOid,
      isDraft: pr.isDraft,
      mergedAt: pr.mergedAt,
      url: pr.url,
      author: pr.author.login,
      labels: pr.labels.map((l) => l.name),
      reviewCount: pr.reviews.length,
    },
  };
  if (addedLabels?.length) meta.addedLabels = addedLabels;
  return meta;
}

function buildIssueMeta(
  repo: string,
  event: GitHubEvent,
  issue: GhIssue,
  addedLabels?: string[],
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    event,
    repo,
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      url: issue.url,
      author: issue.author.login,
      labels: issue.labels.map((l) => l.name),
      assignees: issue.assignees.map((a) => a.login),
    },
  };
  if (addedLabels?.length) meta.addedLabels = addedLabels;
  return meta;
}

// ---------- Poll one repo ----------

async function pollRepo(repo: string, subscribers: RepoSubscription[]): Promise<void> {
  logger.debug("Polling GitHub repo", { repo });

  const needsPRs = subscribers.some((s) => s.events.some((e) => e.startsWith("pr:")));
  const needsIssues = subscribers.some((s) => s.events.some((e) => e.startsWith("issue:")));

  let currentPRs: GhPR[] = [];
  let currentIssues: GhIssue[] = [];
  let prFetchOk = false;
  let issueFetchOk = false;

  if (needsPRs) {
    try {
      currentPRs = await withRetry(() => ghPrList(repo), `gh pr list ${repo}`);
      prFetchOk = true;
    } catch (err) {
      logger.error("GitHub PR poll failed after retries", { repo, error: String(err) });
    }
  }
  if (needsIssues) {
    try {
      currentIssues = await withRetry(() => ghIssueList(repo), `gh issue list ${repo}`);
      issueFetchOk = true;
    } catch (err) {
      logger.error("GitHub issue poll failed after retries", { repo, error: String(err) });
    }
  }

  if (needsPRs && !prFetchOk && needsIssues && !issueFetchOk) {
    logger.warn("All GitHub fetches failed — skipping state update", { repo });
    return;
  }
  if (needsPRs && !prFetchOk && !needsIssues) return;
  if (needsIssues && !issueFetchOk && !needsPRs) return;

  const state = await loadState();
  const repoState = state[repo];
  const isFirstRun = !repoState;

  const storedPRs = repoState?.prs ?? {};
  const storedIssues = repoState?.issues ?? {};

  const updatedPRs: Record<string, StoredPR> = prFetchOk ? {} : (repoState?.prs ?? {});
  if (prFetchOk) {
    for (const pr of currentPRs) updatedPRs[String(pr.number)] = snapshotPR(pr);
  }
  const updatedIssues: Record<string, StoredIssue> = issueFetchOk
    ? {}
    : (repoState?.issues ?? {});
  if (issueFetchOk) {
    for (const issue of currentIssues)
      updatedIssues[String(issue.number)] = snapshotIssue(issue);
  }

  if (isFirstRun) {
    state[repo] = {
      lastPoll: new Date().toISOString(),
      prs: updatedPRs,
      issues: updatedIssues,
    };
    await saveState(state);
    logger.info("First GitHub poll — snapshotted state, no events fired", {
      repo,
      prCount: currentPRs.length,
      issueCount: currentIssues.length,
    });
    return;
  }

  if (freshRepos.has(repo)) {
    freshRepos.delete(repo);
    state[repo] = {
      lastPoll: new Date().toISOString(),
      prs: updatedPRs,
      issues: updatedIssues,
    };
    await saveState(state);
    logger.info("First poll after restart — refreshed state, events suppressed", {
      repo,
      prCount: currentPRs.length,
      issueCount: currentIssues.length,
    });
    return;
  }

  const prEvents = needsPRs && prFetchOk ? detectPREvents(currentPRs, storedPRs) : [];
  const issueEvents =
    needsIssues && issueFetchOk ? detectIssueEvents(currentIssues, storedIssues) : [];
  const allEvents = [...prEvents, ...issueEvents];

  if (allEvents.length > 0) {
    logger.info("GitHub events detected", {
      repo,
      events: allEvents.map((e) => `${e.event}#${e.pr?.number ?? e.issue?.number}`),
    });
    for (const { event, pr, issue, addedLabels } of allEvents) {
      const matching = subscribers.filter((s) => s.events.includes(event));
      for (const sub of matching) {
        const baseMeta = pr
          ? buildPRMeta(repo, event, pr, addedLabels)
          : buildIssueMeta(repo, event, issue!, addedLabels);

        // Task-bridging path: only for PR events on subscribers that opted in
        // and have an owner (file-source agents fall through to the
        // run-only path with a one-line warning).
        if (sub.materializeTask && pr) {
          if (!sub.ownerId) {
            logger.warn(
              "github trigger has materializeTask=true but agent has no owner — falling back to run-only path",
              { repo, agent: sub.agentName },
            );
          } else {
            void materializeAndEnqueue({
              repo,
              event,
              pr,
              agentName: sub.agentName,
              ownerId: sub.ownerId,
              baseMeta,
            }).catch((err) =>
              logger.error("materializeAndEnqueue failed", {
                repo,
                event,
                prNumber: pr.number,
                agent: sub.agentName,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            continue;
          }
        }

        const ctx: TriggerContext = {
          triggerType: "github",
          triggeredAt: new Date().toISOString(),
          meta: baseMeta,
        };
        void enqueueRun(sub.agentName, ctx);
      }
    }
  }

  state[repo] = {
    lastPoll: new Date().toISOString(),
    prs: updatedPRs,
    issues: updatedIssues,
  };
  await saveState(state);
}

// ---------- Public API ----------

interface AgentGitHub {
  name: string;
  triggers: GitHubTrigger[];
  ownerId?: string | null;
}

export function registerGitHubTriggers(agents: AgentGitHub[]): number {
  const envStateDir = process.env.GITHUB_STATE_DIR;
  if (envStateDir) stateDir = envStateDir;
  const defaultInterval = Number(process.env.GITHUB_POLL_INTERVAL_MS ?? 60_000);

  const repoMap = new Map<
    string,
    { intervalMs: number; subscribers: RepoSubscription[] }
  >();

  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      const repo = trigger.repo;
      const sub: RepoSubscription = {
        agentName: agent.name,
        events: trigger.events,
        materializeTask: trigger.materializeTask === true,
        ownerId: agent.ownerId ?? null,
      };
      const interval = trigger.pollIntervalMs ?? defaultInterval;
      const existing = repoMap.get(repo);
      if (existing) {
        existing.subscribers.push(sub);
        existing.intervalMs = Math.min(existing.intervalMs, interval);
      } else {
        repoMap.set(repo, { intervalMs: interval, subscribers: [sub] });
      }
    }
  }

  let registered = 0;
  for (const [repo, { intervalMs, subscribers }] of repoMap) {
    freshRepos.add(repo);
    const poller: RepoPoller = { repo, intervalMs, subscribers, timer: null };

    pollRepo(repo, subscribers).catch((err) =>
      logger.error("Initial GitHub poll failed", { repo, error: String(err) }),
    );
    poller.timer = setInterval(() => {
      pollRepo(repo, subscribers).catch((err) =>
        logger.error("GitHub poll cycle failed", { repo, error: String(err) }),
      );
    }, intervalMs);

    pollers.push(poller);
    logger.info("GitHub poller registered", {
      repo,
      intervalMs,
      agents: subscribers.map((s) => s.agentName),
      events: [...new Set(subscribers.flatMap((s) => s.events))],
    });
    registered++;
  }
  return registered;
}

export function stopAllGitHubPollers(): void {
  for (const p of pollers) {
    if (p.timer) {
      clearInterval(p.timer);
      p.timer = null;
    }
  }
  pollers.length = 0;
  freshRepos.clear();
}

// ─── Task bridge for PR events ─────────────────────────────────────────────

interface MaterializeArgs {
  repo: string;
  event: GitHubEvent;
  pr: GhPR;
  agentName: string;
  ownerId: string;
  baseMeta: Record<string, unknown>;
}

/**
 * Bridge a PR trigger into a task: find the repo row, create the task,
 * materialize the workspace, check out the PR's head branch in the workspace
 * clone, then enqueue the agent run with taskId + workspacePath in meta.
 *
 * Fails (and falls back to a plain run with the warning logged) if the repo
 * isn't registered under this owner — the user has to /repos/new first.
 */
async function materializeAndEnqueue(args: MaterializeArgs): Promise<void> {
  const { repo, event, pr, agentName, ownerId, baseMeta } = args;

  // Lazy imports — keep this file's startup cost low for installs that
  // never wire materializeTask.
  const { getDb, schema, createTask, materializeTaskWorkspace } = await import(
    "@agents/core"
  );
  const { eq, and } = await import("drizzle-orm");

  const db = getDb();
  const [repoRow] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(
      and(
        eq(schema.repos.githubFullName, repo),
        eq(schema.repos.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!repoRow) {
    logger.warn(
      "materializeTask: repo not registered under owner — falling back to run-only path",
      { repo, agent: agentName, ownerId },
    );
    const ctx: TriggerContext = {
      triggerType: "github",
      triggeredAt: new Date().toISOString(),
      meta: baseMeta,
    };
    void enqueueRun(agentName, ctx);
    return;
  }

  const [agentRow] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.name, agentName))
    .limit(1);
  if (!agentRow) {
    logger.warn("materializeTask: agent row not found", { agentName });
    return;
  }

  const brief = [
    `# PR ${repo}#${pr.number}: ${pr.title}`,
    "",
    `**Event:** ${event}`,
    `**Branch:** \`${pr.headRefName}\` → \`${pr.baseRefName}\``,
    `**Author:** @${pr.author?.login ?? "?"}`,
    `**URL:** ${pr.url}`,
    "",
    "## Workspace",
    "",
    `The linked repo has been cloned and checked out to the PR's head branch (\`${pr.headRefName}\`). Run \`gh pr diff ${pr.number} --repo ${repo}\` to read the diff. Run \`gh pr view ${pr.number} --repo ${repo} --json body,reviews,comments\` for the PR body + any review feedback.`,
    "",
    "## Workflow",
    "",
    "1. Read the diff and the PR body.",
    "2. If this is a review trigger (`pr:reviewed`), read the reviewer's comments.",
    "3. Stage any commits via `propose_action({kind: 'git_commit_push', payload: {repo, branch: " +
      `'${pr.headRefName}'` +
      ", message, files}})` — the human will approve before anything pushes back to the PR.",
    "4. To respond to the review, stage via `propose_action({kind: 'github_review' | 'pr_comment', payload: {...}})`.",
    "",
  ].join("\n");

  const task = await createTask({
    ownerId,
    agentId: agentRow.id,
    title: `${event} ${repo}#${pr.number}`,
    brief,
    repoIds: [repoRow.id],
  });

  const workspacePath = await materializeTaskWorkspace(task.id);

  // Check out the PR's head branch inside the task workspace clone so the
  // agent's tools land on the right code. The clone in the task workspace
  // points at the central clone as `origin`, so we need to fetch the head
  // ref from real github first.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const repoDir = `${workspacePath}/${repo.replace(/\//g, "__")}`;
  try {
    // Fetch from real github via the central clone — the workspace clone
    // doesn't know about github directly.
    await exec("git", [
      "-C",
      repoDir,
      "fetch",
      "origin",
      `+refs/heads/${pr.headRefName}:refs/remotes/origin/${pr.headRefName}`,
    ]);
    // -B creates or resets the branch to track origin/<headRefName>.
    await exec("git", [
      "-C",
      repoDir,
      "checkout",
      "-B",
      pr.headRefName,
      `origin/${pr.headRefName}`,
    ]);
  } catch (err) {
    logger.warn(
      "materializeTask: failed to checkout PR head — agent will see default branch",
      {
        repo,
        prNumber: pr.number,
        headRef: pr.headRefName,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  const ctx: TriggerContext = {
    triggerType: "github",
    triggeredAt: new Date().toISOString(),
    meta: {
      ...baseMeta,
      taskId: task.id,
      workspacePath,
      // overwrite meta keys that the task system also reads so the worker
      // sets cwd correctly even if the trigger payload didn't include them.
    },
  };
  void enqueueRun(agentName, ctx);

  logger.info("materializeTask: task created + workspace ready", {
    repo,
    event,
    prNumber: pr.number,
    agent: agentName,
    taskId: task.id,
    headRef: pr.headRefName,
  });
}
