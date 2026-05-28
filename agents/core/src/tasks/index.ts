/**
 * Tasks — bundle a free-form brief + N linked repos for a single agent run.
 *
 * The senior-engineer template (and similar) navigates cross-repo context
 * via a workspace dir where each linked repo is materialized as a sibling
 * checkout. A BRIEF.md at the workspace root tells the agent what the user
 * wants. The worker reads tasks.workspacePath and sets that as the agent's
 * cwd when triggerContext carries a taskId.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";
import { ensureRepo } from "../repos/manager.js";
import { getUserContext } from "../user-context/index.js";

const exec = promisify(execFile);

export type Task = typeof schema.tasks.$inferSelect;
export type TaskRepo = typeof schema.taskRepos.$inferSelect;

export interface TaskWithRepos extends Task {
  repos: Array<{
    repoId: string;
    githubFullName: string;
    defaultBranch: string;
    localPath: string;
    position: number;
  }>;
}

function workspaceRoot(): string {
  return (
    process.env.AGENTS_WORKSPACE_ROOT ??
    join(homedir(), ".agents", "workspaces")
  );
}

function repoDirName(githubFullName: string): string {
  return githubFullName.replace(/\//g, "__");
}

export interface CreateTaskArgs {
  ownerId: string;
  agentId: string;
  title: string;
  brief: string;
  repoIds: string[];
}

export async function createTask(args: CreateTaskArgs): Promise<Task> {
  const title = args.title.trim();
  const brief = args.brief.trim();
  if (!title) throw new Error("Task title is required");
  if (!brief) throw new Error("Task brief is required");
  if (args.repoIds.length === 0) {
    throw new Error("At least one repo must be linked to a task");
  }

  const db = getDb();
  const [task] = await db
    .insert(schema.tasks)
    .values({
      ownerId: args.ownerId,
      agentId: args.agentId,
      title,
      brief,
      status: "pending",
    })
    .returning();

  // Link repos. Dedupe in case the caller passed the same id twice.
  const unique = [...new Set(args.repoIds)];
  await db.insert(schema.taskRepos).values(
    unique.map((repoId, i) => ({ taskId: task.id, repoId, position: i })),
  );
  return task;
}

export async function listTasks(ownerId: string): Promise<TaskWithRepos[]> {
  const db = getDb();
  const taskRows = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.ownerId, ownerId))
    .orderBy(desc(schema.tasks.createdAt));

  if (taskRows.length === 0) return [];

  const repoRows = await db
    .select({
      taskId: schema.taskRepos.taskId,
      repoId: schema.taskRepos.repoId,
      position: schema.taskRepos.position,
      githubFullName: schema.repos.githubFullName,
      defaultBranch: schema.repos.defaultBranch,
      localPath: schema.repos.localPath,
    })
    .from(schema.taskRepos)
    .innerJoin(schema.repos, eq(schema.repos.id, schema.taskRepos.repoId))
    .orderBy(asc(schema.taskRepos.position));

  const byTask = new Map<string, TaskWithRepos["repos"]>();
  for (const r of repoRows) {
    const arr = byTask.get(r.taskId) ?? [];
    arr.push({
      repoId: r.repoId,
      githubFullName: r.githubFullName,
      defaultBranch: r.defaultBranch,
      localPath: r.localPath,
      position: r.position,
    });
    byTask.set(r.taskId, arr);
  }
  return taskRows.map((t) => ({ ...t, repos: byTask.get(t.id) ?? [] }));
}

export async function getTask(
  id: string,
  ownerId?: string,
): Promise<TaskWithRepos | undefined> {
  const db = getDb();
  const where = ownerId
    ? and(eq(schema.tasks.id, id), eq(schema.tasks.ownerId, ownerId))
    : eq(schema.tasks.id, id);
  const [task] = await db.select().from(schema.tasks).where(where).limit(1);
  if (!task) return undefined;

  const repoRows = await db
    .select({
      repoId: schema.taskRepos.repoId,
      position: schema.taskRepos.position,
      githubFullName: schema.repos.githubFullName,
      defaultBranch: schema.repos.defaultBranch,
      localPath: schema.repos.localPath,
    })
    .from(schema.taskRepos)
    .innerJoin(schema.repos, eq(schema.repos.id, schema.taskRepos.repoId))
    .where(eq(schema.taskRepos.taskId, id))
    .orderBy(asc(schema.taskRepos.position));
  return { ...task, repos: repoRows };
}

export async function removeTask(id: string, ownerId: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.ownerId, ownerId)))
    .returning({ id: schema.tasks.id });
  return deleted.length > 0;
}

export async function setTaskStatus(
  id: string,
  status: Task["status"],
  patch: Partial<Pick<Task, "runId" | "workspacePath" | "startedAt" | "finishedAt">> = {},
): Promise<void> {
  await getDb()
    .update(schema.tasks)
    .set({ status, ...patch })
    .where(eq(schema.tasks.id, id));
}

/**
 * Materialize a task's workspace on disk:
 *   $HOME/.agents/workspaces/<task-id>/
 *     ├── BRIEF.md
 *     ├── <owner>__<name>/   (fresh clone of repo 1's default branch)
 *     └── <owner>__<name>/   (fresh clone of repo 2's default branch)
 *
 * Idempotent — if the workspace already exists, missing clones are filled
 * in and BRIEF.md is rewritten. Returns the absolute workspace path.
 */
