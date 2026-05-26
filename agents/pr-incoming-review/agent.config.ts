import { defineAgent } from "@agents/sdk";

/**
 * pr-incoming-review — first-pass review of PRs opened on your repos by
 * external contributors. Sibling to `pr-reviewer` (which serves the generic
 * / outgoing case).
 *
 * Triggers are intentionally empty here — wire `gh` GitHub-poller triggers
 * per-repo from agent.config.ts or attach via the dashboard once a repo
 * is registered. Manual `pnpm agent-run -- pr-incoming-review` works
 * during development by overriding the trigger meta.
 */

export default defineAgent({
  name: "pr-incoming-review",
  description:
    "First-pass review for PRs opened on your repos by external contributors. Focuses on blockers — correctness, security, convention fit. Refuses self-reviews.",
  triggers: [],
  execution: {
    model: "claude-sonnet-4-6",
    permissionMode: "acceptEdits",
    maxTurns: 30,
    timeoutMs: 600_000,
    tools: ["Read", "Bash", "Glob", "Grep"],
    retries: 1,
  },
  prompt: (ctx) => {
    const meta = (ctx.meta ?? {}) as {
      repo?: string;
      prNumber?: number;
      prAuthor?: string;
      ownerLogin?: string;
      headRef?: string;
      baseRef?: string;
      prTitle?: string;
      labelNeedsFollowup?: string;
      labelLgtm?: string;
    };
    return [
      `You are running an incoming-PR review. Follow the workflow in your AGENTS.md.`,
      ``,
      `REPO: ${meta.repo ?? "(unset — fill in from trigger)"}`,
      `PR_NUMBER: ${meta.prNumber ?? "(unset)"}`,
      `PR_AUTHOR: ${meta.prAuthor ?? "(unknown)"}`,
      `OWNER_LOGIN: ${meta.ownerLogin ?? "(unknown)"}`,
      `PR_TITLE: ${meta.prTitle ?? ""}`,
      `HEAD_REF: ${meta.headRef ?? ""}`,
      `BASE_REF: ${meta.baseRef ?? "main"}`,
      `EVENT: ${ctx.triggerType}`,
      `REVIEW_FORMAT: review`,
      `LABEL_NEEDS_FOLLOWUP: ${meta.labelNeedsFollowup ?? "needs-author-followup"}`,
      `LABEL_LGTM: ${meta.labelLgtm ?? "agent-lgtm"}`,
      ``,
      `Refuse the review (Step 1) if PR_AUTHOR matches OWNER_LOGIN.`,
    ].join("\n");
  },
  maxConcurrency: 1,
  maxQueueSize: 5,
});
