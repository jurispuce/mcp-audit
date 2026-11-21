CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`synced` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credential` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkey_user` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenge` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`user_id` text,
	`challenge` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user` ADD `passkeys` integer DEFAULT 0 NOT NULL;