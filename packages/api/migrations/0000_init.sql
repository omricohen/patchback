CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"trust_tier" text NOT NULL,
	"submitter" jsonb,
	"capture" jsonb,
	"triage" jsonb,
	"thread_id" text,
	"in_reply_to" text,
	"read_token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "feedback_trust_tier_check" CHECK ("feedback"."trust_tier" in ('owner', 'insider', 'outsider'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"state" text NOT NULL,
	"history" jsonb NOT NULL,
	"issue_number" integer,
	"branch_name" text,
	"pr_number" integer,
	"pr_url" text,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "jobs_state_check" CHECK ("jobs"."state" in (
        'feedback.received', 'feedback.triaged', 'feedback.needs_clarification',
        'issue.created', 'patch.queued', 'patch.running', 'patch.failed',
        'patch.generated', 'pr.opened', 'pr.reviewed', 'patch.shipped',
        'feedback.closed'
      ))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_thread_id_idx" ON "feedback" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "jobs_feedback_id_idx" ON "jobs" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "jobs_pr_number_idx" ON "jobs" USING btree ("pr_number");