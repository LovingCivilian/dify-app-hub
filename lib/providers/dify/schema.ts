import * as z from 'zod'

import { APP_MODES } from './types/app'

/*
 * Dify's documents (Part 1 spec §2.2): the settings an app row holds for Dify, and its secrets, kept apart so the later
 * encryption touches only them (decision 8). zod parses both on every write and every read (decision 17; ADR-0025;
 * DV 8b). Client-safe on purpose (DV 9a): the admin form validates with the same schemas. `z.object` drops keys it does
 * not know (zod 4 "Objects": unknown keys are stripped by default), so a document written before a field was removed
 * reads cleanly.
 */

/**
 * The app's API base as Dify shows it, e.g. `https://host/v1`: an http(s) URL of at most 500 characters (today's
 * API base rule). zod 4's `z.url({ protocol })` checks the scheme only, so a Docker service name such as
 * `http://api:5001/v1` passes, which antd's `type: 'url'` would refuse.
 */
export const apiBaseSchema = z.url({ protocol: /^https?$/ }).max(500)

export const difySettingsSchema = z.object({
	apiBase: apiBaseSchema,
	/** The admin's choice (decision 18); Test connection compares it with the mode Dify reports. */
	appType: z.enum(APP_MODES),
	answerForm: z.object({ enabled: z.boolean(), feedbackText: z.string().max(255) }),
	enableUpdateAfterConversationStarts: z.boolean(),
	openingStatementDisplayMode: z.enum(['default', 'always']),
})

export type DifySettings = z.infer<typeof difySettingsSchema>

export const difySecretsSchema = z.object({ apiKey: z.string().trim().min(1).max(255) })

export type DifySecrets = z.infer<typeof difySecretsSchema>

/**
 * The secrets as an edit sends them (spec §2.3): a blank key keeps the stored one, so a blank or missing field reads as
 * "not given" (`undefined`) and the data layer merges the rest into the stored document (lib/providers/schemas.ts
 * `mergeSecrets`).
 */
export const difySecretsUpdateSchema = z.object({
	apiKey: z
		.string()
		.trim()
		.max(255)
		.optional()
		.transform(value => value || undefined),
})

/** What the form starts a new Dify app from: a chatbot, the switches off (today's form defaults). */
export const DIFY_DEFAULT_SETTINGS: z.input<typeof difySettingsSchema> = {
	apiBase: '',
	appType: 'chat',
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default',
}

/** The form's secret fields, blank: a new app's key is typed, an edit's blank key keeps the stored one. */
export const DIFY_DEFAULT_SECRETS: Record<keyof DifySecrets, string> = { apiKey: '' }