export async function materializeTaskWorkspace(
  taskId: string,
): Promise<string> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);

  const root = join(workspaceRoot(), taskId);
  await mkdir(root, { recursive: true });

  // BRIEF.md — rewrite every materialization so edits to the brief propagate.
  const briefBody = [
    `# ${task.title}`,
    "",
    task.brief,
    "",
    "## Linked repos",
    ...task.repos.map((r) => `- ${r.githubFullName} (branch: ${r.defaultBranch})`),
    "",
    "## Instructions",
    "",
    "Each linked repo is checked out as a sibling directory at the workspace",
    "root. **Read CONTEXT.md at the workspace root first if present** — it",
    "carries your owner's cross-cutting context (coding style, conventions,",
    "sprint goals). Then read each touched repo's own AGENTS.md / CLAUDE.md",
    "/ README.md and match existing patterns. Stage every commit + push via",
    "`propose_action({kind: 'git_commit_push', ...})` — do not run `git",
    "commit` / `git push` directly.",
    "",
  ].join("\n");
  await writeFile(join(root, "BRIEF.md"), briefBody, "utf-8");

  // CONTEXT.md — owner's cross-cutting context. Optional; written only when
  // the owner has set one under /context. Rewrite on every materialization
  // so edits propagate to existing task workspaces too.
  if (task.ownerId) {
    const ctx = await getUserContext(task.ownerId);
    if (ctx && ctx.body) {
      await writeFile(join(root, "CONTEXT.md"), ctx.body, "utf-8");
    }
  }

  // Clone each linked repo locally from the central worktree clone. Fast +
  // disconnected from origin so accidental pushes can't escape.
  for (const r of task.repos) {
    // Make sure the central clone exists (covers the case the user added
    // the repo as part of the same flow).
    await ensureRepo({ githubFullName: r.githubFullName }).catch(() => undefined);

    const dest = join(root, repoDirName(r.githubFullName));
    if (existsSync(dest)) continue;
    try {
      await exec("git", ["clone", r.localPath, dest]);
      // Default-branch checkout — the central clone is detached HEAD, so
      // we explicitly switch the new clone to the branch the user wants.
      await exec("git", ["-C", dest, "checkout", r.defaultBranch]).catch(
        () => undefined,
      );
    } catch (err) {
      throw new Error(
        `failed to clone ${r.githubFullName} into ${dest}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await setTaskStatus(taskId, task.status, { workspacePath: root });
  return root;
}
