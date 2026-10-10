CREATE TABLE `directory_sync_runs` (
	`id` varchar(36) PRIMARY KEY,
	`slot` varchar(64) NOT NULL,
	`run_trigger` enum('schedule','startup','manual') NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`outcome` enum('running','succeeded','failed','empty','id_attribute_changed') NOT NULL DEFAULT 'running',
	`entries_seen` int NOT NULL DEFAULT 0,
	`deactivated` int NOT NULL DEFAULT 0,
	`reactivated` int NOT NULL DEFAULT 0,
	`updated` int NOT NULL DEFAULT 0,
	`conflicts` int NOT NULL DEFAULT 0,
	`group_errors` int NOT NULL DEFAULT 0,
	`memberships_added` int NOT NULL DEFAULT 0,
	`memberships_removed` int NOT NULL DEFAULT 0,
	`error_code` varchar(64),
	CONSTRAINT `directory_sync_runs_slot_key` UNIQUE INDEX(`slot`)
);
--> statement-breakpoint
CREATE TABLE `user_group_directory_links` (
	`group_id` varchar(36) NOT NULL,
	`directory_group_id` varchar(64) NOT NULL,
	`directory_group_name` varchar(255) NOT NULL,
	`missing_since` datetime(3),
	CONSTRAINT PRIMARY KEY(`group_id`,`directory_group_id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `password` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `source` enum('local','ldap') DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `directory_id` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `directory_id_attribute` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `directory_username` varchar(255);--> statement-breakpoint
CREATE INDEX `directory_sync_runs_started_at_idx` ON `directory_sync_runs` (`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_directory_id_key` ON `users` (`directory_id`);--> statement-breakpoint
ALTER TABLE `user_group_directory_links` ADD CONSTRAINT `user_group_directory_links_group_id_user_groups_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_source_credentials` CHECK ((`users`.`source` = 'local' AND `users`.`password` IS NOT NULL AND `users`.`directory_id` IS NULL) OR (`users`.`source` = 'ldap' AND `users`.`password` IS NULL AND `users`.`directory_id` IS NOT NULL));