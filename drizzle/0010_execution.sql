CREATE TABLE `evidence_link` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`evidence_item_id` text NOT NULL,
	`locator` text,
	`excerpt` text,
	`sufficiency` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_item_id`) REFERENCES `evidence_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_link_artifact` ON `evidence_link` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `evidence_link_item` ON `evidence_link` (`evidence_item_id`);--> statement-breakpoint
CREATE INDEX `evidence_link_engagement` ON `evidence_link` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `finding` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`assessment_unit_id` text NOT NULL,
	`finding_value_id` text,
	`rationale` text,
	`evidence_item_ids` text DEFAULT '[]' NOT NULL,
	`confidence` text,
	`status` text NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`approved_version` integer,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessment_unit_id`) REFERENCES `assessment_unit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finding_value_id`) REFERENCES `finding_value`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finding_engagement` ON `finding` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `finding_unit` ON `finding` (`assessment_unit_id`);--> statement-breakpoint
CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`text` text NOT NULL,
	`mentions` text DEFAULT '[]' NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `note_event` ON `note` (`event_id`);--> statement-breakpoint
CREATE INDEX `note_engagement` ON `note` (`engagement_id`);