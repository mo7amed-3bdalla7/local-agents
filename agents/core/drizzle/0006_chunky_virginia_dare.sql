CREATE TABLE "agent_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"system_prompt" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"recommended_connectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_templates_slug_unique" UNIQUE("slug")
);
