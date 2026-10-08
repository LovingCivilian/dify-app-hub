-- Data statements live in their own migration, apart from the ALTER (Drizzle custom migrations):
-- the ALTER commits implicitly, so a crash after it must re-run only these idempotent updates.
UPDATE `users` SET `role` = 'admin';--> statement-breakpoint
UPDATE `users` SET `role` = 'owner' ORDER BY `created_at`, `id` LIMIT 1;
