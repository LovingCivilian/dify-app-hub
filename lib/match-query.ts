/**
 * The search boxes of the app list and the admin tables (spec §4.4): true when any field contains the query,
 * case-insensitive, surrounding spaces ignored; an empty query lets everything through.
 */
export const matchesQuery = (
	fields: ReadonlyArray<string | null | undefined>,
	query: string,
): boolean => {
	const needle = query.trim().toLocaleLowerCase()
	if (!needle) return true
	return fields.some(field => field?.toLocaleLowerCase().includes(needle))
}
