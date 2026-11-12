CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`title` text NOT NULL,
	`format` text NOT NULL,
	`date` text,
	`start_time` text,
	`duration_min` integer DEFAULT 60 NOT NULL,
	`participant_ids` text DEFAULT '[]' NOT NULL,
	`participants_note` text,
	`requirement_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`proposed` integer DEFAULT 0 NOT NULL,
	`location` text,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_engagement` ON `event` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `evidence_item` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`event_id` text NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`criticality` text NOT NULL,
	`requirement_ids` text DEFAULT '[]' NOT NULL,
	`scope_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`promised_by` text,
	`promised_due` text,
	`proposed` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_item_engagement` ON `evidence_item` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `evidence_item_event` ON `evidence_item` (`event_id`);