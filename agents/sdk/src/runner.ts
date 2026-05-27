/**
 * executeAgent() — loads AGENTS.md, builds the prompt with trigger context,
 * calls the Claude Agent SDK query(), handles timeout/retry/abort.
 */

import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  query,
  type McpServerConfig,
  type PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";

import {
  MUTATING_TOOLS,
  type AgentConfig,
  type RunEvent,
  type RunResult,
  type RunStatus,
  type RunUsage,
  type TriggerContext,
} from "./config.js";
import { logger } from "./logger.js";

/**
 * Load agent-specific .env file into process.env (without overwriting existing vars).
 * Returns keys that were added so they can be cleaned up after the run.
 */
async function loadAgentEnv(agentDir: string): Promise<string[]> {
  const envPath = join(agentDir, ".env");
  if (!existsSync(envPath)) return [];

  const added: string[] = [];
  try {
    const content = await readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
        added.push(key);
      }
    }
    if (added.length > 0) {
      logger.info("Loaded agent .env", { agentDir, keys: added });
    }
  } catch (err) {
    logger.warn("Failed to load agent .env", { agentDir, error: String(err) });
  }
  return added;
}

function logTs(): string {
  return new Date().toISOString();
}

function logLine(stream: WriteStream, msg: string): void {
  stream.write(`[${logTs()}] ${msg}\n`);
}

async function openRunLog(
  agentDir: string,
  agentName: string,
  triggerType: string,
): Promise<WriteStream> {
  const logsDir = join(agentDir, "logs");
  await mkdir(logsDir, { recursive: true });
  const ts = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d+Z$/, "");
  const filename = `${ts}_${triggerType}.log`;
  return createWriteStream(join(logsDir, filename));
}

function formatMessage(message: unknown): string {
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    return JSON.stringify(message, null, 2);
  }
  return String(message);
}

/** Resolve the prompt string for a given trigger context. */
function resolvePrompt(config: AgentConfig, ctx: TriggerContext): string {
  if (typeof config.prompt === "function") return config.prompt(ctx);
  if (typeof config.prompt === "string") return config.prompt;
  return `You are the "${config.name}" agent. ${config.description}`;
}

/** Load the agent's AGENTS.md as a system prompt. */
async function loadSystemPrompt(agentDir: string): Promise<string> {
  const agentsPath = join(agentDir, "AGENTS.md");
  try {
    return await readFile(agentsPath, "utf-8");
  } catch {
    logger.warn("No AGENTS.md found, using empty system prompt", {
      agent: agentDir,
    });
    return "";
  }
}

export interface ExecuteAgentOptions {
  config: AgentConfig;
  /** Absolute path to the agent's package directory. */
  agentDir: string;
  triggerContext: TriggerContext;
  /** AbortSignal for external cancellation. */
  signal?: AbortSignal;
  /**
   * Optional callback fired for each event emitted during the run. Used by the
   * API worker to persist messages/errors into `session_events`. Awaited inline,
   * so keep it fast — slow handlers will stall the SDK message loop.
   */
  onEvent?: (event: RunEvent) => void | Promise<void>;
  /**
   * Extra environment variables to inject for the duration of the run.
   * Inherited by every Bash tool call the agent makes (e.g. AGENTS_SESSION_ID
   * so shell-driven CLIs can attribute work back to the session).
   */
  extraEnv?: Record<string, string>;
  /**
   * MCP servers to expose to the agent, keyed by server name. Forwarded to the
   * Claude Agent SDK `query({ mcpServers })` option so the agent sees the
   * server's tools alongside the SDK built-ins. The worker assembles this map
   * from the agent's attached, enabled rows in `agent_mcp_servers`.
   */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Skills to load into the agent's system prompt. Names match SKILL.md
   * frontmatter `name` (or plugin-qualified `plugin:skill`). The worker passes
   * the agent's attached + enabled skill names; the SDK then hides every other
   * discovered skill from the prompt. If empty/undefined the SDK default kicks
   * in (load all discovered skills).
   */
  skills?: string[];
  /**
   * Extra tool names to append to the agent's allowedTools list. Used to
   * grant access to system-injected MCP tools (e.g. the approvals server)
   * without the agent author having to allowlist them in their config.
   */
  extraAllowedTools?: string[];
}

/**
 * Execute an agent by calling the Claude Agent SDK query loop.
 *
 * Returns a RunResult summarizing the execution.
 */
