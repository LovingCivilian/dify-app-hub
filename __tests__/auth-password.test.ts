import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { hashPassword, UNKNOWN_ACCOUNT_HASH, verifyPassword } from '@/lib/auth/password'

describe('UNKNOWN_ACCOUNT_HASH', () => {
	// bcryptjs compare answers false at once, without hashing, for a hash that is not 60 characters long, and otherwise
	// hashes at the cost written in the hash's salt (node_modules/bcryptjs/index.js, compare): the fixed hash is only
	// worth the same work as a stored one while it is a well-formed bcrypt hash of the same version and cost.
	it('is a well-formed bcrypt hash of the version and cost hashPassword writes', async () => {
		const stored = await hashPassword('any password')
		expect(UNKNOWN_ACCOUNT_HASH).toHaveLength(60)
		expect(UNKNOWN_ACCOUNT_HASH.slice(0, 7)).toBe(stored.slice(0, 7))
		expect(bcrypt.getRounds(UNKNOWN_ACCOUNT_HASH)).toBe(bcrypt.getRounds(stored))
		// A malformed salt would reject; resolving false means the full hash ran.
		await expect(verifyPassword('any password', UNKNOWN_ACCOUNT_HASH)).resolves.toBe(false)
	})
})
