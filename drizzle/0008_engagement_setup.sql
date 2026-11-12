CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`kind` text,
	`file_hash` text,
	`filename` text,
	`mime_type` text,
	`size` integer,
	`title` text,
	`version_label` text,
	`approval_date` text,
	`language` text,
	`origin` text NOT NULL,
	`state` text NOT NULL,
	`received_from` text,
	`received_at` integer,
	`event_id` text,
	`text_status` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `artifact_engagement` ON `artifact` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `artifact_hash` ON `artifact` (`file_hash`);--> statement-breakpoint
CREATE TABLE `artifact_text` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`page_starts` text NOT NULL,
	`extracted_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `assessment_unit` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`engagement_requirement_id` text NOT NULL,
	`scope_id` text,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`engagement_requirement_id`) REFERENCES `engagement_requirement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assessment_unit_engagement` ON `assessment_unit` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `auditee` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `engagement` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`auditee_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`description` text,
	`status` text NOT NULL,
	`scope_mode` text NOT NULL,
	`finding_scale_id` text,
	`working_language` text NOT NULL,
	`report_language` text NOT NULL,
	`carry_over_internal` integer DEFAULT false NOT NULL,
	`ai_allowed` integer DEFAULT true NOT NULL,
	`llm_profile` text,
	`plan_status` text NOT NULL,
	`plan_status_at` integer,
	FOREIGN KEY (`auditee_id`) REFERENCES `auditee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engagement_auditee` ON `engagement` (`auditee_id`);--> statement-breakpoint
CREATE TABLE `engagement_member` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engagement_member_engagement` ON `engagement_member` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `engagement_requirement` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`pinned_version` integer NOT NULL,
	`scope_handling` text NOT NULL,
	`criticality` text,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engagement_requirement_engagement` ON `engagement_requirement` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `finding_scale` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text,
	`name` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finding_value` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`finding_scale_id` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`tone` text NOT NULL,
	`is_nonconformity` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`finding_scale_id`) REFERENCES `finding_scale`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `finding_value_scale` ON `finding_value` (`finding_scale_id`);--> statement-breakpoint
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`auditee_id` text NOT NULL,
	`role` text NOT NULL,
	`name` text,
	`email` text,
	`unit` text,
	`responsibilities` text DEFAULT '[]' NOT NULL,
	`source_document` text,
	`source_section` text,
	`status` text NOT NULL,
	FOREIGN KEY (`auditee_id`) REFERENCES `auditee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `person_auditee` ON `person` (`auditee_id`);--> statement-breakpoint
CREATE TABLE `risk` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`origin` text NOT NULL,
	`level` text NOT NULL,
	`requirement_ids` text DEFAULT '[]' NOT NULL,
	`scope_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `risk_engagement` ON `risk` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `scope` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`engagement_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scope_engagement` ON `scope` (`engagement_id`);--> statement-breakpoint
ALTER TABLE `source` ADD `engagement_id` text;