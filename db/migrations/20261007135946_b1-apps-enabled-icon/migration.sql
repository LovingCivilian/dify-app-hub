UPDATE `dify_apps` SET `is_enabled` = CASE WHEN `is_enabled` IN (0, 2) THEN 0 ELSE 1 END;--> statement-breakpoint
ALTER TABLE `dify_apps` MODIFY COLUMN `is_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_type` varchar(16);--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_background` varchar(32);--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_image` mediumblob;--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_mime` varchar(64);