/**
 * POST /api/agents/:id/refine — natural-language revision of an existing
 * agent. Claude reads the current systemPrompt + configJson plus the user's
 * instruction and emits a full updated draft for review. Does NOT persist
 * — the UI shows a diff and the user applies via PATCH /api/agents/:id.
 *
 * Ownership-scoped: only the owner of a db-source agent can refine it.
 * File-source agents are read-only and reject with 403.
 */

import { Hono } from "hono";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@agents/core";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";

export const agentsRefineRouter = new Hono();

function visibleToUser(userId: string) {
  return or(isNull(schema.agents.ownerId), eq(schema.agents.ownerId, userId));
}

const REFINE_SYSTEM_PROMPT = `You revise Claude-Agent-SDK agents for the local-agents-me platform.

You are given:
  1. The agent's CURRENT system prompt
  2. The agent's CURRENT configJson ({prompt, execution, triggers, ...})
  3. A user instruction describing the change they want

Emit ONE JSON object inside a fenced \`\`\`json block. No prose before
or after. The JSON must have exactly:

{
  "systemPrompt": string  // the FULL updated system prompt — not a diff
  "configJson":   object  // the FULL updated configJson — not a diff
  "changeNote":   string  // one sentence describing what you changed and why
}

Rules:
- Preserve everything the user did NOT ask to change. If the instruction
  is "make this run hourly", change configJson.triggers and leave the
  systemPrompt alone (or note that the prompt is unaffected).
- Don't lose existing safety settings (dryRun, maxCostUsd) unless the
  user explicitly asks to remove them.
- Don't rewrite the prompt's voice or style — keep the agent's tone.
- For side-effecting changes, ensure the agent still uses propose_action
  rather than calling external APIs directly.
- Don't change configJson.execution.tools unless the instruction implies it.
- Trigger types: cron, webhook, file, github, agent. Same shapes as
  the platform documents in AGENTS.md.

Output ONLY the JSON block.`;

interface RefineResult {
  systemPrompt: string;
  configJson: Record<string, unknown>;
  changeNote: string;
}

function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const naked = text.match(/\{[\s\S]*\}/);
  return naked ? naked[0] : null;
}

agentsRefineRouter.post("/:id/refine", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);

  const userId = currentUserId(c);
  const db = getDb();
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), visibleToUser(userId)))
    .limit(1);
  if (!agent) return c.json({ error: "agent not found" }, 404);
  // file-source agents live on disk; refining doesn't make sense — the
  // user has to edit the file. Allow only owned db-source.
  if (agent.source === "file") {
    return c.json(
      {
        error: "file_source_read_only",
        message: "Refine works on db-source agents only. Clone or edit on disk.",
      },
      403,
    );
  }
  if (agent.ownerId !== userId) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const instruction =
    typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) return c.json({ error: "invalid_instruction" }, 400);
  if (instruction.length > 2000) {
    return c.json({ error: "instruction_too_long", limit: 2000 }, 400);
  }

  const userPrompt = [
    `Current systemPrompt:\n---\n${agent.systemPrompt ?? "(none)"}\n---`,
    `Current configJson:\n${JSON.stringify(agent.configJson, null, 2)}`,
    `User instruction:\n${instruction}`,
    `Emit the revised agent as one fenced JSON block.`,
  ].join("\n\n");

  let output = "";
  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        systemPrompt: REFINE_SYSTEM_PROMPT,
        maxTurns: 1,
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
        error: "refine_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  const jsonText = extractJsonBlock(output);
  if (!jsonText) {
    return c.json(
      { error: "no_json_in_response", rawOutput: output.slice(0, 500) },
      502,
    );
  }

  let parsed: RefineResult;
  try {
    parsed = JSON.parse(jsonText) as RefineResult;
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
  if (
    typeof parsed.systemPrompt !== "string" ||
    !parsed.configJson ||
    typeof parsed.configJson !== "object"
  ) {
    return c.json(
      { error: "incomplete_draft", got: Object.keys(parsed) },
      502,
    );
  }

  return c.json({
    before: {
      systemPrompt: agent.systemPrompt ?? "",
      configJson: agent.configJson,
    },
    after: {
      systemPrompt: parsed.systemPrompt,
      configJson: parsed.configJson,
    },
    changeNote: typeof parsed.changeNote === "string" ? parsed.changeNote : "",
  });
});
