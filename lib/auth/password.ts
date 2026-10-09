import 'server-only'

import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'

const HASH_ROUNDS = 12

export const hashPassword = (password: string) => bcrypt.hash(password, HASH_ROUNDS)

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

/**
 * A fixed bcrypt hash, at HASH_ROUNDS, of 32 random bytes nobody kept. A sign-in that names no account is checked
 * against it, so an unknown email costs the same bcrypt work as a wrong password (OWASP Authentication Cheat Sheet,
 * "Authentication Responses": without the "quick exit", the check "will go through the same process no matter what
 * the user or the password is"). bcryptjs hashes at the cost written in the hash and answers false at once for a hash
 * that is not 60 characters long; __tests__/auth-password.test.ts pins both against hashPassword's output.
 */
export const UNKNOWN_ACCOUNT_HASH = '$2b$12$gmFTjaGair/YsDufeSTKquHowLTvVvOQUEteIe/S/nARVmKQS5V9i'

export const PASSWORD_RESET_TOKEN_TTL_MS = 15 * 60 * 1000

/** A random token for the emailed link; only its SHA-256 is stored (password_reset_tokens.token_hash). */
export function createPasswordResetToken() {
	const token = randomBytes(32).toString('hex')
	return {
		token,
		tokenHash: createHash('sha256').update(token).digest('hex'),
		expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
	}
}

export function hashPasswordResetToken(token: string) {
	return createHash('sha256').update(token).digest('hex')
}
