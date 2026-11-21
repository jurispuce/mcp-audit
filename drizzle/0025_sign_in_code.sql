CREATE TABLE `sign_in_code` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`link_hash` text NOT NULL,
	`next` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
