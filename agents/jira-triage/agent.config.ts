import { defineAgent } from "@agents/sdk";

/**
 * jira-triage — manual-triggered (for now) backlog triage agent.
 *
 * Default JQL filters to issues updated in the last day. Override per-run via
 * the trigger context's `meta` (POST /api/agents/<id>/run with a body, once
 * the API supports body-passing — slice-3 territory).
 */

const DEFAULT_JQL = "updated >= -1d ORDER BY updated DESC";
const DEFAULT_MAX = 10;

export default defineAgent({
  name: "jira-triage",
  description:
    "Triage agent for a Jira backlog. Reads recent issues, classifies each, posts a single triage comment per issue.",
  triggers: [],
  execution: {
    model: "claude-sonnet-4-6",
    permissionMode: "acceptEdits",
    maxTurns: 20,
    timeoutMs: 600_000,
    tools: ["Bash"],
    retries: 0,
  },
  prompt: (ctx) => {
    const meta = (ctx.meta ?? {}) as { jql?: string; maxIssues?: number };
    const jql = typeof meta.jql === "string" ? meta.jql : DEFAULT_JQL;
    const maxIssues =
      typeof meta.maxIssues === "number" ? meta.maxIssues : DEFAULT_MAX;
    return [
      `You are running a triage pass over the Jira backlog. Follow the workflow in your AGENTS.md.`,
      ``,
      `JQL: ${jql}`,
      `MAX_ISSUES: ${maxIssues}`,
      ``,
      `Use \`pnpm jira issue search\`, \`pnpm jira issue get\`, and \`pnpm jira comment\` to do your work. The Jira connector attached to this agent in the platform's registry will be used automatically.`,
    ].join("\n");
  },
  maxConcurrency: 1,
});
