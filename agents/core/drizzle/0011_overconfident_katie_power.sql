CREATE TABLE "repo_contexts" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_contexts" ADD CONSTRAINT "repo_contexts_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;