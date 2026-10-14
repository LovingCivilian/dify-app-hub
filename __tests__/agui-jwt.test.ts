import { decodeProtectedHeader, errors, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { AGENT_JWT_LIFETIME_SECONDS, mintAgentToken } from '@/lib/providers/agui/jwt'

const secret = 'an-app-secret-of-at-least-32-chars!'
const key = new TextEncoder().encode(secret)
const now = new Date('2026-10-14T12:00:00Z')
const issuedAt = now.getTime() / 1000
const caller = {
	id: 'b6f1c2d4-0000-4000-8000-000000000001',
	source: 'ldap' as const,
	role: 'user' as const,
}
const mint = () =>
	mintAgentToken({ caller, secret, audience: 'assistant', issuer: 'nextjs-bff', now })

// The checks the owner's agent service runs (decision 45): HS256 with the app's secret, `iss`, `aud`, `exp`, `sub`.
const verify = (token: string, at: Date) =>
	jwtVerify(token, key, {
		algorithms: ['HS256'],
		issuer: 'nextjs-bff',
		audience: 'assistant',
		requiredClaims: ['sub', 'iat', 'exp'],
		currentDate: at,
	})

describe('mintAgentToken (Part 2 spec §2.3)', () => {
	it('signs HS256 with the JWT type in the header', async () => {
		expect(decodeProtectedHeader(await mint())).toEqual({ alg: 'HS256', typ: 'JWT' })
	})
	it('carries exactly the agent contract’s claims, with no name or email', async () => {
		const { payload } = await verify(await mint(), now)
		expect(payload).toEqual({
			sub: caller.id,
			iat: issuedAt,
			exp: issuedAt + 60,
			iss: 'nextjs-bff',
			aud: 'assistant',
			auth_source: 'ldap',
			roles: ['user'],
		})
		expect(AGENT_JWT_LIFETIME_SECONDS).toBe(60)
	})
	it('expires after 60 seconds', async () => {
		const token = await mint()
		await expect(verify(token, new Date(now.getTime() + 59_000))).resolves.toBeDefined()
		await expect(verify(token, new Date(now.getTime() + 61_000))).rejects.toBeInstanceOf(
			errors.JWTExpired,
		)
	})
	it('fails verification with another secret, issuer or audience', async () => {
		const token = await mint()
		await expect(
			jwtVerify(token, new TextEncoder().encode(`${secret}-other`), { currentDate: now }),
		).rejects.toBeInstanceOf(errors.JWSSignatureVerificationFailed)
		await expect(
			jwtVerify(token, key, { issuer: 'someone-else', currentDate: now }),
		).rejects.toBeInstanceOf(errors.JWTClaimValidationFailed)
		await expect(
			jwtVerify(token, key, { audience: 'another-agent', currentDate: now }),
		).rejects.toBeInstanceOf(errors.JWTClaimValidationFailed)
	})
	it('mints a fresh token per call', async () => {
		const later = await mintAgentToken({
			caller,
			secret,
			audience: 'assistant',
			issuer: 'nextjs-bff',
			now: new Date(now.getTime() + 1000),
		})
		expect(later).not.toBe(await mint())
	})
})
