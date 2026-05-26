/**
 * pr_comment executor — posts an approved comment via the `gh` CLI.
 *
 * Payload: { repo: "owner/name", prNumber: 42, body: "string" }.
 * Result : { url, commentId } — surfaced in the Approvals UI on success.
 *
 * gh must be installed AND authenticated locally (`gh auth status`); the
 * runner/api process inherits whatever credentials the user has configured.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  registerExecutor,
  type ExecutorFn,
  type PendingAction,
} from "@agents/core";

const exec = promisify(execFile);

interface PrCommentPayload {
  repo: string;
  prNumber: number;
  body: string;
}

function parsePayload(action: PendingAction): PrCommentPayload {
  const p = action.payload as Record<string, unknown>;
  const repo = typeof p.repo === "string" ? p.repo : "";
  const prNumber = typeof p.prNumber === "number" ? p.prNumber : NaN;
  const body = typeof p.body === "string" ? p.body : "";
  if (!repo.includes("/")) {
    throw new Error(`payload.repo must be 'owner/name', got: ${repo}`);
  }
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    throw new Error(`payload.prNumber must be a positive integer, got: ${prNumber}`);
  }
  if (!body.trim()) {
    throw new Error("payload.body must be a non-empty string");
  }
  return { repo, prNumber, body };
}

const prCommentExecutor: ExecutorFn = async (action) => {
  const { repo, prNumber, body } = parsePayload(action);
  // gh prints the resulting comment URL to stdout on success.
  const { stdout } = await exec(
    "gh",
    [
      "pr",
      "comment",
      String(prNumber),
      "--repo",
      repo,
      "--body",
      body,
    ],
    { timeout: 30_000 },
  );
  const url = stdout.trim();
  return { url, repo, prNumber };
};

export function registerPrCommentExecutor(): void {
  registerExecutor("pr_comment", prCommentExecutor);
}
