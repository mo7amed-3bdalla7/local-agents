/**
 * Thin wrapper around @modelcontextprotocol/sdk for connecting to a server,
 * calling tools/list, and returning the result.
 *
 * Lives behind `listTools()` so callers don't have to know about transport
 * construction or the client/protocol lifecycle.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  HttpConfig,
  McpConfig,
  McpTestResult,
  McpTool,
  McpTransport,
  SseConfig,
  StdioConfig,
} from "./types.js";

const CLIENT_NAME = "agents-platform-mcp-probe";
const CLIENT_VERSION = "0.1.0";

function makeTransport(transport: McpTransport, config: McpConfig) {
  switch (transport) {
    case "stdio": {
      const c = config as StdioConfig;
      return new StdioClientTransport({
        command: c.command,
        args: c.args ?? [],
        env: c.env,
      });
    }
    case "http": {
      const c = config as HttpConfig;
      return new StreamableHTTPClientTransport(new URL(c.url), {
        requestInit: c.headers ? { headers: c.headers } : undefined,
      });
    }
    case "sse": {
      const c = config as SseConfig;
      return new SSEClientTransport(new URL(c.url), {
        requestInit: c.headers ? { headers: c.headers } : undefined,
      });
    }
  }
}

/**
 * Connect, list tools, disconnect. Always closes — even on partial failures.
 * Caller decides whether to surface the result as ok/not-ok.
 */
export async function listTools(
  transport: McpTransport,
  config: McpConfig,
  opts: { timeoutMs?: number } = {},
): Promise<McpTestResult> {
  const t = makeTransport(transport, config);
  const client = new Client(
    { name: CLIENT_NAME, version: CLIENT_VERSION },
    { capabilities: {} },
  );

  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timeoutErr = new Error(`MCP tools/list timed out after ${timeoutMs}ms`);

  try {
    await withTimeout(client.connect(t), timeoutMs, timeoutErr);
    const result = (await withTimeout(
      client.listTools(),
      timeoutMs,
      timeoutErr,
    )) as { tools?: McpTool[] };
    const tools = result.tools ?? [];
    return {
      ok: true,
      message: `${tools.length} tool(s) available`,
      toolsCount: tools.length,
      tools,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  timeoutErr: Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutErr), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
