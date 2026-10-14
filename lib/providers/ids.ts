/**
 * The providers the hub knows (Part 1 spec §3; decision 24: a `text` column with a CHECK listing these ids, plus this
 * check in code): Dify, and AG-UI agents since Part 2 (spec §2.1). `db/schema/apps.ts` builds its CHECK from this list,
 * so a new id comes with a generated migration. Client-safe: the schema, the forms and both registries read it.
 */
export const PROVIDER_IDS = ['dify', 'agui'] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export const isProviderId = (value: unknown): value is ProviderId =>
	typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
