#!/usr/bin/env node
/**
 * `pnpm repo <subcommand>` — repo + worktree management CLI.
 *
 * Subcommands:
 *   register --github <owner/name> [--branch <default-branch>] [--test-command <cmd>]
 *     Register a repo. Clones it into the managed worktree root if missing.
 *
 *   ensure-worktree --github <owner/name> --branch <branch> [--session <uuid>]
 *     Materialize (or reuse) a git worktree for <branch>. Prints the absolute
 *     path on stdout — designed to be captured in shell scripts:
 *       WT=$(pnpm -s repo ensure-worktree --github owner/name --branch main)
 *
 *   list
 *     Print all registered repos with their local clone path.
 */

import { eq } from "drizzle-orm";
import {
  closeDb,
  ensureRepo,
  ensureWorktree,
  getDb,
  schema,
} from "../index.js";
import { loadWorkspaceEnv } from "./env.js";

interface Flags {
  [key: string]: string | true;
}

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
    "Usage: pnpm repo <register|ensure-worktree|list> [--flags]\n" +
      "  register --github owner/name [--branch main] [--test-command 'pnpm test']\n" +
      "  ensure-worktree --github owner/name --branch foo [--session <uuid>]\n" +
      "  list",
  );
  process.exit(2);
}

async function cmdRegister(flags: Flags): Promise<void> {
  const githubFullName = need(flags, "github");
  const branch = typeof flags.branch === "string" ? flags.branch : undefined;
  const testCommand =
    typeof flags["test-command"] === "string" ? flags["test-command"] : undefined;
  const repo = await ensureRepo({
    githubFullName,
    defaultBranch: branch,
    testCommand,
  });
  console.log(
    JSON.stringify(
      {
        id: repo.id,
        githubFullName: repo.githubFullName,
        localPath: repo.localPath,
        defaultBranch: repo.defaultBranch,
      },
      null,
      2,
    ),
  );
}

async function cmdEnsureWorktree(flags: Flags): Promise<void> {
  const githubFullName = need(flags, "github");
  const branch = need(flags, "branch");
  const sessionId =
    typeof flags.session === "string" ? flags.session : undefined;

  const repo = await ensureRepo({ githubFullName });
  const worktree = await ensureWorktree({
    repoId: repo.id,
    branch,
    sessionId,
  });
  // stdout = just the path so callers can capture it.
  // stderr = the structured row, for debugging.
  console.error(JSON.stringify({ repoId: repo.id, worktreeId: worktree.id, branch }));
  console.log(worktree.path);
}

async function cmdList(): Promise<void> {
  const rows = await getDb()
    .select()
    .from(schema.repos)
    .orderBy(schema.repos.githubFullName);
  if (rows.length === 0) {
    console.log("(no repos registered)");
    return;
  }
  for (const r of rows) {
    console.log(`${r.githubFullName}  ${r.localPath}`);
  }
}

async function cmdDelete(flags: Flags): Promise<void> {
  const githubFullName = need(flags, "github");
  const db = getDb();
  const deleted = await db
    .delete(schema.repos)
    .where(eq(schema.repos.githubFullName, githubFullName))
    .returning({ id: schema.repos.id });
  console.log(`deleted ${deleted.length} row(s) for ${githubFullName}`);
}

async function main(): Promise<void> {
  loadWorkspaceEnv();
  const { subcommand, flags } = parseArgs(process.argv.slice(2));
  switch (subcommand) {
    case "register":
      await cmdRegister(flags);
      break;
    case "ensure-worktree":
      await cmdEnsureWorktree(flags);
      break;
    case "list":
      await cmdList();
      break;
    case "delete":
      await cmdDelete(flags);
      break;
    default:
      usage();
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("error:", err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
