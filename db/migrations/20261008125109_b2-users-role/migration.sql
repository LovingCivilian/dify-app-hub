ALTER TABLE `users` ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL;--> statement-breakpoint
UPDATE `users` SET `role` = 'admin';--> statement-breakpoint
UPDATE `users` SET `role` = 'owner' ORDER BY `created_at`, `id` LIMIT 1;
