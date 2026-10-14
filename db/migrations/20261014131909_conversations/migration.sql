CREATE TABLE "conversation_messages" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conversation_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"run_id" uuid,
	"message_id" text NOT NULL,
	"role" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_conversation_id_message_id_key" UNIQUE("conversation_id","message_id"),
	CONSTRAINT "conversation_messages_role_check" CHECK ("role" IN ('developer', 'system', 'assistant', 'user', 'tool', 'activity', 'reasoning')),
	CONSTRAINT "conversation_messages_status_check" CHECK ("status" IN ('streaming', 'complete', 'incomplete'))
);
--> statement-breakpoint
CREATE TABLE "conversation_runs" (
	"id" uuid PRIMARY KEY,
	"conversation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"outcome" jsonb,
	"resume" jsonb,
	"error" jsonb,
	"usage" jsonb,
	"custom" jsonb DEFAULT '[]' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "conversation_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'interrupted', 'cancelled', 'failed', 'truncated'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"state" jsonb DEFAULT '{}' NOT NULL,
	"active_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_id_seq_idx" ON "conversation_messages" ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "conversation_messages_run_id_idx" ON "conversation_messages" ("run_id");--> statement-breakpoint
CREATE INDEX "conversation_runs_conversation_id_started_at_idx" ON "conversation_runs" ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "conversations_user_id_app_id_updated_at_idx" ON "conversations" ("user_id","app_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_app_id_updated_at_idx" ON "conversations" ("app_id","updated_at");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_run_id_conversation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "conversation_runs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "conversation_runs" ADD CONSTRAINT "conversation_runs_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_app_id_apps_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;