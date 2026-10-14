ALTER TABLE "dify_apps" RENAME TO "apps";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "secrets" jsonb;