/**
 * github_review executor — posts a top-level PR review via `gh pr review`.
 *
 * Payload: {
 *   repo:      "owner/name",
 *   prNumber:  number,
 *   event:     "comment" | "approve" | "request_changes",
 *   body:      string
 * }
 *
 * Inline (line-level) review comments are not yet supported — they require
 * the GitHub GraphQL API beyond what `gh pr review` exposes. When that lands,
 * add a `comments` array field and split the gh call.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  registerExecutor,
  type ExecutorFn,
  type PendingAction,
} from "@agents/core";

const exec = promisify(execFile);

type ReviewEvent = "comment" | "approve" | "request_changes";
const VALID_EVENTS = new Set<ReviewEvent>([
  "comment",
  "approve",
  "request_changes",
]);

interface GithubReviewPayload {
  repo: string;
  prNumber: number;
  event: ReviewEvent;
  body: string;
}

export function parseGithubReviewPayload(
  action: PendingAction,
): GithubReviewPayload {
  return parsePayload(action);
}

function parsePayload(action: PendingAction): GithubReviewPayload {
  const p = action.payload as Record<string, unknown>;
  const repo = typeof p.repo === "string" ? p.repo : "";
  const prNumber = typeof p.prNumber === "number" ? p.prNumber : NaN;
  const event = typeof p.event === "string" ? (p.event as ReviewEvent) : "comment";
  const body = typeof p.body === "string" ? p.body : "";

  if (!repo.includes("/")) {
    throw new Error(`payload.repo must be "owner/name", got: ${repo}`);
  }
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    throw new Error(`payload.prNumber must be a positive integer, got: ${prNumber}`);
  }
  if (!VALID_EVENTS.has(event)) {
    throw new Error(
      `payload.event must be one of comment|approve|request_changes, got: ${event}`,
    );
  }
  if (!body.trim()) {
    throw new Error("payload.body must be a non-empty string");
  }
  return { repo, prNumber, event, body };
}

function eventFlag(event: ReviewEvent): string {
  // gh pr review uses kebab-case flags.
  switch (event) {
    case "approve":
      return "--approve";
    case "request_changes":
      return "--request-changes";
    case "comment":
      return "--comment";
  }
}

const githubReviewExecutor: ExecutorFn = async (action) => {
  const { repo, prNumber, event, body } = parsePayload(action);

  let stdout: string;
  let stderr: string;
  try {
    const result = await exec(
      "gh",
      [
        "pr",
        "review",
        String(prNumber),
        "--repo",
        repo,
        eventFlag(event),
        "--body",
        body,
      ],
      { timeout: 30_000 },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    // execFile rejects with .stderr/.stdout attached on non-zero exit.
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `gh pr review ${event} ${repo}#${prNumber} failed: ${e.stderr || e.message || String(err)}`.trim(),
    );
  }

  return {
    repo,
    prNumber,
    event,
    // gh prints "Reviewed pull request..." on success — surface it so the
    // approvals UI shows something concrete.
    output: (stdout || stderr || "").trim(),
  };
};

export function registerGithubReviewExecutor(): void {
  registerExecutor("github_review", githubReviewExecutor);
}
