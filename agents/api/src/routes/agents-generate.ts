/**
 * POST /api/agents/generate — natural-language → agent draft.
 *
 * Takes a free-form description of what the user wants an agent to do and
 * returns a draft {name, description, systemPrompt, configJson}. Does NOT
 * persist — the UI shows the draft for the user to review + save via the
 * normal POST /api/agents flow.
 *
 * Auth: uses the existing Claude Agent SDK, which authenticates via
 * CLAUDE_CODE_OAUTH_TOKEN already set in the env for every run.
 */

import { Hono } from "hono";
import { query } from "@anthropic-ai/claude-agent-sdk";

export const agentsGenerateRouter = new Hono();

const META_SYSTEM_PROMPT = `You design Claude-Agent-SDK agents for the local-agents-me platform.

Given a user's description of what they want an agent to do, emit ONE JSON
object inside a fenced \`\`\`json block. No prose before or after. The JSON
must have exactly these top-level fields:

{
  "name":         string  // kebab-case, ≤30 chars, e.g. "weekly-jira-digest"
  "description":  string  // one sentence, ≤120 chars
  "systemPrompt": string  // the agent's behavior contract — what it does, in second person
                          //   ("You are X. For each Y you should..."). Mention propose_action
                          //   for side effects. Multi-paragraph is fine.
  "configJson": {
    "prompt":     string,                   // the per-run prompt sent to the agent
    "execution": {
      "model":       string,                // claude-sonnet-4-6 (default), opus, or haiku
      "maxTurns":    number,                // 1-25; pick what the task needs
      "timeoutMs":   number,                // 30_000 - 1_800_000
      "tools":       string[],              // subset of: Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch
      "dryRun":      boolean,               // true to strip Edit/Write/Bash at runtime
      "maxCostUsd":  number                 // optional kill switch; omit if not relevant
    },
    "triggers": [                            // 0+ entries; omit the array if manual-only
      { "type": "cron", "schedule": "0 9 * * *" }
      | { "type": "webhook", "path": "my-hook" }
      | { "type": "file", "patterns": ["src/**/*.ts"] }
      | { "type": "github", "repo": "owner/name", "events": ["pr:opened"] }
      | { "type": "agent", "source": "upstream-agent-name" }
    ]
  },
  "recommendedConnectors": string[]         // ["github","jira","slack"] hints — empty if none
}

Conventions:
- Side-effecting actions (post a PR comment, push a commit, send a Slack
  message) MUST go through the propose_action MCP tool — never instruct
  the agent to call \`gh\` / Slack API / etc. directly.
- For triggers that imply external systems (GitHub events, Jira fetches,
  Slack posts), list the relevant connector in recommendedConnectors.
- Default model: claude-sonnet-4-6. Use haiku for cheap/fast/dry-run
  digests, opus for high-judgment review. Reasoning agents that need
  to read code should include Read/Glob/Grep at minimum.
- If the user describes something destructive or unsafe, set dryRun:true
  and explain in the systemPrompt.

Now produce ONE JSON object matching that schema.`;

interface GeneratedAgent {
  name: string;
  description: string;
  systemPrompt: string;
  configJson: Record<string, unknown>;
  recommendedConnectors?: string[];
}

function extractJsonBlock(text: string): string | null {
  // Prefer a fenced ```json ... ``` block; fall back to the first {...}.
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const naked = text.match(/\{[\s\S]*\}/);
  return naked ? naked[0] : null;
}

agentsGenerateRouter.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return c.json({ error: "invalid_description" }, 400);
  }
  if (description.length > 2000) {
    return c.json(
      { error: "description_too_long", limit: 2000 },
      400,
    );
  }

  const userPrompt = `Design an agent for this request:\n\n${description}`;

  let output = "";
  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        systemPrompt: META_SYSTEM_PROMPT,
        maxTurns: 1,
        // No tools — we want a single JSON response, no side effects.
        allowedTools: [],
        permissionMode: "default",
      },
    })) {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: unknown }).type === "assistant"
      ) {
        const inner = (message as { message?: { content?: unknown[] } }).message;
        for (const block of inner?.content ?? []) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: unknown }).type === "text"
          ) {
            output += String((block as { text?: unknown }).text ?? "");
          }
        }
      }
    }
  } catch (err) {
    return c.json(
      {
        error: "generation_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  const jsonText = extractJsonBlock(output);
  if (!jsonText) {
    return c.json(
      {
        error: "no_json_in_response",
        rawOutput: output.slice(0, 500),
      },
      502,
    );
  }

  let parsed: GeneratedAgent;
  try {
    parsed = JSON.parse(jsonText) as GeneratedAgent;
  } catch (err) {
    return c.json(
      {
        error: "invalid_json",
        message: err instanceof Error ? err.message : String(err),
        rawJson: jsonText.slice(0, 500),
      },
      502,
    );
  }

  // Lightweight shape check — the UI further validates before save.
  if (
    typeof parsed.name !== "string" ||
    typeof parsed.description !== "string" ||
    typeof parsed.systemPrompt !== "string" ||
    !parsed.configJson ||
    typeof parsed.configJson !== "object"
  ) {
    return c.json(
      { error: "incomplete_draft", got: Object.keys(parsed) },
      502,
    );
  }

  return c.json({ draft: parsed });
});
