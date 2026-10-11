CREATE TABLE `instance_setting_files` (
	`area` varchar(32) NOT NULL,
	`name` varchar(32) NOT NULL,
	`bytes` mediumblob NOT NULL,
	`mime` varchar(64) NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT PRIMARY KEY(`area`,`name`)
);
--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`area` varchar(32) PRIMARY KEY,
	`data` json NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_by` varchar(36)
);
--> statement-breakpoint
ALTER TABLE `instance_setting_files` ADD CONSTRAINT `instance_setting_files_area_instance_settings_area_fkey` FOREIGN KEY (`area`) REFERENCES `instance_settings`(`area`) ON DELETE CASCADE;