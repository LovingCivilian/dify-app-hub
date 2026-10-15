import * as z from 'zod'

/*
 * AG-UI's documents (Part 2 spec §2.2): the settings an app row holds for an AG-UI agent, and its secret, kept apart as
 * Dify's are (decision 8). zod parses both on every write and every read (ADR-0025, ADR-0032). Client-safe on purpose:
 * the admin form validates with the same schemas. `z.object` drops keys it does not know (zod 4 "Objects": unknown keys
 * are stripped by default), so a document 2b or 2c writes with more fields still reads here, and the fields those
 * slices add carry zod defaults (zod 4 `.default()`), so a document written now reads there.
 */

/**
 * The full endpoint the hub POSTs a run to, e.g. `http://agents:8000/agents/assistant`: an http(s) URL of at most 500
 * characters, the rule of Dify's `apiBase` (zod 4 `z.url({ protocol })` checks the scheme only, so a Docker service name
 * passes).
 */
export const agentUrlSchema = z.url({ protocol: /^https?$/ }).max(500)

export const aguiSettingsSchema = z.object({
	agentUrl: agentUrlSchema,
	/** The JWT's `aud`; it must match the agent's AGENT_JWT_AUDIENCE (spec §2.3). */
	audience: z.string().trim().min(1).max(255),
	/**
	 * Spec §6.2: advertise the hub's `ask_user` tool in every run's `tools`. Off by default, because Pydantic AI fails a
	 * run whose agent already has a tool of that name (research `part2-hitl-state-files.md`, Implications A.2); a zod
	 * default, so a document 2a wrote reads with it off (zod 4 `.default()`: a missing key takes the default).
	 */
	askUser: z.boolean().default(false),
})

export type AguiSettings = z.infer<typeof aguiSettingsSchema>

/**
 * The key the hub signs each request's JWT with, shared with the agent (decision 45: at least 32 random bytes, e.g.
 * `openssl rand -base64 48`, which prints 64 characters). 32–512 characters after trimming, used as their UTF-8 bytes.
 */
export const aguiSecretsSchema = z.object({ jwtSecret: z.string().trim().min(32).max(512) })

export type AguiSecrets = z.infer<typeof aguiSecretsSchema>

/** The secret as an edit sends it (ADR-0032): blank or missing reads as "not given", which keeps the stored one. */
export const aguiSecretsUpdateSchema = z.object({
	jwtSecret: z
		.string()
		.trim()
		.max(512)
		.optional()
		.transform(value => value || undefined),
})

/** What the form starts a new AG-UI app from: both connection fields empty, for the admin to fill, and `ask_user` off. */
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
	askUser: false,
}

/** The form's secret field, blank: a new app's secret is typed, an edit's blank secret keeps the stored one. */
export const AGUI_DEFAULT_SECRETS: Record<keyof AguiSecrets, string> = { jwtSecret: '' }
