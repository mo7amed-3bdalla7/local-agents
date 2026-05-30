/**
 * Repo-manager — registry + git worktree manager + PR activity log.
 *
 * Three primitives that agents touching GitHub repos lean on:
 *
 *  - `ensureRepo`         registers a `repos` row by `github_full_name`,
 *                         clones the repo locally if missing, returns the row.
 *  - `ensureWorktree`     materializes (or reuses) a `git worktree` for a
 *                         given branch, records it in `worktrees`, returns
 *                         the absolute path. Idempotent per (repo, branch).
 *  - `logPrActivity`      append-only writes into `pr_activity` for every
 *                         comment/review/commit the agent emits, with the
 *                         GitHub link/SHA once posted.
 *
 * Worktree layout (override with AGENTS_WORKTREE_ROOT):
 *   $HOME/.agents/worktrees/<owner>__<repo>/.repo/                 ← main clone
 *   $HOME/.agents/worktrees/<owner>__<repo>/<branch-slug>/         ← per-branch
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";

const exec = promisify(execFile);

export type Repo = typeof schema.repos.$inferSelect;
export type Worktree = typeof schema.worktrees.$inferSelect;
export type PrActivity = typeof schema.prActivity.$inferSelect;

export type PrActivityKind =
  | "issue_comment"
  | "review_comment"
  | "review_submitted"
  | "thread_reply"
  | "commit_pushed"
  | "branch_pushed";

export type PrActivityStatus = "drafted" | "pending_approval" | "posted" | "failed";

function worktreeRoot(): string {
  return (
    process.env.AGENTS_WORKTREE_ROOT ?? join(homedir(), ".agents", "worktrees")
  );
}

/** Replace path-unsafe chars in a branch name (e.g. `feature/foo` → `feature__foo`). */
function slugifyBranch(branch: string): string {
  return branch.replace(/[^A-Za-z0-9_.-]+/g, "__");
}

function repoDirName(githubFullName: string): string {
  return githubFullName.replace(/\//g, "__");
}

async function gitClone(githubFullName: string, dest: string): Promise<void> {
  // Use https — works for public repos out of the box. Private repos rely on
  // the caller having a credential helper (gh, git-credential-osxkeychain, …)
  // configured; secret_ref-based PAT injection lands in a later slice.
  const url = `https://github.com/${githubFullName}.git`;
  await mkdir(resolve(dest, ".."), { recursive: true });
  await exec("git", ["clone", url, dest]);
  // Detach HEAD so the default branch is available for `git worktree add`.
  // Without this, the first worktree request for the default branch fails
  // because it's already checked out in the main clone.
  await exec("git", ["-C", dest, "checkout", "--detach", "HEAD"]);
}

async function gitFetch(repoDir: string): Promise<void> {
  await exec("git", ["-C", repoDir, "fetch", "--all", "--prune"]);
}

async function gitWorktreeExists(
  repoDir: string,
  worktreePath: string,
): Promise<boolean> {
  if (!existsSync(worktreePath)) return false;
  const { stdout } = await exec("git", ["-C", repoDir, "worktree", "list", "--porcelain"]);
  return stdout.includes(`worktree ${worktreePath}\n`);
}

async function gitWorktreeAdd(
  repoDir: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  await mkdir(resolve(worktreePath, ".."), { recursive: true });
  // -B creates or resets the local branch to track origin/<branch> if available.
  // Fall back to a detached worktree on the remote ref if the branch doesn't exist locally.
  try {
    await exec("git", [
      "-C",
      repoDir,
      "worktree",
      "add",
      "-B",
      branch,
      worktreePath,
      `origin/${branch}`,
    ]);
  } catch {
    // origin/<branch> may not exist (e.g. a fresh local branch). Try without it.
    await exec("git", ["-C", repoDir, "worktree", "add", worktreePath, branch]);
  }
}

export interface EnsureRepoArgs {
  /** Required. e.g. "owner/name". */
  githubFullName: string;
  /** Defaults to "main". */
  defaultBranch?: string;
  testCommand?: string;
  /** Existing keychain secret ref (`keytar:<service>:<account>`) — optional. */
  secretRef?: string;
  /** User who owns this repo. Null only for legacy/orphan rows. */
  ownerId?: string;
}

export async function ensureRepo(args: EnsureRepoArgs): Promise<Repo> {
  if (!args.githubFullName.includes("/")) {
    throw new Error(`githubFullName must be "owner/name", got: ${args.githubFullName}`);
  }
  const db = getDb();
  const localPath = join(worktreeRoot(), repoDirName(args.githubFullName), ".repo");

  const [existing] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.githubFullName, args.githubFullName))
    .limit(1);

  if (!existing) {
    if (!existsSync(localPath)) {
      await gitClone(args.githubFullName, localPath);
    }
    const [row] = await db
      .insert(schema.repos)
      .values({
        githubFullName: args.githubFullName,
        localPath,
        defaultBranch: args.defaultBranch ?? "main",
        testCommand: args.testCommand,
        secretRef: args.secretRef,
        autoModes: {},
        ownerId: args.ownerId,
      })
      .returning();
    return row;
  }

  // If the row points to a path that no longer exists, re-clone there. Avoids
  // confusing failures after someone manually deletes the worktree dir.
  if (!existsSync(existing.localPath)) {
    await gitClone(args.githubFullName, existing.localPath);
  }
  return existing;
}

