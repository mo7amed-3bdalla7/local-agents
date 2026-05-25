#!/usr/bin/env node
/**
 * `pnpm pr-activity log` — record one row in pr_activity from a shell context.
 *
 * Usage:
 *   pnpm pr-activity log \
 *     --github owner/name \
 *     --pr 42 \
 *     --kind issue_comment \
 *     --payload '{"body":"hello"}' \
 *     [--session <uuid>] \
 *     [--github-id IC_kwDO...] \
 *     [--github-url https://github.com/...] \
 *     [--status posted|drafted|failed|pending_approval] \
 *     [--posted-sha abc123]
 *
 * If --session is omitted, the AGENTS_SESSION_ID env var is consulted (the
 * worker injects this so agent shell commands inherit it).
 */

import { eq } from "drizzle-orm";
import {
  closeDb,
  ensureRepo,
  getDb,
  logPrActivity,
  schema,
  type PrActivityKind,
  type PrActivityStatus,
} from "../index.js";
import { loadWorkspaceEnv } from "./env.js";

const KINDS: PrActivityKind[] = [
  "issue_comment",
  "review_comment",
  "review_submitted",
  "thread_reply",
  "commit_pushed",
  "branch_pushed",
];
const STATUSES: PrActivityStatus[] = ["drafted", "pending_approval", "posted", "failed"];

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
    "Usage: pnpm pr-activity log --github owner/name --pr <n> --kind <kind> --payload <json> [--session <uuid>] [--github-id <id>] [--github-url <url>] [--status <status>] [--posted-sha <sha>]\n" +
      `  kinds:    ${KINDS.join(", ")}\n` +
      `  statuses: ${STATUSES.join(", ")}`,
  );
  process.exit(2);
}

async function cmdLog(flags: Flags): Promise<void> {
  const githubFullName = need(flags, "github");
  const prNumber = Number(need(flags, "pr"));
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error(`--pr must be a positive integer, got: ${flags.pr}`);
  }
  const kindRaw = need(flags, "kind") as PrActivityKind;
  if (!KINDS.includes(kindRaw)) {
    throw new Error(`--kind must be one of: ${KINDS.join(", ")}`);
  }
  const payloadRaw = need(flags, "payload");
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(payloadRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must be a JSON object");
    }
    payload = parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`--payload must be valid JSON object: ${err instanceof Error ? err.message : err}`);
  }
  const statusRaw =
    typeof flags.status === "string" ? (flags.status as PrActivityStatus) : undefined;
  if (statusRaw && !STATUSES.includes(statusRaw)) {
    throw new Error(`--status must be one of: ${STATUSES.join(", ")}`);
  }

  const sessionId =
    typeof flags.session === "string"
      ? flags.session
      : process.env.AGENTS_SESSION_ID || undefined;

  // Look up the repo without creating it — pr-activity should fail loudly if
  // the repo isn't already registered (caller should `pnpm repo register` first).
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(eq(schema.repos.githubFullName, githubFullName))
    .limit(1);
  let repoId = existing?.id;
  if (!repoId) {
    const repo = await ensureRepo({ githubFullName });
    repoId = repo.id;
  }

  const row = await logPrActivity({
    sessionId,
    repoId,
    prNumber,
    kind: kindRaw,
    payload,
    githubId: typeof flags["github-id"] === "string" ? flags["github-id"] : undefined,
    githubUrl: typeof flags["github-url"] === "string" ? flags["github-url"] : undefined,
    status: statusRaw,
    postedSha: typeof flags["posted-sha"] === "string" ? flags["posted-sha"] : undefined,
  });
  console.log(JSON.stringify({ id: row.id, status: row.status, postedAt: row.postedAt }, null, 2));
}

async function main(): Promise<void> {
  loadWorkspaceEnv();
  const { subcommand, flags } = parseArgs(process.argv.slice(2));
  switch (subcommand) {
    case "log":
      await cmdLog(flags);
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
