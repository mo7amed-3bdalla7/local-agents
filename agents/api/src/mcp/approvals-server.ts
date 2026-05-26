/**
 * Per-run in-process MCP server exposing `propose_action` to the agent.
 *
 * Agents call this tool to stage side-effecting work (PR comments, commits,
 * Slack messages, ...) into the `pending_actions` queue instead of executing
 * the side effect directly. A human then approves in the UI and the
 * registered executor runs the real call.
 *
 * The server is built fresh per run so the closure can capture `agentId`,
 * `ownerId`, and `sessionId` for stamping rows correctly.
 */

import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { enqueueAction } from "@agents/core";

export const APPROVALS_SERVER_NAME = "agents-approvals";
export const APPROVALS_TOOL_FQN = `mcp__${APPROVALS_SERVER_NAME}__propose_action`;

export interface BuildApprovalsServerArgs {
  agentId: string;
  sessionId: string;
  /** Null only for the (rare) case the run came from a file-source agent. */
  ownerId: string | null;
}

export function buildApprovalsMcpServer(
  args: BuildApprovalsServerArgs,
): McpServerConfig {
  const proposeAction = tool(
    "propose_action",
    [
      "Queue a side-effecting action for human approval before executing it.",
      "Use this whenever you would otherwise post a PR comment, push a commit,",
      "send a Slack message, or take any other action visible to others.",
      "Returns an action id; the human will see the proposal in the Approvals tab",
      "of the dashboard and approve or reject it. Do NOT call the underlying API",
      "or shell command directly — staging through this tool is the contract.",
    ].join(" "),
    {
      kind: z
        .string()
        .min(1)
        .describe(
          "Action kind. Today the supported executor is 'pr_comment'. Future kinds will be documented as they ship.",
        ),
      title: z
        .string()
        .min(1)
        .describe(
          "Short label for the approvals UI, e.g. 'Comment on owner/repo#42'.",
        ),
      description: z
        .string()
        .optional()
        .describe(
          "Optional rationale shown to the human reviewer (a sentence or two).",
        ),
      payload: z
        .record(z.string(), z.unknown())
        .describe(
          "Kind-specific payload. For 'pr_comment': { repo: 'owner/name', prNumber: number, body: string }.",
        ),
    },
    async (input) => {
      const action = await enqueueAction({
        sessionId: args.sessionId,
        agentId: args.agentId,
        ownerId: args.ownerId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        payload: input.payload,
      });
      const body = {
        actionId: action.id,
        status: action.status,
        message:
          "Action queued for human approval. Continue with other work or finish; do not retry or attempt the side effect directly.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(body) }],
      };
    },
  );

  return createSdkMcpServer({
    name: APPROVALS_SERVER_NAME,
    version: "0.0.1",
    instructions:
      "Use propose_action to stage side-effecting work for human approval. The tool returns immediately with an action id; the actual side effect runs only after the user approves in the dashboard.",
    tools: [proposeAction],
  });
}
