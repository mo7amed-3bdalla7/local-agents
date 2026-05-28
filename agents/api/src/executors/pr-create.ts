/**
 * pr_create executor — opens a new PR via `gh pr create` after human approval.
 *
 * The senior-engineer pairs this with git_commit_push: first push the
 * branch (workspace → central → github), then propose_action this kind to
 * actually open the PR. Both go through the same approval gate.
 *
 * Payload: { repo, head, base?, title, body, draft? }
 *   repo:  owner/name
 *   head:  branch with the changes (the one git_commit_push pushed)
 *   base:  target branch (default: gh picks the repo's default)
 *   title: PR title
 *   body:  PR body (markdown)
 *   draft: open as draft PR (default false)
 *
 * Returns: { repo, head, base?, title, prUrl, prNumber, draft }
 *
 * gh pr create prints the new PR URL to stdout on success; we parse the
 * trailing /pull/<N> for the number.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  registerExecutor,
  type ExecutorFn,
  type PendingAction,
} from "@agents/core";

const exec = promisify(execFile);

interface PrCreatePayload {
  repo: string;
  head: string;
  base?: string;
  title: string;
  body: string;
  draft: boolean;
}

export function parsePrCreatePayload(action: PendingAction): PrCreatePayload {
  const p = action.payload as Record<string, unknown>;
  const repo = typeof p.repo === "string" ? p.repo : "";
  const head = typeof p.head === "string" ? p.head.trim() : "";
  const base =
    typeof p.base === "string" && p.base.trim() ? p.base.trim() : undefined;
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const body = typeof p.body === "string" ? p.body : "";
  const draft = p.draft === true;

  if (!repo.includes("/")) {
    throw new Error(`payload.repo must be "owner/name", got: ${JSON.stringify(p.repo)}`);
  }
  if (!head) {
    throw new Error("payload.head (branch with the changes) is required");
  }
  if (!title) {
    throw new Error("payload.title is required");
  }
  if (!body.trim()) {
    throw new Error("payload.body is required (PR description)");
  }
  return { repo, head, base, title, body, draft };
}

/** gh pr create returns a single line like https://github.com/owner/repo/pull/42 */
function parseGhCreateOutput(stdout: string): {
  prUrl?: string;
  prNumber?: number;
} {
  const url = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(l));
  if (!url) return {};
  const num = Number(url.split("/").pop());
  return { prUrl: url, prNumber: Number.isFinite(num) ? num : undefined };
}

const prCreateExecutor: ExecutorFn = async (action) => {
  const { repo, head, base, title, body, draft } = parsePrCreatePayload(action);
  const args = [
    "pr",
    "create",
    "--repo",
    repo,
    "--head",
    head,
    "--title",
    title,
    "--body",
    body,
  ];
  if (base) args.push("--base", base);
  if (draft) args.push("--draft");

  let stdout: string;
  let stderr: string;
  try {
    const r = await exec("gh", args, { timeout: 60_000 });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `gh pr create ${repo} (${head} -> ${base ?? "default"}) failed: ${e.stderr || e.message || String(err)}`.trim(),
    );
  }

  const { prUrl, prNumber } = parseGhCreateOutput(stdout);
  return {
    repo,
    head,
    base,
    title,
    draft,
    prUrl,
    prNumber,
    output: (stdout || stderr || "").trim(),
  };
};

export function registerPrCreateExecutor(): void {
  registerExecutor("pr_create", prCreateExecutor);
}
