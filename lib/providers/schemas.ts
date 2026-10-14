import type * as z from 'zod'

import {
	AGUI_DEFAULT_SECRETS,
	AGUI_DEFAULT_SETTINGS,
	aguiSecretsSchema,
	aguiSecretsUpdateSchema,
	aguiSettingsSchema,
} from './agui/schema'
import {
	DIFY_DEFAULT_SECRETS,
	DIFY_DEFAULT_SETTINGS,
	difySecretsSchema,
	difySecretsUpdateSchema,
	difySettingsSchema,
} from './dify/schema'
import { isProviderId, type ProviderId } from './ids'

/*
 * The client-safe half of the provider registry (Part 1 spec §3; Plan decision d): each provider's document schemas, the
 * edit form of its secrets and the form's defaults for both documents. The admin form validates with them (DV 9a) and the data layer parses
 * every write and read with them (decision 17); lib/providers/registry.ts adds the server-only half. `satisfies` keeps
 * the map exhaustive over ProviderId (DV 11): a provider added to PROVIDER_IDS without schemas fails tsc here.
 */
export const PROVIDER_SCHEMAS = {
	dify: {
		settingsSchema: difySettingsSchema,
		secretsSchema: difySecretsSchema,
		secretsUpdateSchema: difySecretsUpdateSchema,
		defaultSettings: DIFY_DEFAULT_SETTINGS,
		defaultSecrets: DIFY_DEFAULT_SECRETS,
	},
	agui: {
		settingsSchema: aguiSettingsSchema,
		secretsSchema: aguiSecretsSchema,
		secretsUpdateSchema: aguiSecretsUpdateSchema,
		defaultSettings: AGUI_DEFAULT_SETTINGS,
		defaultSecrets: AGUI_DEFAULT_SECRETS,
	},
} satisfies Record<
	ProviderId,
	{
		settingsSchema: z.ZodType
		secretsSchema: z.ZodType
		secretsUpdateSchema: z.ZodType
		defaultSettings: unknown
		defaultSecrets: Record<string, string>
	}
>

export type ProviderSettings<P extends ProviderId> = z.infer<
	(typeof PROVIDER_SCHEMAS)[P]['settingsSchema']
>
export type ProviderSecrets<P extends ProviderId> = z.infer<
	(typeof PROVIDER_SCHEMAS)[P]['secretsSchema']
>

/**
 * An app's settings once its provider's schema has read them: the only typed form of `settings`. A union keyed by
 * provider, written as a mapped type indexed by a type parameter that defaults to every provider: the pattern of the
 * TypeScript 4.6 release notes' "Indexed Access Inference Improvements" (`UnionRecord`, `processRecord`; "indexed access
 * types which immediately index into a mapped object type", microsoft/TypeScript#47109). Inside a function generic over
 * P, one provider's settings then go with that provider's schema or registry entry without a cast (`record.f(record.v)`
 * in the example), whatever the number of providers.
 */
export type StoredSettings<P extends ProviderId = ProviderId> = {
	[K in P]: { provider: K; settings: ProviderSettings<K> }
}[P]

/** An app's documents once its provider's schemas have read them: the only typed form of `settings` and `secrets`. */
export type StoredDocuments<P extends ProviderId = ProviderId> = {
	[K in P]: { provider: K; settings: ProviderSettings<K>; secrets: ProviderSecrets<K> }
}[P]

/** The two document schemas of each provider, through the mapped type the generic reads below index (see StoredSettings). */
const DOCUMENT_SCHEMAS: {
	[P in ProviderId]: {
		settingsSchema: z.ZodType<ProviderSettings<P>>
		secretsSchema: z.ZodType<ProviderSecrets<P>>
	}
} = PROVIDER_SCHEMAS

/** A provider's secrets schema, typed by its id (the edit's merge is parsed with it: spec §2.3). */
export const secretsSchemaOf = <P extends ProviderId>(provider: P): z.ZodType<ProviderSecrets<P>> =>
	DOCUMENT_SCHEMAS[provider].secretsSchema

const parseSettings = <P extends ProviderId>(
	provider: P,
	settings: unknown,
): StoredSettings<P> | null => {
	const parsed = DOCUMENT_SCHEMAS[provider].settingsSchema.safeParse(settings)
	return parsed.success ? { provider, settings: parsed.data } : null
}

const parseSecrets = <P extends ProviderId>(
	documents: StoredSettings<P>,
	secrets: unknown,
): StoredDocuments<P> | null => {
	const parsed = DOCUMENT_SCHEMAS[documents.provider].secretsSchema.safeParse(secrets)
	return parsed.success ? { ...documents, secrets: parsed.data } : null
}

export type SettingsCheck =
	| { ok: true; documents: StoredSettings }
	| { ok: false; code: 'unknown_provider' | 'invalid_settings' }

export type DocumentsCheck =
	| { ok: true; documents: StoredDocuments }
	| { ok: false; code: 'unknown_provider' | 'invalid_settings' | 'invalid_secrets' }

/**
 * Reads a row's settings with its provider's schema (spec §2.3; DV 8b: zod `safeParse`). An unknown provider fails closed
 * (DV 11); a document that fails is reported, never returned half-typed. The jsonb columns are `unknown` in Drizzle
 * (DV 8a), so this is where they become typed. The reads that build a user's DTO stop here: they never select the
 * secrets (Plan decision ab).
 */
export const checkSettings = (provider: string, settings: unknown): SettingsCheck => {
	if (!isProviderId(provider)) return { ok: false, code: 'unknown_provider' }
	const documents = parseSettings(provider, settings)
	return documents ? { ok: true, documents } : { ok: false, code: 'invalid_settings' }
}

/** Both documents, as a provider route and the admin writes need them (spec §2.3); the secrets are read after the settings. */
export const checkDocuments = (
	provider: string,
	settings: unknown,
	secrets: unknown,
): DocumentsCheck => {
	const checked = checkSettings(provider, settings)
	if (!checked.ok) return checked
	const documents = parseSecrets(checked.documents, secrets)
	return documents ? { ok: true, documents } : { ok: false, code: 'invalid_secrets' }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Spec §2.3, write-only secrets: the stored document with the fields the edit gives laid over it; a field the edit
 * leaves `undefined` (a blank form field) keeps its stored value. The result is parsed by the provider's secrets schema
 * before it is stored or used.
 */
export const mergeSecrets = (
	stored: unknown,
	update: Record<string, string | undefined>,
): Record<string, unknown> => ({
	...(isRecord(stored) ? stored : {}),
	...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
})

/**
 * A document's zod refusal as an action's field errors (charter §4.5: keyed by field path), under the document's name:
 * `secrets.apiKey: ['too_small']`. The codes are zod's issue codes; the form maps a field with an error to its own text.
 */
export const documentFieldErrors = (
	document: 'settings' | 'secrets',
	error: z.ZodError,
): Record<string, string[]> =>
	Object.fromEntries(
		error.issues.map(issue => [[document, ...issue.path.map(String)].join('.'), [issue.code]]),
	)
