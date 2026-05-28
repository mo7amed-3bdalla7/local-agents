/**
 * git_commit_push executor — applies an approved cross-repo commit.
 *
 * Payload: { repo: "owner/name", branch?: string, message: string, files: string[] }
 *
 * Flow:
 *   1. Resolve the workspace path from action.session_id → session.triggerContext.
 *   2. cd to <workspacePath>/<owner>__<name>/ (the per-task local clone).
 *   3. Validate file paths can't escape the repo dir.
 *   4. Checkout (or create) the branch.
 *   5. git add <files>, git commit -m <message>.
 *   6. Push workspace → central clone (always succeeds, local).
 *   7. Push central clone → github (may fail without auth; non-fatal —
 *      the commit still lives in the central clone for manual push).
 *
 * Returns: { repo, branch, commitSha, pushedToGithub: boolean, githubError? }
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import {
  getDb,
  registerExecutor,
  schema,
  type ExecutorFn,
  type PendingAction,
} from "@agents/core";

const exec = promisify(execFile);

interface GitCommitPushPayload {
  repo: string;
  branch?: string;
  message: string;
  files: string[];
}

function repoDirName(githubFullName: string): string {
  return githubFullName.replace(/\//g, "__");
}

function parsePayload(action: PendingAction): GitCommitPushPayload {
  const p = action.payload as Record<string, unknown>;
  const repo = typeof p.repo === "string" ? p.repo : "";
  const branch =
    typeof p.branch === "string" && p.branch.trim() ? p.branch.trim() : undefined;
  const message = typeof p.message === "string" ? p.message : "";
  const files =
    Array.isArray(p.files)
      ? p.files.filter((f): f is string => typeof f === "string")
      : [];

  if (!repo.includes("/")) {
    throw new Error(`payload.repo must be "owner/name", got: ${JSON.stringify(p.repo)}`);
  }
  if (!message.trim()) {
    throw new Error("payload.message must be a non-empty string");
  }
  if (files.length === 0) {
    throw new Error("payload.files must list at least one path");
  }
  return { repo, branch, message: message.trim(), files };
}

/** Look up the workspace path the run was bound to. */
async function workspacePathForAction(
  action: PendingAction,
): Promise<string | undefined> {
  if (!action.sessionId) return undefined;
  const db = getDb();
  const [session] = await db
    .select({ triggerContext: schema.sessions.triggerContext })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, action.sessionId))
    .limit(1);
  if (!session) return undefined;
  const ctx = session.triggerContext as { meta?: { workspacePath?: unknown } } | null;
  const wp = ctx?.meta?.workspacePath;
  return typeof wp === "string" ? wp : undefined;
}

function ensureSafePaths(repoDir: string, files: string[]): void {
  const absRepo = resolve(repoDir);
  for (const f of files) {
    const abs = resolve(repoDir, f);
    const rel = relative(absRepo, abs);
    if (rel.startsWith("..") || rel.startsWith("/")) {
      throw new Error(`file path escapes repo dir: ${f}`);
    }
  }
}

/** Default branch name when the agent didn't supply one. */
function defaultBranchName(action: PendingAction): string {
  // agent-<short-action-id> — stable per approval, easy to spot in github.
  return `agent/${action.id.slice(0, 8)}`;
}

const gitCommitPushExecutor: ExecutorFn = async (action) => {
  const { repo, branch: branchOpt, message, files } = parsePayload(action);
  const workspacePath = await workspacePathForAction(action);
  if (!workspacePath) {
    throw new Error(
      "action has no workspace — git_commit_push only runs on task-bound actions",
    );
  }
  const repoDir = join(workspacePath, repoDirName(repo));
  if (!existsSync(repoDir)) {
    throw new Error(`workspace repo dir does not exist: ${repoDir}`);
  }
  ensureSafePaths(repoDir, files);

  const branch = branchOpt ?? defaultBranchName(action);

  // 1. Branch — switch to it (create if missing).
  await exec("git", ["-C", repoDir, "checkout", "-B", branch]);

  // 2. Stage each file. Use -- to defend against any leading dashes.
  await exec("git", ["-C", repoDir, "add", "--", ...files]);

  // 3. Commit. We allow empty stage to surface as a real error
  //    rather than silently no-op.
  try {
    await exec(
      "git",
      [
        "-C",
        repoDir,
        "-c",
        "user.name=agents-platform",
        "-c",
        "user.email=agents@local",
        "commit",
        "-m",
        message,
      ],
    );
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    throw new Error(
      `git commit failed: ${err instanceof Error ? err.message : String(err)} ${stderr}`.trim(),
    );
  }

  const { stdout: shaStdout } = await exec("git", [
    "-C",
    repoDir,
    "rev-parse",
    "HEAD",
  ]);
  const commitSha = shaStdout.trim();

  // 4. Push from workspace clone → central clone (local origin). Always works.
  await exec("git", ["-C", repoDir, "push", "origin", branch]).catch((err) => {
    // Local push *should* succeed; if it doesn't, surface the error so the
    // user sees something useful in the executor_error column.
    throw new Error(
      `local push (workspace → central clone) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  // 5. Push from central clone → github (remote origin). Best-effort —
  //    if the user doesn't have credentials set up locally this can fail,
  //    but the commit still lives in the workspace + central clone for
  //    manual recovery.
  let pushedToGithub = true;
  let githubError: string | undefined;
  try {
    const db = getDb();
    const [repoRow] = await db
      .select({ localPath: schema.repos.localPath })
      .from(schema.repos)
      .where(eq(schema.repos.githubFullName, repo))
      .limit(1);
    if (!repoRow) {
      throw new Error(`repo ${repo} not registered`);
    }
    await exec("git", [
      "-C",
      repoRow.localPath,
      "push",
      "origin",
      branch,
    ]);
  } catch (err) {
    pushedToGithub = false;
    githubError = err instanceof Error ? err.message : String(err);
  }

  return {
    repo,
    branch,
    commitSha,
    pushedToGithub,
    ...(githubError ? { githubError } : {}),
  };
};

export function registerGitCommitPushExecutor(): void {
  registerExecutor("git_commit_push", gitCommitPushExecutor);
}
