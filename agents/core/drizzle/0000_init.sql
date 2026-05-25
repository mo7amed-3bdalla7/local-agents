CREATE TYPE "public"."agent_source" AS ENUM('file', 'db');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('stdio', 'http', 'sse');--> statement-breakpoint
CREATE TYPE "public"."pr_activity_kind" AS ENUM('issue_comment', 'review_comment', 'review_submitted', 'thread_reply', 'commit_pushed', 'branch_pushed');--> statement-breakpoint
CREATE TYPE "public"."pr_activity_status" AS ENUM('drafted', 'pending_approval', 'posted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'active', 'success', 'failure', 'timeout', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."session_event_kind" AS ENUM('message', 'tool_call', 'tool_result', 'mcp_call', 'skill_invoke', 'comment_posted', 'commit_pushed', 'error');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'completed', 'failed', 'aborted', 'timeout');--> statement-breakpoint
CREATE TABLE "agent_connectors" (
	"agent_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agent_connectors_agent_id_connector_id_pk" PRIMARY KEY("agent_id","connector_id")
);
--> statement-breakpoint
CREATE TABLE "agent_mcp_servers" (
	"agent_id" uuid NOT NULL,
	"mcp_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agent_mcp_servers_agent_id_mcp_id_pk" PRIMARY KEY("agent_id","mcp_id")
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"agent_id" uuid NOT NULL,
	"skill_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agent_skills_agent_id_skill_name_pk" PRIMARY KEY("agent_id","skill_name")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"source" "agent_source" NOT NULL,
	"system_prompt" text,
	"config_json" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_type" text NOT NULL,
	"display_name" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"secret_ref" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"transport" "mcp_transport" NOT NULL,
	"config_json" jsonb NOT NULL,
	"secret_ref" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"cached_tools_json" jsonb,
	"cached_tools_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_servers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "pr_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"repo_id" uuid NOT NULL,
	"pr_number" integer NOT NULL,
	"kind" "pr_activity_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"github_id" text,
	"github_url" text,
	"status" "pr_activity_status" DEFAULT 'drafted' NOT NULL,
	"posted_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_full_name" text NOT NULL,
	"local_path" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"test_command" text,
	"secret_ref" text,
	"auto_modes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repos_github_full_name_unique" UNIQUE("github_full_name")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"session_id" uuid,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"trigger_context" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"output" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"keychain_ref" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "session_event_kind" NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"sdk_session_id" text,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"trigger_context" jsonb NOT NULL,
	"summary_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"name" text PRIMARY KEY NOT NULL,
	"version" text,
	"source" text NOT NULL,
	"sha" text,
	"description" text NOT NULL,
	"local_path" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktrees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"branch" text NOT NULL,
	"path" text NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "worktrees_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "agent_connectors" ADD CONSTRAINT "agent_connectors_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connectors" ADD CONSTRAINT "agent_connectors_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_servers" ADD CONSTRAINT "agent_mcp_servers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_servers" ADD CONSTRAINT "agent_mcp_servers_mcp_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skill_name_skills_name_fk" FOREIGN KEY ("skill_name") REFERENCES "public"."skills"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_activity" ADD CONSTRAINT "pr_activity_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_activity" ADD CONSTRAINT "pr_activity_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pr_activity_repo_pr_idx" ON "pr_activity" USING btree ("repo_id","pr_number");--> statement-breakpoint
CREATE INDEX "pr_activity_session_idx" ON "pr_activity" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "runs_agent_status_idx" ON "runs" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "session_events_session_idx" ON "session_events" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "sessions_agent_idx" ON "sessions" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE INDEX "worktrees_repo_branch_idx" ON "worktrees" USING btree ("repo_id","branch");