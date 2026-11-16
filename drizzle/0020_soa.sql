CREATE TABLE `soa_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`applicable` integer NOT NULL,
	`justification` text,
	`implementation` text,
	`locator` text,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `soa_entry_engagement` ON `soa_entry` (`engagement_id`,`requirement_id`);--> statement-breakpoint
ALTER TABLE `engagement_requirement` ADD `soa_decision` text;--> statement-breakpoint
ALTER TABLE `engagement_requirement` ADD `soa_note` text;