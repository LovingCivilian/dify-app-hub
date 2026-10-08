ALTER TABLE `users` ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL;
