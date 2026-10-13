-- Part 1 spec §2.4: every Part 0 row becomes a Dify app. Its Dify columns become the settings document and its key the
-- secrets document, mapped as lib/data/apps.ts read them before this migration; the expand migration before this one
-- added the columns and the contract migration after it drops the old ones. A row without a known mode keeps
-- "appType": null, which the settings schema refuses: the admin sees "Invalid settings" and repairs it (spec §2.3). An
-- emoji icon stores no image, so it becomes no icon (decision 19); an image keeps its bytes and its type.
UPDATE "apps" SET
	"provider" = 'dify',
	"settings" = jsonb_build_object(
		'apiBase', "api_base",
		'appType', "mode",
		'answerForm', jsonb_build_object('enabled', "enable_answer_form", 'feedbackText', coalesce("answer_form_feedback_text", '')),
		'enableUpdateAfterConversationStarts', "enable_update_input_after_starts",
		'openingStatementDisplayMode', CASE WHEN "opening_statement_display_mode" = 'always' THEN 'always' ELSE 'default' END
	),
	"secrets" = jsonb_build_object('apiKey', "api_key"),
	"description" = coalesce("description", ''),
	"tags" = CASE WHEN jsonb_typeof("tags") = 'array' THEN "tags" ELSE '[]'::jsonb END;--> statement-breakpoint
UPDATE "apps" SET "icon_image" = NULL, "icon_mime" = NULL WHERE "icon_image" IS NULL OR "icon_mime" IS NULL;
