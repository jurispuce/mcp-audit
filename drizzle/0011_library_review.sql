ALTER TABLE `requirement_link` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `source` ADD `status` text DEFAULT 'active' NOT NULL;