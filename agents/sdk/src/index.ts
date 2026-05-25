/**
 * @agents/sdk — public API
 */

export { defineAgent } from "./define.js";
export { executeAgent } from "./runner.js";
export type { ExecuteAgentOptions } from "./runner.js";
export { logger } from "./logger.js";
// Re-export so api/scheduler don't need a direct dep on the underlying SDK.
export type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export type {
  AgentConfig,
  AgentTrigger,
  CronTrigger,
  ExecutionConfig,
  FileTrigger,
  GitHubEvent,
  GitHubIssueEvent,
  GitHubPREvent,
  GitHubTrigger,
  RunEvent,
  RunEventKind,
  RunResult,
  RunStatus,
  Trigger,
  TriggerContext,
  WebhookTrigger,
} from "./config.js";
