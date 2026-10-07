import 'server-only'

import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'

const HASH_ROUNDS = 12

export const hashPassword = (password: string) => bcrypt.hash(password, HASH_ROUNDS)

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

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
