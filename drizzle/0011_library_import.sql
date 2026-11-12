CREATE TABLE `library_document` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`title` text,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`mime_type` text,
	`size` integer NOT NULL,
	`text_status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_document_text` (
	`document_id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`page_starts` text NOT NULL,
	`extracted_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `library_document`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `requirement_link` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `source` ADD `document_id` text;--> statement-breakpoint
ALTER TABLE `source` ADD `status` text DEFAULT 'active' NOT NULL;