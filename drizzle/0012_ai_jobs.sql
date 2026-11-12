CREATE TABLE `ai_job` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`engagement_id` text,
	`user_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`context` text NOT NULL,
	`steps` text NOT NULL,
	`summary` text,
	`error` text,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_job_engagement_idx` ON `ai_job` (`engagement_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_job_user_idx` ON `ai_job` (`user_id`);