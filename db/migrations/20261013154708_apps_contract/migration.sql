ALTER TABLE "apps" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "api_base";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "api_key";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "enable_answer_form";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "answer_form_feedback_text";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "enable_update_input_after_starts";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "opening_statement_display_mode";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "enable_annotation";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "icon_type";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "icon";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "icon_background";--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "description" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "tags" SET DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "tags" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "settings" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "secrets" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_provider_check" CHECK ("provider" IN ('dify'));--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_icon_check" CHECK (("icon_image" IS NULL) = ("icon_mime" IS NULL));