/**
 * Drizzle schema — every persistent table for the agent platform.
 *
 * Conventions:
 * - Entity IDs are UUIDs (`uuid().defaultRandom()`), generated server-side.
 * - High-frequency append-only tables use `bigserial` (runs, session_events).
 * - Timestamps are `timestamptz` with `defaultNow()`.
 * - Free-form/varying payloads are `jsonb`.
 * - Secrets never live here — only `secret_ref` pointers to the keychain.
 */

import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const agentSource = pgEnum("agent_source", ["file", "db"]);

export const sessionStatus = pgEnum("session_status", [
  "active",
  "completed",
  "failed",
  "aborted",
  "timeout",
]);

export const runStatus = pgEnum("run_status", [
  "pending",
  "active",
  "success",
  "failure",
  "timeout",
  "aborted",
]);

export const mcpTransport = pgEnum("mcp_transport", ["stdio", "http", "sse"]);

export const sessionEventKind = pgEnum("session_event_kind", [
  "message",
  "tool_call",
  "tool_result",
  "mcp_call",
  "skill_invoke",
  "comment_posted",
  "commit_pushed",
  "error",
]);

export const prActivityKind = pgEnum("pr_activity_kind", [
  "issue_comment",
  "review_comment",
  "review_submitted",
  "thread_reply",
  "commit_pushed",
  "branch_pushed",
]);

export const prActivityStatus = pgEnum("pr_activity_status", [
  "drafted",
  "pending_approval",
  "posted",
  "failed",
]);

// ---------------------------------------------------------------------------
// Agents — both file-discovered and UI-created agents land here
// ---------------------------------------------------------------------------

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  source: agentSource("source").notNull(),
  /** AGENTS.md body for db-source agents; null for file-source (loaded from disk). */
  systemPrompt: text("system_prompt"),
  /** Triggers, execution config, posting modes, etc. */
  configJson: jsonb("config_json").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Sessions — resumable conversation with the SDK
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** The SDK's session id, used for `query({ resume })`. */
    sdkSessionId: text("sdk_session_id"),
    status: sessionStatus("status").notNull().default("active"),
    triggerContext: jsonb("trigger_context").notNull(),
    /** Structured summary written at end-of-run (counts, blocked-on-human, etc.). */
    summaryJson: jsonb("summary_json"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    agentIdx: index("sessions_agent_idx").on(t.agentId, t.startedAt),
  }),
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    kind: sessionEventKind("kind").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => ({
    sessionIdx: index("session_events_session_idx").on(t.sessionId, t.id),
  }),
);

// ---------------------------------------------------------------------------
// Runs — durable queue. A run becomes a session when it starts executing.
// ---------------------------------------------------------------------------

export const runs = pgTable(
  "runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    status: runStatus("status").notNull().default("pending"),
    triggerContext: jsonb("trigger_context").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    output: text("output"),
    error: text("error"),
  },
  (t) => ({
    agentStatusIdx: index("runs_agent_status_idx").on(t.agentId, t.status),
    createdIdx: index("runs_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Connectors (Jira, GitHub, Slack, ...) — first-party integrations
// ---------------------------------------------------------------------------

export const connectors = pgTable("connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Connector module id: 'jira' | 'github' | 'slack' | 'whatsapp' | ... */
  connectorType: text("connector_type").notNull(),
  displayName: text("display_name").notNull(),
  /** Per-instance config (host URL, account, etc.) — never secrets. */
  configJson: jsonb("config_json").notNull(),
  /** Points to a secrets row; secret value lives in OS keychain. */
  secretRef: text("secret_ref"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentConnectors = pgTable(
  "agent_connectors",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.connectorId] }),
  }),
);

// ---------------------------------------------------------------------------
// Skills — folders with SKILL.md, indexed for the UI
// ---------------------------------------------------------------------------

export const skills = pgTable("skills", {
  /** Unique skill name from SKILL.md frontmatter. Also the folder name. */
  name: text("name").primaryKey(),
  version: text("version"),
  /** 'git:<url>' | 'local:<path>' | 'builtin'. */
  source: text("source").notNull(),
  /** Source SHA when imported from git, for reproducibility. */
  sha: text("sha"),
  description: text("description").notNull(),
  /** Absolute on-disk path where the skill folder lives. */
  localPath: text("local_path").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentSkills = pgTable(
  "agent_skills",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillName: text("skill_name")
      .notNull()
      .references(() => skills.name, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.skillName] }),
  }),
);

// ---------------------------------------------------------------------------
// MCP servers — third-party tool providers, stdio/http/sse transports
// ---------------------------------------------------------------------------

export const mcpServers = pgTable("mcp_servers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  transport: mcpTransport("transport").notNull(),
  /** stdio: { command, args, env } | http/sse: { url, headers }. Env values can be {ref: secretId}. */
  configJson: jsonb("config_json").notNull(),
  secretRef: text("secret_ref"),
  enabled: boolean("enabled").notNull().default(true),
  /** Cached tools/list response — refreshed on each "test" click. */
  cachedToolsJson: jsonb("cached_tools_json"),
  cachedToolsFetchedAt: timestamp("cached_tools_fetched_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentMcpServers = pgTable(
  "agent_mcp_servers",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    mcpId: uuid("mcp_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.mcpId] }),
  }),
);

// ---------------------------------------------------------------------------
// Repos + worktrees — shared workspace manager
// ---------------------------------------------------------------------------

export const repos = pgTable("repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubFullName: text("github_full_name").notNull().unique(),
  localPath: text("local_path").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  /** Explicit test command, e.g. "pnpm test" or "make test". No inference. */
  testCommand: text("test_command"),
  /** PAT for this repo. */
  secretRef: text("secret_ref"),
  /**
   * Per-repo auto-mode opt-ins. Agent-level defaults can only enable draft/review;
   * `auto` modes require a flag here.
   * e.g. { outgoingReview: "auto", incomingFixes: "auto-fixes" }
   */
  autoModes: jsonb("auto_modes").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const worktrees = pgTable(
  "worktrees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    path: text("path").notNull().unique(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    repoBranchIdx: index("worktrees_repo_branch_idx").on(t.repoId, t.branch),
  }),
);

// ---------------------------------------------------------------------------
// Secrets — pointers to OS keychain entries
// ---------------------------------------------------------------------------

export const secrets = pgTable("secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Logical key, e.g. 'github-pat:owner/repo' or 'jira-token:my-cloud'. */
  key: text("key").notNull().unique(),
  /** Backend pointer: 'keytar:<service>:<account>' or 'age:<filepath>'. */
  keychainRef: text("keychain_ref").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// PR activity — unified audit log for posted comments and pushed commits
// ---------------------------------------------------------------------------

export const prActivity = pgTable(
  "pr_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    kind: prActivityKind("kind").notNull(),
    /** Body, classification, target line, etc. — kind-specific. */
    payload: jsonb("payload").notNull(),
    /** GitHub object id once posted (issue comment id, review id, commit sha, ...). */
    githubId: text("github_id"),
    githubUrl: text("github_url"),
    status: prActivityStatus("status").notNull().default("drafted"),
    /** Commit SHA for kind='commit_pushed'. */
    postedSha: text("posted_sha"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => ({
    repoPrIdx: index("pr_activity_repo_pr_idx").on(t.repoId, t.prNumber),
    sessionIdx: index("pr_activity_session_idx").on(t.sessionId),
  }),
);
