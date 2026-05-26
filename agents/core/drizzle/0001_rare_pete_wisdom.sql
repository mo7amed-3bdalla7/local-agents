ALTER TABLE "runs" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cache_creation_tokens" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cost_usd" numeric(12, 6);