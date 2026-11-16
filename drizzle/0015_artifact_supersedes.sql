ALTER TABLE `artifact` ADD `supersedes_id` text;--> statement-breakpoint
CREATE INDEX `artifact_supersedes` ON `artifact` (`supersedes_id`);