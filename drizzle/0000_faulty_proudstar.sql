CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`active_user_id` text,
	`status` text NOT NULL,
	`job_json` text NOT NULL,
	`lock_token` text,
	`lock_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_one_active_per_user` ON `episodes` (`active_user_id`);