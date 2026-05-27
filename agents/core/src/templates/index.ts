/**
 * Agent templates — pre-built recipes a user can clone into a db-source agent.
 *
 * Templates are system-owned and listed globally. `seedDefaultTemplates()`
 * upserts the built-in catalog at API startup; user-cloned agents live in
 * the regular `agents` table with `source='db'` and `owner_id=<caller>`.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";

export type AgentTemplate = typeof schema.agentTemplates.$inferSelect;

export interface TemplateSeed {
  slug: string;
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  configJson: Record<string, unknown>;
  recommendedConnectors?: string[];
  recommendedSkills?: string[];
}

export async function listTemplates(): Promise<AgentTemplate[]> {
  return getDb()
    .select()
    .from(schema.agentTemplates)
    .orderBy(schema.agentTemplates.category, schema.agentTemplates.name);
}

export async function getTemplateBySlug(
  slug: string,
): Promise<AgentTemplate | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.agentTemplates)
    .where(eq(schema.agentTemplates.slug, slug))
    .limit(1);
  return row;
}

export interface CloneTemplateArgs {
  template: AgentTemplate;
  ownerId: string;
  /** Defaults to template.slug + '-' + short suffix to keep agents.name unique. */
  name?: string;
  /** Override description; defaults to template's. */
  description?: string;
}

/**
 * Clone a template into a new db-source agent owned by `ownerId`. Returns the
 * new agent row. Caller is responsible for trigger reload (the API route does
 * that after this returns).
 */
export async function cloneTemplate(args: CloneTemplateArgs) {
  const db = getDb();
  const baseName =
    args.name?.trim() ||
    `${args.template.slug}-${Math.random().toString(36).slice(2, 6)}`;

  const [agent] = await db
    .insert(schema.agents)
    .values({
      ownerId: args.ownerId,
      name: baseName,
      description: args.description ?? args.template.description,
      source: "db",
      systemPrompt: args.template.systemPrompt,
      configJson: args.template.configJson,
      enabled: true,
    })
    .returning();
  return agent;
}

/**
 * Upsert the built-in template catalog. Idempotent — re-running updates each
 * row's content (name/description/prompt/config) but preserves its id so
 * external references stay valid.
 */
export async function seedDefaultTemplates(): Promise<number> {
  const db = getDb();
  let count = 0;
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await getTemplateBySlug(t.slug);
    if (existing) {
      await db
        .update(schema.agentTemplates)
        .set({
          name: t.name,
          description: t.description,
          category: t.category,
          systemPrompt: t.systemPrompt,
          configJson: t.configJson,
          recommendedConnectors: t.recommendedConnectors ?? [],
          recommendedSkills: t.recommendedSkills ?? [],
        })
        .where(eq(schema.agentTemplates.slug, t.slug));
    } else {
      await db.insert(schema.agentTemplates).values({
        slug: t.slug,
        name: t.name,
        description: t.description,
        category: t.category,
        systemPrompt: t.systemPrompt,
        configJson: t.configJson,
        recommendedConnectors: t.recommendedConnectors ?? [],
        recommendedSkills: t.recommendedSkills ?? [],
      });
    }
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Built-in catalog
//
// Each entry mirrors what an agent.config.ts would export: a prompt fn (as a
// string the runner doesn't need to evaluate — db-source agents read from
// configJson directly), execution config, optional triggers.
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  {
    slug: "pr-review-lite",
    name: "Lightweight PR reviewer",
    description:
      "Read-only review of a single PR. Drafts a comment via propose_action; you approve before it posts.",
    category: "code",
    systemPrompt: [
      "You are a PR reviewer. For each PR you're asked to look at:",
      "1. Read the diff and surrounding context.",
      "2. Note bugs, security issues, or violations of the project's conventions.",
      "3. Stage your review via propose_action({kind: 'pr_comment', ...}).",
      "Do not call `gh pr comment` directly — staging through propose_action is the contract.",
    ].join("\n"),
    configJson: {
      prompt: "Review the PR specified in the trigger context. Use propose_action to draft your comment.",
      execution: {
        model: "claude-sonnet-4-6",
        maxTurns: 8,
        timeoutMs: 300_000,
        tools: ["Read", "Glob", "Grep", "Bash"],
      },
    },
    recommendedConnectors: ["github"],
  },
  {
    slug: "daily-digest",
    name: "Daily digest",
    description:
      "Once a day, write a one-paragraph summary of the previous day's runs across all agents. Logs to stdout (wire a notification channel to receive it elsewhere).",
    category: "ops",
    systemPrompt: [
      "You are a daily-digest agent. Every morning:",
      "1. Query the platform's API for runs from the last 24h (use /api/runs?since=...).",
      "2. Summarize successes, failures, and notable durations.",
      "3. Print the summary; the runner will capture it. Do not propose any side effects.",
    ].join("\n"),
    configJson: {
      prompt: "Write today's digest of agent activity.",
      execution: {
        model: "claude-haiku-4-5",
        maxTurns: 5,
        timeoutMs: 120_000,
        tools: ["Bash", "Read"],
        dryRun: true,
      },
      triggers: [{ type: "cron", schedule: "0 9 * * *" }],
    },
  },
  {
    slug: "jira-triage-lite",
    name: "Jira inbox triager",
    description:
      "Classifies recent Jira issues into priority labels. Drafts label changes via propose_action; you approve before they apply.",
    category: "support",
    systemPrompt: [
      "You are a Jira triage agent. For each unlabeled issue created in the last 24h:",
      "1. Read the issue summary + description.",
      "2. Decide a priority (P0/P1/P2/P3) and tag (bug/feature/question).",
      "3. Stage the label change via propose_action.",
    ].join("\n"),
    configJson: {
      prompt: "Triage the latest Jira issues. Use propose_action for any label change.",
      execution: {
        model: "claude-sonnet-4-6",
        maxTurns: 12,
        timeoutMs: 300_000,
        tools: ["Bash", "Read"],
      },
      triggers: [{ type: "cron", schedule: "0 8 * * *" }],
    },
    recommendedConnectors: ["jira"],
  },
];
