import * as z from 'zod'

import { userIdSchema } from '@/app/(admin)/user-management/schemas'
import { ACCESS_MODES } from '@/lib/app-access'
import type { IconChange } from '@/lib/data/apps'
import { idSchema } from '@/lib/ids'
import { PROVIDER_SCHEMAS } from '@/lib/providers/schemas'

/** Who may use the app (B3 spec §4.4): the grants count while restricted; group and account ids are UUIDs (ADR-0031). */
export const accessSchema = z.object({
	mode: z.enum(ACCESS_MODES),
	groupIds: z.array(idSchema).max(1000).default([]),
	userIds: z.array(userIdSchema).max(10_000).default([]),
})

/** Part 1 spec §2.1: the admin-owned fields' limits (ADR-0025: limits live in zod; the columns are `text`). */
export const APP_NAME_MAX = 255
export const APP_DESCRIPTION_MAX = 2000
export const APP_TAGS_MAX = 10
export const APP_TAG_MAX = 32

export const appNameSchema = z.string().trim().min(1).max(APP_NAME_MAX)
export const appDescriptionSchema = z.string().trim().max(APP_DESCRIPTION_MAX)
/** Each tag trimmed and 1–32 characters, duplicates removed, then at most 10 (spec §2.1; zod 4 `.transform().pipe()`). */
export const appTagsSchema = z
	.array(z.string().trim().min(1).max(APP_TAG_MAX))
	.transform(tags => [...new Set(tags)])
	.pipe(z.array(z.string()).max(APP_TAGS_MAX))

const commonFields = {
	name: appNameSchema,
	description: appDescriptionSchema,
	tags: appTagsSchema,
	enabled: z.boolean(),
	access: accessSchema,
}

/**
 * The form's values, a union keyed by provider (spec §4.3; DV 8b, zod `z.discriminatedUnion`): the shared fields and the
 * provider's documents, checked by that provider's schemas. A new app's secrets are required; an edit's may be blank,
 * which keeps the stored value (spec §2.3).
 */
export const createValuesSchema = z.discriminatedUnion('provider', [
	z.object({
		...commonFields,
		provider: z.literal('dify'),
		settings: PROVIDER_SCHEMAS.dify.settingsSchema,
		secrets: PROVIDER_SCHEMAS.dify.secretsSchema,
	}),
	z.object({
		...commonFields,
		provider: z.literal('agui'),
		settings: PROVIDER_SCHEMAS.agui.settingsSchema,
		secrets: PROVIDER_SCHEMAS.agui.secretsSchema,
	}),
])

export const updateValuesSchema = z.discriminatedUnion('provider', [
	z.object({
		...commonFields,
		provider: z.literal('dify'),
		settings: PROVIDER_SCHEMAS.dify.settingsSchema,
		secrets: PROVIDER_SCHEMAS.dify.secretsUpdateSchema,
	}),
	z.object({
		...commonFields,
		provider: z.literal('agui'),
		settings: PROVIDER_SCHEMAS.agui.settingsSchema,
		secrets: PROVIDER_SCHEMAS.agui.secretsUpdateSchema,
	}),
])

export const ICON_INTENTS = ['keep', 'replace', 'remove'] as const

/**
 * A JSON string decoded, then checked by the schema: zod 4.6.5 "Codecs", its `json(schema)` example (Plan decision h:
 * the form's nested values travel as one FormData field next to the icon file). The message is fixed: JSON.parse's own
 * quotes part of the body, which can hold the typed key.
 */
const jsonField = <T extends z.core.$ZodType>(schema: T) =>
	z.codec(z.string(), schema, {
		decode: (text, ctx) => {
			try {
				return JSON.parse(text)
			} catch {
				ctx.issues.push({
					code: 'invalid_format',
					format: 'json',
					input: text,
					message: 'Invalid JSON',
				})
				return z.NEVER
			}
		},
		encode: value => JSON.stringify(value),
	})

const iconFields = {
	iconIntent: z.enum(ICON_INTENTS),
	icon: z.instanceof(File).optional(),
}

/** A replacement needs its file (the branding form's rule; zod 4 names the message through `error`). */
const fileGiven = (form: { iconIntent: (typeof ICON_INTENTS)[number]; icon?: File }) =>
	form.iconIntent !== 'replace' || form.icon !== undefined
const fileRequired = { path: ['icon'], error: 'file_required' }

const iconChange = (intent: (typeof ICON_INTENTS)[number], file: File | undefined): IconChange =>
	intent === 'replace' && file
		? { intent, file }
		: intent === 'remove'
			? { intent }
			: { intent: 'keep' }

const commonOf = (values: {
	name: string
	description: string
	tags: string[]
	enabled: boolean
}) => ({
	name: values.name,
	description: values.description,
	tags: values.tags,
	enabled: values.enabled,
})

/**
 * The create form as FormData sends it (spec §4.3; Server Actions accept FormData with files, as the branding page's
 * save does): `values` (the JSON above), `iconIntent`, and `icon` when replaced; read into the data layer's
 * CreateAppInput.
 */
export const createAppFormSchema = z
	.object({ values: jsonField(createValuesSchema), ...iconFields })
	.refine(fileGiven, fileRequired)
	.transform(({ values, iconIntent, icon }) => ({
		provider: values.provider,
		common: commonOf(values),
		access: values.access,
		settings: values.settings,
		secrets: values.secrets,
		icon: iconChange(iconIntent, icon),
	}))

/** The edit form, read the same way; the action passes everything but the provider to updateApp (spec §2.3). */
export const updateAppFormSchema = z
	.object({ values: jsonField(updateValuesSchema), ...iconFields })
	.refine(fileGiven, fileRequired)
	.transform(({ values, iconIntent, icon }) => ({
		provider: values.provider,
		common: commonOf(values),
		access: values.access,
		settings: values.settings,
		secrets: values.secrets,
		icon: iconChange(iconIntent, icon),
	}))

/**
 * The save forms' field errors: an issue inside the JSON `values` field is keyed by its own path (`name`,
 * `settings.apiBase`, `secrets.apiKey`), so the drawer can mark the field (`z.flattenError` would key them all
 * `values`), and each carries its code only, as documentFieldErrors does: a zod message can echo the input.
 */
export const formFieldErrors = (error: z.ZodError): Record<string, string[]> => {
	const errors: Record<string, string[]> = {}
	for (const issue of error.issues) {
		const path =
			issue.path[0] === 'values' && issue.path.length > 1 ? issue.path.slice(1) : issue.path
		const key = path.map(String).join('.') || 'values'
		errors[key] = [...(errors[key] ?? []), issue.code]
	}
	return errors
}

/**
 * Test connection's input (spec §4.2): the provider, its settings and its secrets as the form holds them (a blank one is
 * read from the stored app on the server), and the app's id when it exists (Part 0 spec §3.2: a UUID).
 */
export const connectionTestSchema = z.discriminatedUnion('provider', [
	z.object({
		appId: idSchema.optional(),
		provider: z.literal('dify'),
		settings: PROVIDER_SCHEMAS.dify.settingsSchema,
		secrets: PROVIDER_SCHEMAS.dify.secretsUpdateSchema,
	}),
	z.object({
		appId: idSchema.optional(),
		provider: z.literal('agui'),
		settings: PROVIDER_SCHEMAS.agui.settingsSchema,
		secrets: PROVIDER_SCHEMAS.agui.secretsUpdateSchema,
	}),
])
