#!/usr/bin/env node
/**
 * `pnpm jira <subcommand>` — Jira read operations against the first enabled
 * Jira connector (override with --connector <uuid>).
 *
 * Subcommands:
 *   issue get <KEY>            print summary, status, assignee, type, priority
 *   issue search "<JQL>" [--max 25]
 *                              list matching issues, one per line
 */

import {
  closeDb,
  getActiveConnector,
  getConnector,
  readSecret,
  type ConnectorRow,
  type JiraConfig,
} from "../index.js";
import { getIssue, JiraError, searchIssues } from "../connectors/jira/client.js";
import { loadWorkspaceEnv } from "./env.js";

type Flags = Record<string, string | true>;

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage(): never {
  console.error(
    "Usage:\n" +
      "  pnpm jira issue get <KEY> [--connector <uuid>]\n" +
      "  pnpm jira issue search \"<JQL>\" [--max 25] [--connector <uuid>]",
  );
  process.exit(2);
}

async function resolveJiraDeps(flags: Flags): Promise<{
  connector: ConnectorRow;
  config: JiraConfig;
  token: string;
}> {
  const id = typeof flags.connector === "string" ? flags.connector : undefined;
  const connector = id
    ? await getConnector(id)
    : await getActiveConnector("jira");
  if (!connector) {
    throw new Error(
      id
        ? `connector ${id} not found`
        : "no enabled jira connector — add one with `pnpm connector add --type jira ...`",
    );
  }
  if (connector.connectorType !== "jira") {
    throw new Error(
      `connector ${connector.id} is type "${connector.connectorType}", expected "jira"`,
    );
  }
  const token = await readSecret(connector);
  if (!token) {
    throw new Error(`connector ${connector.displayName} has no secret in the keychain`);
  }
  return {
    connector,
    config: connector.configJson as unknown as JiraConfig,
    token,
  };
}

async function cmdIssueGet(positional: string[], flags: Flags): Promise<void> {
  const key = positional[0];
  if (!key) usage();
  const deps = await resolveJiraDeps(flags);
  const issue = await getIssue(deps, key);
  console.log(
    JSON.stringify(
      {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        type: issue.fields.issuetype.name,
        priority: issue.fields.priority?.name ?? null,
        assignee: issue.fields.assignee?.displayName ?? null,
        updated: issue.fields.updated,
      },
      null,
      2,
    ),
  );
}

async function cmdIssueSearch(positional: string[], flags: Flags): Promise<void> {
  const jql = positional[0];
  if (!jql) usage();
  const maxResults =
    typeof flags.max === "string" ? Number(flags.max) : undefined;
  const deps = await resolveJiraDeps(flags);
  const result = await searchIssues(deps, jql, { maxResults });
  console.log(`# total: ${result.total}, showing ${result.issues.length}`);
  for (const issue of result.issues) {
    console.log(
      `${issue.key.padEnd(12)}  ${issue.fields.status.name.padEnd(16)}  ${issue.fields.summary}`,
    );
  }
}

async function main(): Promise<void> {
  loadWorkspaceEnv();
  const [subcommand, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  try {
    switch (subcommand) {
      case "issue":
        switch (positional.shift()) {
          case "get":
            await cmdIssueGet(positional, flags);
            break;
          case "search":
            await cmdIssueSearch(positional, flags);
            break;
          default:
            usage();
        }
        break;
      default:
        usage();
    }
  } catch (err) {
    if (err instanceof JiraError) {
      console.error(`Jira ${err.status}: ${err.message}`);
      if (err.body) console.error(JSON.stringify(err.body, null, 2));
    } else {
      console.error("error:", err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error("fatal:", err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
