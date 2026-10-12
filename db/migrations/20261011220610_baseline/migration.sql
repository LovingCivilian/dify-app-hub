CREATE TYPE "access_mode" AS ENUM('everyone', 'restricted');--> statement-breakpoint
CREATE TYPE "account_source" AS ENUM('local', 'ldap');--> statement-breakpoint
CREATE TYPE "membership_source" AS ENUM('manual', 'directory');--> statement-breakpoint
CREATE TYPE "sync_outcome" AS ENUM('running', 'succeeded', 'failed', 'empty', 'id_attribute_changed');--> statement-breakpoint
CREATE TYPE "sync_trigger" AS ENUM('schedule', 'startup', 'manual');--> statement-breakpoint
CREATE TYPE "user_role" AS ENUM('owner', 'admin', 'user');--> statement-breakpoint
CREATE TABLE "app_group_grants" (
	"app_id" uuid,
	"group_id" uuid,
	CONSTRAINT "app_group_grants_pkey" PRIMARY KEY("app_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "app_user_grants" (
	"app_id" uuid,
	"user_id" uuid,
	CONSTRAINT "app_user_grants_pkey" PRIMARY KEY("app_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "dify_apps" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"mode" text,
	"description" text,
	"tags" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"access_mode" "access_mode" DEFAULT 'restricted'::"access_mode" NOT NULL,
	"api_base" text NOT NULL,
	"api_key" text NOT NULL,
	"enable_answer_form" boolean DEFAULT false NOT NULL,
	"answer_form_feedback_text" text,
	"enable_update_input_after_starts" boolean DEFAULT false NOT NULL,
	"opening_statement_display_mode" text,
	"enable_annotation" boolean DEFAULT false NOT NULL,
	"icon_type" text,
	"icon" text,
	"icon_background" text,
	"icon_image" bytea,
	"icon_mime" text
);
--> statement-breakpoint
CREATE TABLE "directory_sync_runs" (
	"id" uuid PRIMARY KEY,
	"slot" text NOT NULL,
	"run_trigger" "sync_trigger" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" "sync_outcome" DEFAULT 'running'::"sync_outcome" NOT NULL,
	"entries_seen" integer DEFAULT 0 NOT NULL,
	"deactivated" integer DEFAULT 0 NOT NULL,
	"reactivated" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"group_errors" integer DEFAULT 0 NOT NULL,
	"memberships_added" integer DEFAULT 0 NOT NULL,
	"memberships_removed" integer DEFAULT 0 NOT NULL,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "instance_setting_files" (
	"area" text,
	"name" text,
	"bytes" bytea NOT NULL,
	"mime" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_setting_files_pkey" PRIMARY KEY("area","name")
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"area" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_group_directory_links" (
	"group_id" uuid,
	"directory_group_id" text,
	"directory_group_name" text NOT NULL,
	"missing_since" timestamp with time zone,
	CONSTRAINT "user_group_directory_links_pkey" PRIMARY KEY("group_id","directory_group_id")
);
--> statement-breakpoint
CREATE TABLE "user_group_members" (
	"group_id" uuid,
	"user_id" uuid,
	"source" "membership_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_members_pkey" PRIMARY KEY("group_id","user_id","source")
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY,
	"name" text,
	"email" text NOT NULL,
	"password" text,
	"role" "user_role" DEFAULT 'user'::"user_role" NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"admin_deactivated_at" timestamp with time zone,
	"admin_deactivated_by" uuid,
	"directory_deactivated_at" timestamp with time zone,
	"source" "account_source" DEFAULT 'local'::"account_source" NOT NULL,
	"directory_id" text,
	"directory_id_attribute" text,
	"directory_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_source_credentials" CHECK (("source" = 'local' AND "password" IS NOT NULL AND "directory_id" IS NULL) OR ("source" = 'ldap' AND "password" IS NULL AND "directory_id" IS NOT NULL AND "directory_id_attribute" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "app_group_grants_group_id_idx" ON "app_group_grants" ("group_id");--> statement-breakpoint
CREATE INDEX "app_user_grants_user_id_idx" ON "app_user_grants" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "directory_sync_runs_slot_key" ON "directory_sync_runs" ("slot");--> statement-breakpoint
CREATE INDEX "directory_sync_runs_started_at_idx" ON "directory_sync_runs" ("started_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "user_group_members_user_id_idx" ON "user_group_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_groups_name_key" ON "user_groups" (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_directory_id_key" ON "users" ("directory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_owner" ON "users" ("role") WHERE "role" = 'owner';--> statement-breakpoint
ALTER TABLE "app_group_grants" ADD CONSTRAINT "app_group_grants_app_id_dify_apps_id_fkey" FOREIGN KEY ("app_id") REFERENCES "dify_apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_group_grants" ADD CONSTRAINT "app_group_grants_group_id_user_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "user_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_user_grants" ADD CONSTRAINT "app_user_grants_app_id_dify_apps_id_fkey" FOREIGN KEY ("app_id") REFERENCES "dify_apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_user_grants" ADD CONSTRAINT "app_user_grants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "instance_setting_files" ADD CONSTRAINT "instance_setting_files_area_instance_settings_area_fkey" FOREIGN KEY ("area") REFERENCES "instance_settings"("area") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_group_directory_links" ADD CONSTRAINT "user_group_directory_links_group_id_user_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "user_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "user_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;