CREATE TABLE `app_group_grants` (
	`app_id` varchar(36) NOT NULL,
	`group_id` varchar(36) NOT NULL,
	CONSTRAINT PRIMARY KEY(`app_id`,`group_id`)
);
--> statement-breakpoint
CREATE TABLE `app_user_grants` (
	`app_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	CONSTRAINT PRIMARY KEY(`app_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user_group_members` (
	`group_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`source` enum('manual','directory') NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT PRIMARY KEY(`group_id`,`user_id`,`source`)
);
--> statement-breakpoint
CREATE TABLE `user_groups` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`description` text,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `user_groups_name_key` UNIQUE INDEX(`name`)
);
--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `access_mode` enum('everyone','restricted') DEFAULT 'restricted' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `admin_deactivated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `admin_deactivated_by` varchar(36);--> statement-breakpoint
ALTER TABLE `users` ADD `directory_deactivated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `app_group_grants` ADD CONSTRAINT `app_group_grants_app_id_dify_apps_id_fkey` FOREIGN KEY (`app_id`) REFERENCES `dify_apps`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `app_group_grants` ADD CONSTRAINT `app_group_grants_group_id_user_groups_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `app_user_grants` ADD CONSTRAINT `app_user_grants_app_id_dify_apps_id_fkey` FOREIGN KEY (`app_id`) REFERENCES `dify_apps`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `app_user_grants` ADD CONSTRAINT `app_user_grants_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group_members` ADD CONSTRAINT `user_group_members_group_id_user_groups_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group_members` ADD CONSTRAINT `user_group_members_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;