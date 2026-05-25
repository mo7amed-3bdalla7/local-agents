/**
 * Filesystem → DB skill sync.
 *
 * Walks two locations on each boot:
 *  - `<root>/.claude/skills/<name>/SKILL.md`   — shared skills
 *  - `<root>/agents/<agent>/.claude/skills/<name>/SKILL.md` — agent-scoped skills
 *
 * Each SKILL.md begins with a YAML frontmatter block:
 *
 *   ---
 *   name: my-skill
 *   description: One-line summary.
 *   version: 0.1.0
 *   ---
 *
 * Parsed via `gray-matter`. Rows are upserted into `skills`; agent-scoped
 * skills also gain an `agent_skills` link. Skills that disappear from disk
 * are flipped to `enabled=false` rather than deleted — agent_skills FK back
 * here, and keeping disabled rows preserves history.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import matter from "gray-matter";
import { eq, sql } from "drizzle-orm";
import { logger } from "@agents/sdk";
import { getDb, schema } from "@agents/core";

export interface SkillSyncResult {
  discovered: number;
  inserted: number;
  updated: number;
  disabled: number;
  links: number;
}

interface DiscoveredSkill {
  name: string;
  description: string;
  version: string | null;
  localPath: string;
  /** Agent name when discovered under agents/<name>/.claude/skills/, else null. */
  ownerAgent: string | null;
}

async function readSkillFrontmatter(
  skillDir: string,
): Promise<Omit<DiscoveredSkill, "ownerAgent"> | null> {
  const skillPath = resolve(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  try {
    const raw = await readFile(skillPath, "utf-8");
    const { data } = matter(raw);
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const description =
      typeof data.description === "string" ? data.description.trim() : "";
    if (!name || !description) {
      logger.warn("SKILL.md missing required frontmatter (name/description)", {
        path: skillPath,
      });
      return null;
    }
    const version = typeof data.version === "string" ? data.version : null;
    return { name, description, version, localPath: skillDir };
  } catch (err) {
    logger.warn("Failed to read SKILL.md", { path: skillPath, error: String(err) });
    return null;
  }
}

async function scanSkillsDir(
  parent: string,
  ownerAgent: string | null,
): Promise<DiscoveredSkill[]> {
  if (!existsSync(parent)) return [];
  const entries = await readdir(parent).catch(() => [] as string[]);
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    const skillDir = resolve(parent, entry);
    const s = await stat(skillDir).catch(() => null);
    if (!s?.isDirectory()) continue;
    const fm = await readSkillFrontmatter(skillDir);
    if (!fm) continue;
    out.push({ ...fm, ownerAgent });
  }
  return out;
}

/**
 * Walk all agent directories and scan each `<agent>/.claude/skills/`.
 * The agent dir is identified by containing a `package.json` (workspace package).
 */
async function scanAgentSkills(agentsRoot: string): Promise<DiscoveredSkill[]> {
  if (!existsSync(agentsRoot)) return [];
  const entries = await readdir(agentsRoot).catch(() => [] as string[]);
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    const agentDir = resolve(agentsRoot, entry);
    const s = await stat(agentDir).catch(() => null);
    if (!s?.isDirectory()) continue;
    const skillsDir = resolve(agentDir, ".claude", "skills");
    const skills = await scanSkillsDir(skillsDir, entry);
    out.push(...skills);
  }
  return out;
}

export async function syncSkills(workspaceRoot: string): Promise<SkillSyncResult> {
  const sharedDir = resolve(workspaceRoot, ".claude", "skills");
  const agentsRoot = resolve(workspaceRoot, "agents");

  const shared = await scanSkillsDir(sharedDir, null);
  const perAgent = await scanAgentSkills(agentsRoot);
  const discovered = [...shared, ...perAgent];

  const db = getDb();
  let inserted = 0;
  let updated = 0;
  let links = 0;
  const seen = new Set<string>();
  const byName = new Map<string, DiscoveredSkill>();
  for (const s of discovered) {
    if (byName.has(s.name)) {
      logger.warn("Duplicate skill name across paths — last wins", {
        name: s.name,
        previous: byName.get(s.name)!.localPath,
        next: s.localPath,
      });
    }
    byName.set(s.name, s);
  }

  for (const skill of byName.values()) {
    seen.add(skill.name);
    const payload = {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      source: `local:${skill.localPath}`,
      localPath: skill.localPath,
      enabled: true,
    };

    const existing = await db
      .select({ name: schema.skills.name })
      .from(schema.skills)
      .where(eq(schema.skills.name, skill.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(schema.skills).values(payload);
      inserted++;
    } else {
      await db
        .update(schema.skills)
        .set(payload)
        .where(eq(schema.skills.name, skill.name));
      updated++;
    }

    if (skill.ownerAgent) {
      const [agent] = await db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(eq(schema.agents.name, skill.ownerAgent))
        .limit(1);
      if (agent) {
        await db
          .insert(schema.agentSkills)
          .values({ agentId: agent.id, skillName: skill.name, enabled: true })
          .onConflictDoNothing();
        links++;
      } else {
        logger.warn("Per-agent skill references unknown agent", {
          skill: skill.name,
          agent: skill.ownerAgent,
        });
      }
    }
  }

  // Disable skills that disappeared from disk. Keep the row so agent_skills
  // FKs don't blow up — disabled rows hide from the UI's active list but
  // remain queryable from any history view.
  let disabled = 0;
  if (seen.size === 0) {
    const disabledRows = await db
      .update(schema.skills)
      .set({ enabled: false })
      .where(eq(schema.skills.enabled, true))
      .returning({ name: schema.skills.name });
    disabled = disabledRows.length;
  } else {
    const disabledRows = await db
      .update(schema.skills)
      .set({ enabled: false })
      .where(
        sql`${schema.skills.enabled} = true AND ${schema.skills.name} NOT IN (${sql.join(
          [...seen].map((n) => sql`${n}`),
          sql.raw(", "),
        )})`,
      )
      .returning({ name: schema.skills.name });
    disabled = disabledRows.length;
  }

  logger.info("Skill sync complete", {
    discovered: discovered.length,
    inserted,
    updated,
    disabled,
    links,
  });

  return {
    discovered: discovered.length,
    inserted,
    updated,
    disabled,
    links,
  };
}
