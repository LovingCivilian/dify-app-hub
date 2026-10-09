import 'server-only'

const codeOf = (value: unknown) =>
	typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined

/** A mysql2 error code, on the error itself or as the cause of Drizzle's DrizzleQueryError. */
const hasCode = (error: unknown, code: string): boolean =>
	codeOf(error) === code || (error instanceof Error && codeOf(error.cause) === code)

/** MySQL's duplicate-key error (1062 ER_DUP_ENTRY): a unique index refused a write that raced the check before it. */
export const isDuplicateEntry = (error: unknown): boolean => hasCode(error, 'ER_DUP_ENTRY')

/**
 * MySQL's missing parent row (1452 ER_NO_REFERENCED_ROW_2, "Cannot add or update a child row: a foreign key
 * constraint fails"): a foreign key refused an id that no longer exists, such as an account or a group deleted while
 * the admin's form was open (plan deviation 3).
 */
export const isMissingReference = (error: unknown): boolean =>
	hasCode(error, 'ER_NO_REFERENCED_ROW_2')
