import 'server-only'

import { SignJWT } from 'jose'

import type { ProviderCaller } from '../caller'

/** Spec §2.3: a token lives 60 s; the agent allows 10 s of clock skew. */
export const AGENT_JWT_LIFETIME_SECONDS = 60

/**
 * The one auth header's token for an upstream AG-UI request (spec §2.3; decision 45), minted fresh for every request:
 * each run and each Test connection. jose's `SignJWT` HMAC example (README and docs/jwt/sign/classes/SignJWT.md: the
 * secret as `new TextEncoder().encode(…)`, `alg: 'HS256'`); `setIssuedAt` and `setExpirationTime` take Unix seconds
 * (jose's ProduceJWT typings), so `now` fixes both for a test. The claims are the agent contract's: `sub` the account's
 * permanent id (ADR-0026), `auth_source`, `roles`, `iss` and `aud`; no name or email (minimal disclosure, AGENTS.md).
 */
export const mintAgentToken = ({
	caller,
	secret,
	audience,
	issuer,
	now = new Date(),
}: {
	caller: ProviderCaller
	secret: string
	audience: string
	issuer: string
	now?: Date
}): Promise<string> => {
	const issuedAt = Math.floor(now.getTime() / 1000)
	return new SignJWT({ auth_source: caller.source, roles: [caller.role] })
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setSubject(caller.id)
		.setIssuer(issuer)
		.setAudience(audience)
		.setIssuedAt(issuedAt)
		.setExpirationTime(issuedAt + AGENT_JWT_LIFETIME_SECONDS)
		.sign(new TextEncoder().encode(secret))
}
