#!/usr/bin/env node
/**
 * `pnpm mcp <subcommand>` — MCP server registry management.
 *
 *   add --name <n> --transport stdio --command <cmd> [--arg <a>...] [--env KEY=VAL...]
 *   add --name <n> --transport http  --url <url> [--header KEY=VAL...]
 *   add --name <n> --transport sse   --url <url> [--header KEY=VAL...]
 *   list
 *   test --name <n>      Connect + tools/list + cache the response
 *   remove --name <n>
 */

import {
  addMcpServer,
  closeDb,
  listMcpServers,
  removeMcpServer,
  testMcpServer,
  type McpConfig,
  type McpTransport,
} from "../index.js";
import { loadWorkspaceEnv } from "./env.js";

interface RepeatableFlags {
  args: string[];
  envs: Array<{ key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
}

interface ParsedArgs {
  subcommand: string;
  flags: Record<string, string | true>;
  rep: RepeatableFlags;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [subcommand, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  const rep: RepeatableFlags = { args: [], envs: [], headers: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (key === "arg" && typeof next === "string") {
      rep.args.push(next);
      i++;
      continue;
    }
    if (key === "env" && typeof next === "string") {
      const eq = next.indexOf("=");
      if (eq < 1) throw new Error(`--env must be KEY=VALUE, got: ${next}`);
      rep.envs.push({ key: next.slice(0, eq), value: next.slice(eq + 1) });
      i++;
      continue;
    }
    if (key === "header" && typeof next === "string") {
      const eq = next.indexOf(":");
      if (eq < 1) throw new Error(`--header must be 'Name: Value', got: ${next}`);
      rep.headers.push({
        key: next.slice(0, eq).trim(),
        value: next.slice(eq + 1).trim(),
      });
      i++;
      continue;
    }
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { subcommand: subcommand ?? "", flags, rep };
}

function need(flags: Record<string, string | true>, key: string): string {
  const v = flags[key];
  if (typeof v !== "string" || !v) {
    throw new Error(`Missing required flag --${key}`);
  }
  return v;
}

function usage(): never {
  console.error(
    "Usage:\n" +
      "  pnpm mcp add --name <n> --transport stdio --command <c> [--arg <a>]... [--env KEY=VAL]...\n" +
      "  pnpm mcp add --name <n> --transport http  --url <url> [--header 'Name: Value']...\n" +
      "  pnpm mcp add --name <n> --transport sse   --url <url> [--header 'Name: Value']...\n" +
      "  pnpm mcp list\n" +
      "  pnpm mcp test --name <n>\n" +
      "  pnpm mcp remove --name <n>",
  );
  process.exit(2);
}

function envArrayToObject(rep: RepeatableFlags): Record<string, string> | undefined {
  if (rep.envs.length === 0) return undefined;
  return Object.fromEntries(rep.envs.map((e) => [e.key, e.value]));
}

function headerArrayToObject(rep: RepeatableFlags): Record<string, string> | undefined {
  if (rep.headers.length === 0) return undefined;
  return Object.fromEntries(rep.headers.map((h) => [h.key, h.value]));
}

async function cmdAdd(parsed: ParsedArgs): Promise<void> {
  const name = need(parsed.flags, "name");
  const transport = need(parsed.flags, "transport") as McpTransport;

  let configJson: McpConfig;
  switch (transport) {
    case "stdio": {
      const command = need(parsed.flags, "command");
      configJson = {
        command,
        args: parsed.rep.args.length > 0 ? parsed.rep.args : undefined,
        env: envArrayToObject(parsed.rep),
      };
      break;
    }
    case "http":
    case "sse": {
      const url = need(parsed.flags, "url");
      configJson = {
        url,
        headers: headerArrayToObject(parsed.rep),
      };
      break;
    }
    default:
      throw new Error(`--transport must be stdio|http|sse, got: ${transport}`);
  }

  const row = await addMcpServer({ name, transport, configJson });
  console.log(
    JSON.stringify(
      { id: row.id, name: row.name, transport: row.transport, configJson: row.configJson },
      null,
      2,
    ),
  );
}

async function cmdList(): Promise<void> {
  const rows = await listMcpServers();
  if (rows.length === 0) {
    console.log("(no mcp servers)");
    return;
  }
  for (const r of rows) {
    const tools = Array.isArray(r.cachedToolsJson)
      ? `${(r.cachedToolsJson as unknown[]).length} cached tools`
      : "(untested)";
    console.log(
      `${r.name.padEnd(18)}  ${r.transport.padEnd(6)}  ${r.enabled ? "" : "(disabled) "}${tools}`,
    );
  }
}

async function cmdTest(parsed: ParsedArgs): Promise<void> {
  const name = need(parsed.flags, "name");
  const result = await testMcpServer(name);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function cmdRemove(parsed: ParsedArgs): Promise<void> {
  const name = need(parsed.flags, "name");
  const ok = await removeMcpServer(name);
  console.log(ok ? `removed ${name}` : `not found: ${name}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  loadWorkspaceEnv();
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.subcommand) {
    case "add":
      await cmdAdd(parsed);
      break;
    case "list":
      await cmdList();
      break;
    case "test":
      await cmdTest(parsed);
      break;
    case "remove":
      await cmdRemove(parsed);
      break;
    default:
      usage();
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error("error:", err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