export async function executeAgent(
  opts: ExecuteAgentOptions,
): Promise<RunResult> {
  const {
    config,
    agentDir,
    triggerContext,
    signal,
    onEvent,
    extraEnv,
    mcpServers,
    skills,
    extraAllowedTools,
  } = opts;
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const addedEnvKeys = await loadAgentEnv(agentDir);

  // Snapshot any extraEnv keys we'll set so we can restore them in finally.
  const savedExtraEnv: Record<string, string | undefined> = {};
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      savedExtraEnv[key] = process.env[key];
      process.env[key] = value;
    }
  }

  try {
    return await executeAgentCore(
      config,
      agentDir,
      triggerContext,
      startedAt,
      start,
      signal,
      onEvent,
      mcpServers,
      skills,
      extraAllowedTools,
    );
  } finally {
    for (const key of addedEnvKeys) {
      delete process.env[key];
    }
    for (const [key, prior] of Object.entries(savedExtraEnv)) {
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    }
  }
}

async function emitEvent(
  onEvent: ExecuteAgentOptions["onEvent"],
  event: RunEvent,
): Promise<void> {
  if (!onEvent) return;
  try {
    await onEvent(event);
  } catch (err) {
    logger.warn("onEvent handler threw", { error: String(err) });
  }
}

async function executeAgentCore(
  config: AgentConfig,
  agentDir: string,
  triggerContext: TriggerContext,
  startedAt: string,
  start: number,
  signal?: AbortSignal,
  onEvent?: ExecuteAgentOptions["onEvent"],
  mcpServers?: Record<string, McpServerConfig>,
  skills?: string[],
  extraAllowedTools?: string[],
): Promise<RunResult> {
  const log = await openRunLog(
    agentDir,
    config.name,
    triggerContext.triggerType,
  );

  log.write(`${"=".repeat(72)}\n`);
  logLine(log, `Agent: ${config.name}`);
  logLine(log, `Trigger: ${triggerContext.triggerType}`);
  logLine(log, `Model: ${config.execution?.model ?? "(default)"}`);
  logLine(log, `CWD: ${config.execution?.cwd ?? agentDir}`);
  logLine(log, `Max turns: ${config.execution?.maxTurns ?? 10}`);
  logLine(log, `Timeout: ${config.execution?.timeoutMs ?? 300_000}ms`);
  log.write(`${"=".repeat(72)}\n\n`);

  // Unset CLAUDECODE so the Claude Code subprocess doesn't refuse to run nested
  const savedClaudeCode = process.env.CLAUDECODE;
  delete process.env.CLAUDECODE;
  const restoreClaudeCode = () => {
    if (savedClaudeCode !== undefined) process.env.CLAUDECODE = savedClaudeCode;
  };

  const retries = config.execution?.retries ?? 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      logLine(log, "Run aborted by signal");
      log.end();
      restoreClaudeCode();
      return buildResult(config, triggerContext, startedAt, start, "aborted");
    }

    if (attempt > 0) {
      logLine(log, `--- Retry attempt ${attempt} ---`);
    }

    try {
      const systemPrompt = await loadSystemPrompt(agentDir);
      const prompt = resolvePrompt(config, triggerContext);
      const fullPrompt = buildFullPrompt(prompt, triggerContext);

      logLine(log, "Prompt sent to agent:");
      log.write(fullPrompt + "\n\n");

      const timeoutMs = config.execution?.timeoutMs ?? 300_000;
      const cwd = config.execution?.cwd ?? agentDir;
      let output = "";

      let baseTools = config.execution?.tools ?? [
        "Read",
        "Edit",
        "Bash",
        "Glob",
        "Grep",
      ];
      if (config.execution?.dryRun) {
        baseTools = baseTools.filter((t) => !MUTATING_TOOLS.has(t));
        logLine(log, `Dry-run mode active. Mutating tools stripped.`);
      }
      const allowedTools =
        extraAllowedTools && extraAllowedTools.length > 0
          ? [...baseTools, ...extraAllowedTools]
          : baseTools;
      const queryOptions: Record<string, unknown> = {
        systemPrompt: systemPrompt || undefined,
        allowedTools,
        permissionMode: (config.execution?.permissionMode ?? "acceptEdits") as PermissionMode,
        maxTurns: config.execution?.maxTurns ?? 10,
        cwd,
      };
      if (config.execution?.model) {
        queryOptions.model = config.execution.model;
      }
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        queryOptions.mcpServers = mcpServers;
      }
      if (skills && skills.length > 0) {
        queryOptions.skills = skills;
      }

      let usage: RunUsage | undefined;
      const result = await Promise.race([
        (async () => {
          for await (const message of query({
            prompt: fullPrompt,
            options: queryOptions as Parameters<typeof query>[0]["options"],
          })) {
            if (signal?.aborted) break;

            logLine(log, "--- message ---");
            log.write(formatMessage(message) + "\n");

            await emitEvent(onEvent, {
              kind: "message",
              payload: message,
              ts: new Date().toISOString(),
            });

            // Intercept the SDK's final result message to capture token + cost
            // accounting. Shape is { type:"result", total_cost_usd, usage:
            // { input_tokens, output_tokens, cache_creation_input_tokens,
            //   cache_read_input_tokens } }. All fields optional — we copy
            // whatever's present.
            if (
              message &&
              typeof message === "object" &&
              (message as { type?: unknown }).type === "result"
            ) {
              const m = message as {
                total_cost_usd?: unknown;
                usage?: {
                  input_tokens?: unknown;
                  output_tokens?: unknown;
                  cache_creation_input_tokens?: unknown;
                  cache_read_input_tokens?: unknown;
                };
              };
              usage = {
                ...(typeof m.total_cost_usd === "number"
                  ? { totalCostUsd: m.total_cost_usd }
                  : {}),
                ...(typeof m.usage?.input_tokens === "number"
                  ? { inputTokens: m.usage.input_tokens }
                  : {}),
                ...(typeof m.usage?.output_tokens === "number"
                  ? { outputTokens: m.usage.output_tokens }
                  : {}),
                ...(typeof m.usage?.cache_creation_input_tokens === "number"
                  ? { cacheCreationTokens: m.usage.cache_creation_input_tokens }
                  : {}),
                ...(typeof m.usage?.cache_read_input_tokens === "number"
                  ? { cacheReadTokens: m.usage.cache_read_input_tokens }
                  : {}),
              };
            }

            if (typeof message === "string") {
              output += message;
            } else if (message && typeof message === "object" && "content" in message) {
              output += String((message as { content: unknown }).content);
            }
          }
          return { status: "success" as const, output, usage };
        })(),
        timeoutPromise(timeoutMs),
      ]);

      if (result.status === "timeout") {
        logLine(log, `Run timed out after ${timeoutMs}ms`);
        log.end();
        restoreClaudeCode();
        return buildResult(
          config,
          triggerContext,
          startedAt,
          start,
          "timeout",
          undefined,
          "Execution timed out",
        );
      }

      const finalResult = buildResult(
        config,
        triggerContext,
        startedAt,
        start,
        "success",
        result.output,
        undefined,
        result.usage,
      );
      log.write(`\n${"=".repeat(72)}\n`);
      logLine(log, `Run finished — status: ${finalResult.status}, duration: ${finalResult.durationMs}ms`);
      log.end();
      restoreClaudeCode();
      return finalResult;
    } catch (err) {
      lastError = err;
      logLine(log, `Error: ${String(err)}`);
      await emitEvent(onEvent, {
        kind: "error",
        payload: { message: err instanceof Error ? err.message : String(err), attempt },
        ts: new Date().toISOString(),
      });
      if (attempt < retries) {
        logger.warn("Agent execution failed, retrying", {
          agent: config.name,
          attempt: attempt + 1,
          error: String(err),
        });
      }
    }
  }

  const failResult = buildResult(
    config,
    triggerContext,
    startedAt,
    start,
    "failure",
    undefined,
    lastError instanceof Error ? lastError.message : String(lastError),
  );
  log.write(`\n${"=".repeat(72)}\n`);
  logLine(log, `Run finished — status: ${failResult.status}, error: ${failResult.error}`);
  log.end();
  restoreClaudeCode();
  return failResult;
}