/**
 * Parse an `origin` URL into `owner/name`. Handles the common GitHub URL
 * shapes and tolerates a trailing `.git`.
 *
 *   https://github.com/owner/name        → owner/name
 *   https://github.com/owner/name.git    → owner/name
 *   git@github.com:owner/name.git        → owner/name
 *   ssh://git@github.com/owner/name      → owner/name
 */
export function parseGithubOriginUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/, "");
  // git@github.com:owner/name
  const ssh = /^git@(?:[^:]+):([^/]+\/[^/]+)$/.exec(trimmed);
  if (ssh) return ssh[1];
  // ssh://git@host/owner/name  or  https://host/owner/name
  const url2 = /^(?:ssh:\/\/git@|https?:\/\/)[^/]+\/([^/]+\/[^/]+)$/.exec(trimmed);
  if (url2) return url2[1];
  return null;
}

export interface LinkLocalRepoArgs {
  /** Absolute path to an existing git checkout on disk. */
  localPath: string;
  /** Override default branch detection. */
  defaultBranch?: string;
  /** Override origin-URL detection (e.g. for repos without a github origin). */
  githubFullName?: string;
  testCommand?: string;
  secretRef?: string;
  ownerId?: string;
}

/**
 * Register an existing local git clone with the platform — no re-clone, no
 * worktree shuffle, the row points at the path the user gave us. Detects
 * `origin` URL → derives `owner/name` automatically, and detects the
 * default branch from `origin/HEAD`. Either can be overridden via args.
 *
 * Idempotent: re-running with the same localPath returns the existing row.
 */
