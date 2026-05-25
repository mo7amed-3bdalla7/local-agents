#!/usr/bin/env node
/**
 * `pnpm connector <subcommand>` — connector registry management.
 *
 * Subcommands:
 *   add --type jira --display-name "..." --host "..." --email "..." --token "..."
 *   list
 *   test --id <uuid>
 *   remove --id <uuid>
 *
 * The secret value (--token, --password, …) never lands in the DB — it goes
 * straight into the OS keychain; only the keychain ref is persisted.
 */

import {
  addConnector,
  closeDb,
  getConnector,
  listConnectors,
  removeConnector,
  testConnector,
} from "../index.js";
import { loadWorkspaceEnv } from "./env.js";

type Flags = Record<string, string | true>;

function parseArgs(argv: string[]): { subcommand: string; flags: Flags } {
  const [subcommand, ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { subcommand: subcommand ?? "", flags };
}

function need(flags: Flags, key: string): string {
  const v = flags[key];
  if (typeof v !== "string" || !v) {
    throw new Error(`Missing required flag --${key}`);
  }
  return v;
}

function usage(): never {
  console.error(
    "Usage: pnpm connector <add|list|test|remove> [--flags]\n" +
      "  add --type <type> --display-name <name> [type-specific flags]\n" +
      "    Jira: --type jira --host https://x.atlassian.net --email me@x.com --token <T>\n" +
      "  list\n" +
      "  test --id <uuid>\n" +
      "  remove --id <uuid>",
  );
  process.exit(2);
}

async function cmdAdd(flags: Flags): Promise<void> {
  const type = need(flags, "type");
  const displayName = need(flags, "display-name");

  let configJson: Record<string, unknown>;
  let secret: string | undefined;

  switch (type) {
    case "jira": {
      const host = need(flags, "host").replace(/\/$/, "");
      if (!/^https?:\/\//.test(host)) {
        throw new Error(`--host must be a full URL, got: ${host}`);
      }
      const email = need(flags, "email");
      const token = need(flags, "token");
      configJson = { host, email };
      secret = token;
      break;
    }
    default:
      throw new Error(
        `Unsupported connector type "${type}". Supported: jira`,
      );
  }

  const row = await addConnector({
    connectorType: type,
    displayName,
    configJson,
    secret,
  });
  console.log(
    JSON.stringify(
      {
        id: row.id,
        connectorType: row.connectorType,
        displayName: row.displayName,
        configJson: row.configJson,
        secretRef: row.secretRef,
      },
      null,
      2,
    ),
  );
}

async function cmdList(): Promise<void> {
  const rows = await listConnectors();
  if (rows.length === 0) {
    console.log("(no connectors)");
    return;
  }
  for (const r of rows) {
    const cfg = JSON.stringify(r.configJson);
    console.log(
      `${r.id}  ${r.connectorType.padEnd(8)}  ${r.displayName}  ${r.enabled ? "" : "(disabled) "}${cfg}`,
    );
  }
}

async function cmdTest(flags: Flags): Promise<void> {
  const id = need(flags, "id");
  const result = await testConnector(id);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function cmdRemove(flags: Flags): Promise<void> {
  const id = need(flags, "id");
  const connector = await getConnector(id);
  if (!connector) {
    console.error(`connector ${id} not found`);
    process.exitCode = 1;
    return;
  }
  const ok = await removeConnector(id);
  console.log(ok ? `removed ${connector.displayName}` : `nothing to remove`);
}

async function main(): Promise<void> {
  loadWorkspaceEnv();
  const { subcommand, flags } = parseArgs(process.argv.slice(2));
  switch (subcommand) {
    case "add":
      await cmdAdd(flags);
      break;
    case "list":
      await cmdList();
      break;
    case "test":
      await cmdTest(flags);
      break;
    case "remove":
      await cmdRemove(flags);
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
