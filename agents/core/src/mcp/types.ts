/**
 * MCP transport config shapes — the contract for the `mcp_servers.config_json`
 * blob. Per-transport because each one needs different fields.
 */

import type { mcpServers } from "../db/schema.js";

export type McpServerRow = typeof mcpServers.$inferSelect;

export type McpTransport = "stdio" | "http" | "sse";

/** stdio: spawn `command` with `args`, talk JSON-RPC over stdin/stdout. */
export interface StdioConfig {
  command: string;
  args?: string[];
  /** Extra env vars merged into a minimal default set. Plaintext for now. */
  env?: Record<string, string>;
}

/** HTTP streamable (the modern MCP HTTP transport). */
export interface HttpConfig {
  url: string;
  headers?: Record<string, string>;
}

/** Legacy SSE. */
export interface SseConfig {
  url: string;
  headers?: Record<string, string>;
}

export type McpConfig = StdioConfig | HttpConfig | SseConfig;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpTestResult {
  ok: boolean;
  message: string;
  toolsCount?: number;
  tools?: McpTool[];
}
