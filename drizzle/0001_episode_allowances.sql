CREATE TABLE `episode_allowance_holds` (
	`episode_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount_microusd` integer NOT NULL,
	CONSTRAINT "episode_allowance_nonnegative" CHECK("episode_allowance_holds"."amount_microusd" >= 0)
);
--> statement-breakpoint
CREATE INDEX `episode_allowance_user` ON `episode_allowance_holds` (`user_id`);--> statement-breakpoint
CREATE TABLE `episode_scheduler_health` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_tick` integer NOT NULL,
	`last_finished` integer,
	`lease_token` text,
	`lease_until` integer,
	CONSTRAINT "episode_scheduler_singleton" CHECK("episode_scheduler_health"."id" = 1)
);
