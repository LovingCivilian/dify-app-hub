/** The `searchParams` a Next page receives (page.md): a Promise of string | string[] | undefined per key. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** The first value of a query key, or undefined when it is missing or empty. */
export const firstParam = (value: string | string[] | undefined): string | undefined => {
	const first = Array.isArray(value) ? value[0] : value
	return first ? first : undefined
}
