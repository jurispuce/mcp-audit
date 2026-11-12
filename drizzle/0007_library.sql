CREATE TABLE `criterion` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`requirement_id` text NOT NULL,
	`engagement_id` text,
	`text` text NOT NULL,
	`expected_evidence` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `criterion_requirement` ON `criterion` (`requirement_id`);--> statement-breakpoint
CREATE TABLE `guidance` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`requirement_id` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guidance_requirement` ON `guidance` (`requirement_id`);--> statement-breakpoint
CREATE TABLE `requirement` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`source_id` text NOT NULL,
	`ref_code` text NOT NULL,
	`title` text NOT NULL,
	`text` text,
	`language` text NOT NULL,
	`translation_of` text,
	`locator` text,
	`parent_id` text,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`quote` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_source_ref` ON `requirement` (`source_id`,`ref_code`);--> statement-breakpoint
CREATE INDEX `requirement_parent` ON `requirement` (`parent_id`);--> statement-breakpoint
CREATE INDEX `requirement_translation` ON `requirement` (`translation_of`);--> statement-breakpoint
CREATE TABLE `requirement_link` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`type` text NOT NULL,
	`coverage` text,
	`note` text,
	FOREIGN KEY (`from_id`) REFERENCES `requirement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `requirement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_link_from` ON `requirement_link` (`from_id`);--> statement-breakpoint
CREATE INDEX `requirement_link_to` ON `requirement_link` (`to_id`);--> statement-breakpoint
CREATE TABLE `source` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`edition` text,
	`language` text NOT NULL,
	`licence_note` text,
	`auditee_id` text,
	`artifact_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_code` ON `source` (`code`);