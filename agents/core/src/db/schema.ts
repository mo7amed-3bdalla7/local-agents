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
  numeric,
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

export const pendingActionStatus = pgEnum("pending_action_status", [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
]);

export const notificationEvent = pgEnum("notification_event", [
  "run_succeeded",
  "run_failed",
  "approval_pending",
  "approval_failed",
]);

export const notificationDeliveryStatus = pgEnum(
  "notification_delivery_status",
  ["sent", "failed"],
);

// ---------------------------------------------------------------------------
// Users + auth sessions — slice-8 multi-tenancy
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  /** scrypt hash. Format: `scrypt:N:r:p:<saltBase64>:<hashBase64>`. */
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** sha256(token) hex — we never store the plaintext. */
    tokenHash: text("token_hash").notNull().unique(),
    /** First 8 chars after the `agt_` prefix, for UI display. Non-secret. */
    prefix: text("prefix").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index("api_tokens_owner_idx").on(t.ownerId),
  }),
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    /** Opaque session id — what lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("auth_sessions_user_idx").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Agents — both file-discovered and UI-created agents land here
// ---------------------------------------------------------------------------

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Owner — null for file-source agents (system-owned), set for db-source. */
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
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
    /** Captured from the SDK's final result message — null until populated. */
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    /** USD, 6 decimal places — small per-run amounts can compound to dollars. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
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
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
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
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
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
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
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
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
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

// ---------------------------------------------------------------------------
// Pending actions — human-in-the-loop approval queue
//
// Side-effecting actions an agent wants to take (post a comment, push a
// commit, send a Slack message, ...) land here in status='pending' until a
// human approves. The executor then dispatches per-kind and writes the
// result back. Generic by design so future action types just add a new
// `kind` + executor.
// ---------------------------------------------------------------------------

export const pendingActions = pgTable(
  "pending_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** Denormalized — null mirrors agents.ownerId (file-source agents). */
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** e.g. 'pr_comment' | 'slack_message' | 'shell_command'. */
    kind: text("kind").notNull(),
    /** Short label for the UI list ("Comment on PR #42"). */
    title: text("title").notNull(),
    /** Optional: why the agent wants to do this. */
    description: text("description"),
    /** Kind-specific payload — what the executor consumes. */
    payload: jsonb("payload").notNull(),
    status: pendingActionStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    /** Executor return value (comment id+url for pr_comment, etc.). */
    executorResult: jsonb("executor_result"),
    executorError: text("executor_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerStatusIdx: index("pending_actions_owner_status_idx").on(
      t.ownerId,
      t.status,
    ),
    sessionIdx: index("pending_actions_session_idx").on(t.sessionId),
  }),
);

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

// ---------------------------------------------------------------------------
// Notifications — per-user channels + subscriptions + delivery audit log
//
// Channels store *how* to send (webhook URL, slack hook, ...) per user.
// Subscriptions wire (event -> channel) for a user, so the same channel
// can receive multiple event types or be silenced for some. Deliveries
// is a small audit/debug log of attempts, with the error captured on
// failure.
// ---------------------------------------------------------------------------

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** e.g. 'console' | 'webhook' | 'slack' | 'email'. */
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    /** Non-secret config — URL, headers, channel name. Secrets live in keychain. */
    configJson: jsonb("config_json").notNull(),
    secretRef: text("secret_ref"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index("notification_channels_owner_idx").on(t.ownerId),
  }),
);

export const notificationSubscriptions = pgTable(
  "notification_subscriptions",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: notificationEvent("event").notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ownerId, t.event, t.channelId] }),
  }),
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    event: notificationEvent("event").notNull(),
    /** Stable reference to the originating row (e.g. {kind:'run',id:42}). */
    subjectRef: jsonb("subject_ref").notNull(),
    /** What the sender produced (slack message id, http status). */
    senderResult: jsonb("sender_result"),
    status: notificationDeliveryStatus("status").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    channelIdx: index("notification_deliveries_channel_idx").on(
      t.channelId,
      t.sentAt,
    ),
  }),
);
