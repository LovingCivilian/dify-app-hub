/**
 * The providers the hub knows (Part 1 spec §3; decision 24: a `text` column with a CHECK listing these ids, plus this
 * check in code). Part 2 adds `'agui'` here and to the CHECK in `db/schema/apps.ts`. Client-safe: the schema, the forms
 * and both registries read it.
 */
export const PROVIDER_IDS = ['dify'] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export const isProviderId = (value: unknown): value is ProviderId =>
	typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
