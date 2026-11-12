CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`body` text NOT NULL,
	`author_user` text NOT NULL,
	`author_agent` text,
	`channel` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_user`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comment_entity` ON `comment` (`entity_type`,`entity_id`,`created_at`);