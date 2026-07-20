ALTER TABLE "jobs" ADD COLUMN "user_summary" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "preview_url" text;--> statement-breakpoint
CREATE INDEX "jobs_branch_name_idx" ON "jobs" USING btree ("branch_name");