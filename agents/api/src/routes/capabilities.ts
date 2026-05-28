/**
 * GET /api/capabilities — discovery surface for every executor + sender the
 * platform ships. Users and the AI generator both need to know what side
 * effects an agent can stage and what notification transports are wired.
 *
 * The descriptors here mirror what each executor's parsePayload validates
 * and what each sender expects in channel.configJson. When you add a new
 * executor/sender, register it in this file AND in server.ts so the runtime
 * + the UI stay in sync.
 */

import { Hono } from "hono";
import { listExecutors, listSenders } from "@agents/core";

export const capabilitiesRouter = new Hono();

interface FieldSpec {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

interface ExecutorSpec {
  kind: string;
  category: string;
  description: string;
  payload: FieldSpec[];
  example: Record<string, unknown>;
  notes?: string;
}

interface SenderSpec {
  kind: string;
  description: string;
  config: FieldSpec[];
  secret?: string;
  exampleConfig: Record<string, unknown>;
}

const EXECUTOR_SPECS: ExecutorSpec[] = [
  {
    kind: "pr_comment",
    category: "github",
    description:
      "Post a single comment to a PR via `gh pr comment`. The simplest GitHub side effect.",
    payload: [
      { name: "repo", type: "string", required: true, description: "owner/name." },
      { name: "prNumber", type: "number", required: true, description: "PR number." },
      { name: "body", type: "string", required: true, description: "Markdown comment body." },
    ],
    example: {
      repo: "anthropics/sdk",
      prNumber: 42,
      body: "Noticed the credential helper is missing a fallback for the env-var path.",
    },
  },
  {
    kind: "pr_create",
    category: "github",
    description:
      "Open a new PR via `gh pr create`. The senior-engineer pairs this with git_commit_push: push the branch first, then propose this kind to actually open the PR through the same approval gate.",
    payload: [
      { name: "repo", type: "string", required: true, description: "owner/name." },
      {
        name: "head",
        type: "string",
        required: true,
        description: "Branch with the changes (the one git_commit_push pushed).",
      },
      {
        name: "base",
        type: "string",
        description: "Target branch. Defaults to the repo's default branch.",
      },
      { name: "title", type: "string", required: true, description: "PR title." },
      { name: "body", type: "string", required: true, description: "PR description (markdown)." },
      {
        name: "draft",
        type: "boolean",
        description: "Open as a draft PR. Defaults to false.",
      },
    ],
    example: {
      repo: "anthropics/sdk",
      head: "fix/credential-fallback",
      base: "main",
      title: "Fix credential helper env-var fallback",
      body: "## Summary\n\nThe credential helper missed the env-var path.\n\n## Test plan\n\n- [x] pnpm test passes\n- [ ] manual smoke against staging",
      draft: false,
    },
    notes:
      "Returns {prUrl, prNumber} parsed from gh's stdout, so the approvals card surfaces the new PR link directly.",
  },
  {
    kind: "github_review",
    category: "github",
    description:
      "Post a top-level PR review (approve / request changes / comment) via `gh pr review`. Inline line comments aren't supported yet.",
    payload: [
      { name: "repo", type: "string", required: true, description: "owner/name." },
      { name: "prNumber", type: "number", required: true, description: "PR number." },
      {
        name: "event",
        type: '"comment" | "approve" | "request_changes"',
        required: true,
        description: "The review event type passed to gh.",
      },
      { name: "body", type: "string", required: true, description: "Review summary." },
    ],
    example: {
      repo: "anthropics/sdk",
      prNumber: 42,
      event: "request_changes",
      body: "Two issues found:\n\n1. The session loader can race.\n2. The retry has unbounded growth.",
    },
  },
  {
    kind: "git_commit_push",
    category: "github",
    description:
      "Stage files in the task workspace, commit, and push to github. Only runs on task-bound actions — the action's session must carry a workspacePath.",
    payload: [
      { name: "repo", type: "string", required: true, description: "owner/name." },
      {
        name: "branch",
        type: "string",
        description: "Defaults to agent/<short-action-id> if omitted.",
      },
      { name: "message", type: "string", required: true, description: "Commit message." },
      { name: "files", type: "string[]", required: true, description: "Paths relative to the repo dir." },
    ],
    example: {
      repo: "anthropics/sdk",
      branch: "fix/credential-fallback",
      message: "Fix credential helper env-var fallback",
      files: ["src/auth/credentials.ts", "src/auth/credentials.test.ts"],
    },
    notes:
      "Push goes workspace → central clone (always works) → github (best-effort; surfaces pushedToGithub:false + githubError when creds aren't configured).",
  },
  {
    kind: "shell_command",
    category: "workspace",
    description:
      "Run `bash -c <cmd>` in the task workspace. Use to run tests, builds, linters before staging commits. Path-escape attempts on cwd are rejected before the shell starts.",
    payload: [
      { name: "cmd", type: "string", required: true, description: "Passed to bash -c so pipes/globs work." },
      {
        name: "cwd",
        type: "string",
        description: "Defaults to the task workspace. Must be under it.",
      },
      {
        name: "timeoutMs",
        type: "number",
        description: "Clamped to [1000, 30min]. Default 5 min.",
      },
    ],
    example: {
      cmd: "pnpm test --filter=@agents/core",
      timeoutMs: 120_000,
    },
    notes:
      "Returns {exitCode, stdout, stderr, truncated}. Non-zero exit is still status=executed — the user sees the exit code and decides what to do next.",
  },
  {
    kind: "slack_message",
    category: "messaging",
    description:
      "Post a message to the owner's configured Slack channel. Looks up the first enabled `slack` notification channel and posts to its webhook URL.",
    payload: [
      { name: "text", type: "string", required: true, description: "Message body (Slack markdown ok)." },
    ],
    example: {
      text: ":rocket: deploy approved by @mo7amed — landing v0.42 in 10 minutes.",
    },
    notes:
      "Requires a kind='slack' notification channel under /notifications. The executor errors clearly when one isn't configured.",
  },
];

const SENDER_SPECS: SenderSpec[] = [
  {
    kind: "console",
    description:
      "Logs each delivery as a structured JSON line to the API process stdout. The simplest transport — always works.",
    config: [],
    exampleConfig: {},
  },
  {
    kind: "webhook",
    description:
      "POSTs the event payload as JSON to a user-supplied URL. HMAC-SHA256 signs the body when a secret is set; the receiver verifies via x-agents-signature.",
    config: [
      { name: "url", type: "string", required: true, description: "https://... target URL." },
      {
        name: "headers",
        type: "Record<string,string>",
        description: "Extra request headers (merged with content-type + user-agent).",
      },
    ],
    secret: "HMAC key. Optional. Sent as `x-agents-signature: sha256=<hex>`.",
    exampleConfig: {
      url: "https://example.com/hooks/agents",
      headers: { "x-source": "agents-platform" },
    },
  },
  {
    kind: "slack",
    description:
      "Posts to a Slack incoming webhook. The same channel row is consumed by both the notification sender AND the slack_message approval executor — configure once, use for both.",
    config: [
      {
        name: "url",
        type: "string",
        required: true,
        description: "https://hooks.slack.com/services/... incoming-webhook URL.",
      },
      {
        name: "channel",
        type: "string",
        description: "Optional channel override; the webhook usually has a default.",
      },
    ],
    exampleConfig: {
      url: "https://hooks.slack.com/services/T.../B.../...",
      channel: "#agents-platform",
    },
  },
];

capabilitiesRouter.get("/", (c) => {
  const liveExecutors = new Set(listExecutors());
  const liveSenders = new Set(listSenders());
  return c.json({
    executors: EXECUTOR_SPECS.map((e) => ({
      ...e,
      registered: liveExecutors.has(e.kind),
    })),
    senders: SENDER_SPECS.map((s) => ({
      ...s,
      registered: liveSenders.has(s.kind),
    })),
  });
});