function buildFullPrompt(prompt: string, ctx: TriggerContext): string {
  const parts = [prompt];

  if (ctx.triggerType === "webhook" && ctx.webhookBody) {
    parts.push(
      `\n\nWebhook payload:\n\`\`\`json\n${JSON.stringify(ctx.webhookBody, null, 2)}\n\`\`\``,
    );
  }
  if (ctx.triggerType === "file" && ctx.changedFiles?.length) {
    parts.push(`\n\nChanged files:\n${ctx.changedFiles.join("\n")}`);
  }
  if (ctx.triggerType === "agent" && ctx.upstreamResult) {
    parts.push(
      `\n\nUpstream agent "${ctx.upstreamResult.agentName}" result:\nStatus: ${ctx.upstreamResult.status}\nOutput: ${ctx.upstreamResult.output ?? "(none)"}`,
    );
  }
  if (ctx.meta && Object.keys(ctx.meta).length > 0) {
    parts.push(
      `\n\nTrigger metadata:\n\`\`\`json\n${JSON.stringify(ctx.meta, null, 2)}\n\`\`\``,
    );
  }

  return parts.join("");
}

function buildResult(
  config: AgentConfig,
  triggerContext: TriggerContext,
  startedAt: string,
  startMs: number,
  status: RunStatus,
  output?: string,
  error?: string,
  usage?: RunUsage,
): RunResult {
  const finishedAt = new Date().toISOString();
  return {
    agentName: config.name,
    status,
    triggerContext,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    output,
    error,
    usage,
  };
}

function timeoutPromise(
  ms: number,
): Promise<{ status: "timeout"; output?: undefined }> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ status: "timeout" }), ms),
  );
}
