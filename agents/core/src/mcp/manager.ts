/**
 * MCP registry — CRUD + `test` (connect, tools/list, cache).
 *
 * Test results are cached into the row's `cached_tools_json` and
 * `cached_tools_fetched_at` columns so the UI can render last-known tools
 * without having to spawn the server on every page load.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";
import { listTools } from "./client.js";
import type {
  McpConfig,
  McpServerRow,
  McpTestResult,
  McpTransport,
} from "./types.js";

export type {
  HttpConfig,
  McpConfig,
  McpServerRow,
  McpTestResult,
  McpTool,
  McpTransport,
  SseConfig,
  StdioConfig,
} from "./types.js";

export interface AddMcpServerArgs {
  name: string;
  transport: McpTransport;
  configJson: McpConfig;
  /** Optional keychain ref — secrets-per-env-value lands in a later slice. */
  secretRef?: string;
  /** User who owns this server. Null only for legacy/orphan rows. */
  ownerId?: string;
}

export async function addMcpServer(args: AddMcpServerArgs): Promise<McpServerRow> {
  const db = getDb();
  const [row] = await db
    .insert(schema.mcpServers)
    .values({
      name: args.name,
      transport: args.transport,
      configJson: args.configJson,
      secretRef: args.secretRef,
      enabled: true,
      ownerId: args.ownerId,
    })
    .returning();
  return row;
}

export async function listMcpServers(): Promise<McpServerRow[]> {
  return getDb()
    .select()
    .from(schema.mcpServers)
    .orderBy(schema.mcpServers.name);
}

export async function getMcpServerByName(
  name: string,
): Promise<McpServerRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.name, name))
    .limit(1);
  return row;
}

export async function removeMcpServer(name: string): Promise<boolean> {
  const db = getDb();
  const existing = await getMcpServerByName(name);
  if (!existing) return false;
  await db.delete(schema.mcpServers).where(eq(schema.mcpServers.name, name));
  return true;
}

/**
 * Probe the server: spin up the transport, call tools/list, persist the result
 * into the row's cachedToolsJson + cachedToolsFetchedAt columns. Returns the
 * full test result so the caller can surface it (CLI/UI).
 */
export async function testMcpServer(name: string): Promise<McpTestResult> {
  const server = await getMcpServerByName(name);
  if (!server) {
    return { ok: false, message: `mcp server "${name}" not found` };
  }
  if (!server.enabled) {
    return { ok: false, message: `mcp server "${name}" is disabled` };
  }

  const result = await listTools(
    server.transport as McpTransport,
    server.configJson as unknown as McpConfig,
  );

  if (result.ok) {
    await getDb()
      .update(schema.mcpServers)
      .set({
        cachedToolsJson: result.tools ?? [],
        cachedToolsFetchedAt: new Date(),
      })
      .where(eq(schema.mcpServers.id, server.id));
  }
  return result;
}
