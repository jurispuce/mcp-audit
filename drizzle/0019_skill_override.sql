CREATE TABLE `skill_override` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`skill_set` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`default_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skill_override_name` ON `skill_override` (`skill_set`,`name`);