CREATE TYPE "public"."pending_action_status" AS ENUM('pending', 'approved', 'rejected', 'executed', 'failed');--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"agent_id" uuid NOT NULL,
	"owner_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"payload" jsonb NOT NULL,
	"status" "pending_action_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"executor_result" jsonb,
	"executor_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_actions_owner_status_idx" ON "pending_actions" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "pending_actions_session_idx" ON "pending_actions" USING btree ("session_id");