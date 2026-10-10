import 'server-only'

import { eq } from 'drizzle-orm'
import type { NextAuthOptions, User } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

import { getDb } from '@/db'
import { users } from '@/db/schema'
import { logActionError, logSignInRefusal } from '@/lib/error-log'

import { isActive } from './account-status'
import { authorizeDirectory } from './directory-provider'
import { UNKNOWN_ACCOUNT_HASH, verifyPassword } from './password'

/**
 * The account of these credentials without its hash, or null for an unknown email, a wrong password, a deactivated
 * account (ADR-0027) or a directory account, which has no hub password (ADR-0029).
 */
async function findAccount(email: string, password: string): Promise<User | null> {
	const [user] = await getDb()
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			password: users.password,
			sessionVersion: users.sessionVersion,
			adminDeactivatedAt: users.adminDeactivatedAt,
			directoryDeactivatedAt: users.directoryDeactivatedAt,
		})
		.from(users)
		.where(eq(users.email, email))
		.limit(1)
	if (!user) {
		// OWASP "Authentication Responses": no quick exit. The same bcrypt work as a wrong password, against a fixed
		// hash, so the answer's time does not tell an unknown email apart; its result is ignored.
		await verifyPassword(password, UNKNOWN_ACCOUNT_HASH)
		return null
	}
	// Spec §6.3: an account the directory owns has no hub password. The same bcrypt work as a wrong password, against
	// the fixed hash, so the answer's time tells nothing; refused like a wrong password (OWASP "Authentication Responses").
	if (user.password === null) {
		await verifyPassword(password, UNKNOWN_ACCOUNT_HASH)
		logSignInRefusal('authorizeCredentials', 'directory_account', { userId: user.id })
		return null
	}
	if (!(await verifyPassword(password, user.password))) return null
	// Spec §5: after the password, so a wrong password and a deactivated account take the same path and answer.
	if (!isActive(user)) {
		logSignInRefusal('authorizeCredentials', 'account_inactive', { userId: user.id })
		return null
	}
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		sessionVersion: user.sessionVersion,
		// The passwordless check above refused every directory account, so a local sign-in is a local account.
		source: 'local',
	}
}

/**
 * The credentials check of next-auth's Credentials provider (next-auth Credentials provider: return null and "an
 * error will be displayed advising the user to check their details"; throw an Error and "the user will be sent to
 * the error page with the error message as a query parameter"). Refused credentials answer null, next-auth's
 * `CredentialsSignin`. A failure of the lookup or the check is logged by name, code and errno only (decision g), and
 * rethrown as next-auth's catch-all code `Default` (next-auth Pages, "Error codes"): a Drizzle error's message holds
 * the SQL and its parameters, the typed email among them, and would reach the browser in that URL. Exported for its
 * tests.
 */
export async function authorizeCredentials(
	credentials: Record<'email' | 'password', string> | undefined,
): Promise<User | null> {
	if (!credentials?.email || !credentials?.password) return null
	try {
		return await findAccount(credentials.email, credentials.password)
	} catch (error) {
		logActionError(error, 'authorizeCredentials')
		throw new Error('Default')
	}
}

/**
 * next-auth v4 with two Credentials providers, the local `credentials` and the directory's `ldap` (ADR-0029), and the
 * JWT strategy (ADR-0006). The jwt callback reads the account on every call. A changed sessionVersion (a password reset
 * or change) or a deleted row strips `id`, `sessionVersion`, `role` and `source`; the session callback then sets no
 * `user.id`, and verifySession() reads that as "no live session" (ADR-0018). A deactivated row (ADR-0027) is treated as
 * revoked. Otherwise the row's role, email, name and source replace the token's. An admin's demotion or email edit
 * applies on the next request, and a token from before roles existed gets its role (ADR-0024).
 */
export const authOptions: NextAuthOptions = {
	providers: [
		CredentialsProvider({
			name: 'credentials',
			credentials: {
				email: { label: 'Email', type: 'email' },
				password: { label: 'Password', type: 'password' },
			},
			authorize: authorizeCredentials,
		}),
		// next-auth v4 "Multiple providers": "You can specify more than one credentials provider by specifying a unique
		// `id` for each one" (Credentials provider page). The login page's Directory tab posts to /api/auth/callback/ldap.
		CredentialsProvider({
			id: 'ldap',
			name: 'Directory account',
			credentials: {
				username: { label: 'Username', type: 'text' },
				password: { label: 'Password', type: 'password' },
			},
			authorize: authorizeDirectory,
		}),
	],
	session: { strategy: 'jwt' },
	pages: { signIn: '/login' },
	callbacks: {
		async jwt({ token, user }) {
			if (user) {
				token.id = user.id
				token.role = user.role
				token.sessionVersion = user.sessionVersion
				token.source = user.source
				return token
			}
			if (!token.id) return token
			const [row] = await getDb()
				.select({
					sessionVersion: users.sessionVersion,
					role: users.role,
					email: users.email,
					name: users.name,
					source: users.source,
					adminDeactivatedAt: users.adminDeactivatedAt,
					directoryDeactivatedAt: users.directoryDeactivatedAt,
				})
				.from(users)
				.where(eq(users.id, token.id))
				.limit(1)
			// ADR-0018's revocation rule, and spec §5: the token is refused while the row is inactive (either marker set,
			// also by hand in the database). Only the app's Deactivate, which bumps sessionVersion in the same write, keeps
			// a token issued before refused after reactivation; a marker set by hand bumps nothing, so reactivating by hand
			// can revive such a token.
			if (!row || row.sessionVersion !== token.sessionVersion || !isActive(row)) {
				const { id: _id, sessionVersion: _version, role: _role, source: _source, ...rest } = token
				return rest
			}
			token.role = row.role
			token.email = row.email
			token.name = row.name
			// Decision v: refreshed from the row as the role is, so the account menu knows a directory account.
			token.source = row.source
			return token
		},
		session({ session, token }) {
			if (token.id && token.role) {
				session.user.id = token.id
				session.user.role = token.role
				session.user.source = token.source
				// Forwarded explicitly from the token, which the jwt callback refreshed from the row (next-auth callbacks
				// docs: token data reaches the session only through this callback). No fallback to the default user, so a
				// name the row cleared arrives as null.
				session.user.email = token.email ?? null
				session.user.name = token.name ?? null
			}
			return session
		},
	},
}
