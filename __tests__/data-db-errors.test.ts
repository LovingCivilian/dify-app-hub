import { describe, expect, it } from 'vitest'

import { isDuplicateEntry, isMissingReference } from '@/lib/data/db-errors'

const mysqlError = (code: string, errno: number) => Object.assign(new Error(code), { code, errno })

describe('MySQL error codes as mysql2 reports them, bare or as the cause of a DrizzleQueryError', () => {
	it('isDuplicateEntry: 1062 ER_DUP_ENTRY', () => {
		expect(isDuplicateEntry(mysqlError('ER_DUP_ENTRY', 1062))).toBe(true)
		expect(
			isDuplicateEntry(new Error('Failed query', { cause: mysqlError('ER_DUP_ENTRY', 1062) })),
		).toBe(true)
		expect(isDuplicateEntry(mysqlError('ER_NO_REFERENCED_ROW_2', 1452))).toBe(false)
		expect(isDuplicateEntry(null)).toBe(false)
	})

	// Review Focus 3: a picked account or group deleted while the form was open.
	it('isMissingReference: 1452 ER_NO_REFERENCED_ROW_2', () => {
		expect(isMissingReference(mysqlError('ER_NO_REFERENCED_ROW_2', 1452))).toBe(true)
		expect(
			isMissingReference(
				new Error('Failed query', { cause: mysqlError('ER_NO_REFERENCED_ROW_2', 1452) }),
			),
		).toBe(true)
		expect(isMissingReference(mysqlError('ER_DUP_ENTRY', 1062))).toBe(false)
		expect(isMissingReference(undefined)).toBe(false)
	})
})
