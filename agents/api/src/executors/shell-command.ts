/**
 * shell_command executor — runs a shell command in a task workspace after
 * human approval. The approval gate is the entire safety story: every
 * command is reviewable on /approvals before it runs. The executor does
 * confine cwd to under the workspaces root so payloads can't shell into
 * arbitrary system dirs.
 *
 * Payload: { cmd: string, cwd?: string, timeoutMs?: number }
 *   cmd:       passed to `bash -c`, so pipes/globs/&& work normally.
 *   cwd:       defaults to the task's workspacePath (resolved from
 *              action.session_id → session.triggerContext.meta).
 *              If provided, must be under the workspaces root or an
 *              existing directory beneath the resolved workspace.
 *   timeoutMs: kill the command after this many ms. Default 300_000 (5m),
 *              max 1_800_000 (30m).
 *
 * Result: { cmd, cwd, exitCode, stdout, stderr, truncated }
 *   stdout/stderr are truncated to 8 KiB each (UI can't render more usefully).
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
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

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_LIMIT_BYTES = 8 * 1024;

function workspaceRoot(): string {
  return (
    process.env.AGENTS_WORKSPACE_ROOT ??
    join(homedir(), ".agents", "workspaces")
  );
}

interface ShellCommandPayload {
  cmd: string;
  cwd?: string;
  timeoutMs?: number;
}

export function parseShellCommandPayload(
  action: PendingAction,
): ShellCommandPayload {
  const p = action.payload as Record<string, unknown>;
  const cmd = typeof p.cmd === "string" ? p.cmd.trim() : "";
  if (!cmd) throw new Error("payload.cmd must be a non-empty string");
  const cwd = typeof p.cwd === "string" && p.cwd ? p.cwd : undefined;
  const rawTimeout = p.timeoutMs;
  let timeoutMs: number | undefined;
  if (typeof rawTimeout === "number" && Number.isFinite(rawTimeout)) {
    timeoutMs = Math.min(Math.max(rawTimeout, 1000), MAX_TIMEOUT_MS);
  }
  return { cmd, cwd, timeoutMs };
}

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
  const ctx = session?.triggerContext as
    | { meta?: { workspacePath?: unknown } }
    | null;
  const wp = ctx?.meta?.workspacePath;
  return typeof wp === "string" ? wp : undefined;
}

/**
 * Resolve and validate the cwd for this command. Returns an absolute path
 * known to be (a) inside the workspaces root and (b) an existing dir.
 * Throws if either check fails.
 */
function resolveSafeCwd(
  payloadCwd: string | undefined,
  workspacePath: string | undefined,
): string {
  if (!workspacePath) {
    throw new Error(
      "action has no workspace — shell_command only runs on task-bound actions",
    );
  }
  const absRoot = resolve(workspaceRoot());
  const absWorkspace = resolve(workspacePath);
  // Workspace dir itself must be under the workspaces root.
  if (
    relative(absRoot, absWorkspace).startsWith("..") ||
    relative(absRoot, absWorkspace).startsWith("/")
  ) {
    throw new Error(
      `task workspace ${absWorkspace} escapes workspaces root ${absRoot}`,
    );
  }
  const cwd = payloadCwd
    ? resolve(absWorkspace, payloadCwd)
    : absWorkspace;
  // Final cwd must be under the workspace dir.
  const rel = relative(absWorkspace, cwd);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`cwd ${cwd} escapes the task workspace ${absWorkspace}`);
  }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
  }
  return cwd;
}

function truncate(s: string, limit = OUTPUT_LIMIT_BYTES): {
  text: string;
  truncated: boolean;
} {
  if (Buffer.byteLength(s, "utf8") <= limit) return { text: s, truncated: false };
  // Cut from the front so the tail (where errors/results usually live) survives.
  let cut = s.length - limit;
  if (cut < 0) cut = 0;
  return {
    text: `… [${cut} chars truncated] …\n` + s.slice(cut),
    truncated: true,
  };
}

const shellCommandExecutor: ExecutorFn = async (action) => {
  const { cmd, cwd: cwdOpt, timeoutMs } = parseShellCommandPayload(action);
  const workspacePath = await workspacePathForAction(action);
  const cwd = resolveSafeCwd(cwdOpt, workspacePath);
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await exec("bash", ["-c", cmd], {
      cwd,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    const e = err as {
      code?: number;
      signal?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    exitCode = typeof e.code === "number" ? e.code : 1;
    // Don't throw on non-zero exit — a failing test run is still a
    // successful executor invocation; the user sees the exit code +
    // stderr and can decide what to do next.
    if (e.signal) {
      stderr = `[killed by signal ${e.signal} after ${timeout}ms]\n` + stderr;
    } else if (!e.code && e.message) {
      // execFile error that isn't a non-zero exit (e.g. command not found)
      // — surface as a hard failure so the row goes to status='failed'.
      throw new Error(`shell exec failed: ${e.message}`);
    }
  }

  const sOut = truncate(stdout);
  const sErr = truncate(stderr);
  return {
    cmd,
    cwd,
    exitCode,
    stdout: sOut.text,
    stderr: sErr.text,
    truncated: sOut.truncated || sErr.truncated,
  };
};

export function registerShellCommandExecutor(): void {
  registerExecutor("shell_command", shellCommandExecutor);
}
