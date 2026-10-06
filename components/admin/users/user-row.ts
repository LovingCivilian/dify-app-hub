/** One row of the user table (spec §6). Dates travel as ISO strings and are formatted in the browser. */
export interface UserRow {
	id: string
	name: string | null
	email: string
	createdAt: string
	updatedAt: string
}

export const toUserRows = (
	users: { id: string; name: string | null; email: string; createdAt: Date; updatedAt: Date }[],
): UserRow[] =>
	users.map(user => ({
		id: user.id,
		name: user.name,
		email: user.email,
		createdAt: user.createdAt.toISOString(),
		updatedAt: user.updatedAt.toISOString(),
	}))
