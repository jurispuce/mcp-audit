CREATE TABLE `revision` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`author_user` text NOT NULL,
	`author_agent` text,
	`channel` text NOT NULL,
	`note` text,
	`reverted_from` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_entity_version` ON `revision` (`entity_type`,`entity_id`,`version`);--> statement-breakpoint
CREATE INDEX `revision_author` ON `revision` (`author_user`);