export async function linkLocalRepo(args: LinkLocalRepoArgs): Promise<Repo> {
  const abs = resolve(args.localPath);
  if (!existsSync(abs)) {
    throw new Error(`localPath does not exist: ${abs}`);
  }
  if (!existsSync(join(abs, ".git"))) {
    throw new Error(`localPath is not a git repo (no .git/): ${abs}`);
  }

  let githubFullName = args.githubFullName?.trim();
  if (!githubFullName) {
    try {
      const { stdout } = await exec("git", [
        "-C",
        abs,
        "config",
        "--get",
        "remote.origin.url",
      ]);
      const url = stdout.trim();
      if (!url) {
        throw new Error(
          `no origin url found; pass githubFullName explicitly`,
        );
      }
      const parsed = parseGithubOriginUrl(url);
      if (!parsed) {
        throw new Error(
          `could not parse owner/name from origin url ${url}; pass githubFullName explicitly`,
        );
      }
      githubFullName = parsed;
    } catch (err) {
      throw new Error(
        `failed to detect github full name: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let defaultBranch = args.defaultBranch?.trim();
  if (!defaultBranch) {
    try {
      const { stdout } = await exec("git", [
        "-C",
        abs,
        "symbolic-ref",
        "--short",
        "refs/remotes/origin/HEAD",
      ]);
      // "origin/main" → "main"
      defaultBranch = stdout.trim().replace(/^origin\//, "");
    } catch {
      defaultBranch = "main";
    }
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.githubFullName, githubFullName))
    .limit(1);
  if (existing) {
    // If they're linking the same repo from a different path, update the
    // localPath to point at the new one. The old central clone (if any)
    // is left on disk for the user to clean up — we don't delete things
    // we didn't create.
    if (existing.localPath !== abs) {
      const [row] = await db
        .update(schema.repos)
        .set({ localPath: abs, defaultBranch })
        .where(eq(schema.repos.id, existing.id))
        .returning();
      return row;
    }
    return existing;
  }

  const [row] = await db
    .insert(schema.repos)
    .values({
      githubFullName,
      localPath: abs,
      defaultBranch,
      testCommand: args.testCommand,
      secretRef: args.secretRef,
      autoModes: {},
      ownerId: args.ownerId,
    })
    .returning();
  return row;
}

export interface EnsureWorktreeArgs {
  repoId: string;
  branch: string;
  /** Optionally bind the worktree to a session for traceability. */
  sessionId?: string;
}

export async function ensureWorktree(args: EnsureWorktreeArgs): Promise<Worktree> {
  const db = getDb();
  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, args.repoId))
    .limit(1);
  if (!repo) {
    throw new Error(`Repo ${args.repoId} not found`);
  }

  const branchSlug = slugifyBranch(args.branch);
  const path = join(worktreeRoot(), repoDirName(repo.githubFullName), branchSlug);

  // Reuse an active (non-deleted) row for the same (repo, branch).
  const [existing] = await db
    .select()
    .from(schema.worktrees)
    .where(
      and(
        eq(schema.worktrees.repoId, args.repoId),
        eq(schema.worktrees.branch, args.branch),
        isNull(schema.worktrees.deletedAt),
      ),
    )
    .limit(1);

  if (existing && (await gitWorktreeExists(repo.localPath, existing.path))) {
    if (args.sessionId && existing.sessionId !== args.sessionId) {
      await db
        .update(schema.worktrees)
        .set({ sessionId: args.sessionId })
        .where(eq(schema.worktrees.id, existing.id));
      return { ...existing, sessionId: args.sessionId };
    }
    return existing;
  }

  // Fetch remote refs so origin/<branch> resolves.
  await gitFetch(repo.localPath).catch(() => undefined);
  await gitWorktreeAdd(repo.localPath, path, args.branch);

  if (existing) {
    // The row claims a worktree but git doesn't know about it — repair.
    const [row] = await db
      .update(schema.worktrees)
      .set({ path, sessionId: args.sessionId ?? null, deletedAt: null })
      .where(eq(schema.worktrees.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(schema.worktrees)
    .values({
      repoId: args.repoId,
      branch: args.branch,
      path,
      sessionId: args.sessionId,
    })
    .returning();
  return row;
}

export interface LogPrActivityArgs {
  sessionId?: string;
  repoId: string;
  prNumber: number;
  kind: PrActivityKind;
  payload: Record<string, unknown>;
  githubId?: string;
  githubUrl?: string;
  status?: PrActivityStatus;
  postedSha?: string;
}

export async function logPrActivity(args: LogPrActivityArgs): Promise<PrActivity> {
  const db = getDb();
  const status = args.status ?? (args.githubUrl ? "posted" : "drafted");
  const [row] = await db
    .insert(schema.prActivity)
    .values({
      sessionId: args.sessionId,
      repoId: args.repoId,
      prNumber: args.prNumber,
      kind: args.kind,
      payload: args.payload,
      githubId: args.githubId,
      githubUrl: args.githubUrl,
      status,
      postedSha: args.postedSha,
      postedAt: status === "posted" ? new Date() : null,
    })
    .returning();
  return row;
}

