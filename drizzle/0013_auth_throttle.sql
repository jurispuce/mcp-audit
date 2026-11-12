CREATE TABLE `auth_throttle` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window_start` integer NOT NULL,
	`locked_until` integer
);
