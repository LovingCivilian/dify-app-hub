// __tests__/data-db-errors.test.ts
import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import {
	isDeadlock,
	isForeignKeyViolation,
	isInvalidTextRepresentation,
	isUniqueViolation,
} from '@/lib/data/db-errors'

/** A server error as node-postgres reports it: the SQLSTATE in `code`, the refusing constraint in `constraint`. */
const pgError = (code: string, constraint?: string) => {
	const error = new DatabaseError(`server error ${code}`, 0, 'error')
	error.code = code
	error.constraint = constraint
	return error
}
/** The same error as a failed Drizzle query carries it, as its cause (node_modules/drizzle-orm/errors.js). */
const failedQuery = (cause: Error) => new DrizzleQueryError('insert into "users" …', [], cause)

describe('PostgreSQL error codes as node-postgres reports them, bare or as the cause of a DrizzleQueryError', () => {
	it('isUniqueViolation: 23505, by any index or by the one named', () => {
		const email = pgError('23505', 'users_email_key')
		expect(isUniqueViolation(email)).toBe(true)
		expect(isUniqueViolation(failedQuery(email))).toBe(true)
		expect(isUniqueViolation(failedQuery(email), 'users_email_key')).toBe(true)
		// users has three unique indexes; the error names the one that refused (Appendix A).
		expect(isUniqueViolation(failedQuery(email), 'users_one_owner')).toBe(false)
		expect(isUniqueViolation(pgError('23503'))).toBe(false)
		expect(isUniqueViolation(null)).toBe(false)
	})

	// Review Focus 3: a picked account or group deleted while the form was open.
	it('isForeignKeyViolation: 23503', () => {
		const missing = pgError('23503', 'app_user_grants_user_id_users_id_fkey')
		expect(isForeignKeyViolation(missing)).toBe(true)
		expect(isForeignKeyViolation(failedQuery(missing))).toBe(true)
		expect(isForeignKeyViolation(pgError('23505', 'users_email_key'))).toBe(false)
		expect(isForeignKeyViolation(undefined)).toBe(false)
	})

	it('isDeadlock: 40P01', () => {
		expect(isDeadlock(pgError('40P01'))).toBe(true)
		expect(isDeadlock(failedQuery(pgError('40P01')))).toBe(true)
		// 40001 serialization_failure is another condition (PostgreSQL 18 "Transaction Isolation").
		expect(isDeadlock(pgError('40001'))).toBe(false)
		expect(isDeadlock(null)).toBe(false)
	})

	// Spec §3.2: the safety net for an id that reached a uuid column unchecked.
	it('isInvalidTextRepresentation: 22P02', () => {
		expect(isInvalidTextRepresentation(pgError('22P02'))).toBe(true)
		expect(isInvalidTextRepresentation(failedQuery(pgError('22P02')))).toBe(true)
		expect(isInvalidTextRepresentation(pgError('23505'))).toBe(false)
	})

	it('reads only the code and the constraint, never the message (Appendix A: test the error code)', () => {
		// A condition's name is not its code.
		const worded = Object.assign(new Error('duplicate key value violates unique constraint'), {
			code: 'unique_violation',
		})
		expect(isUniqueViolation(worded)).toBe(false)
		expect(isUniqueViolation(new Error('23505'))).toBe(false)
	})
})
