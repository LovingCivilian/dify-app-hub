import 'server-only'

import { eq } from 'drizzle-orm'
import type { NextAuthOptions, User } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

import { getDb } from '@/db'
import { users } from '@/db/schema'
import { logActionError } from '@/lib/error-log'

import { verifyPassword } from './password'

/**
 * The account of these credentials without its hash, or null for an unknown email or a wrong password.
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
		})
		.from(users)
		.where(eq(users.email, email))
		.limit(1)
	if (!user) return null
	if (!(await verifyPassword(password, user.password))) return null
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		sessionVersion: user.sessionVersion,
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
 * next-auth v4 with the credentials provider and the JWT strategy (ADR-0006). The jwt callback reads the account
 * on every call. A changed sessionVersion (a password reset or change) or a deleted row strips `id`,
 * `sessionVersion` and `role`; the session callback then sets no `user.id`, and verifySession() reads that as "no
 * live session" (ADR-0018). Otherwise the row's role, email and name replace the token's. An admin's demotion or
 * email edit applies on the next request, and a token from before roles existed gets its role (ADR-0024).
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
	],
	session: { strategy: 'jwt' },
	pages: { signIn: '/login' },
	callbacks: {
		async jwt({ token, user }) {
			if (user) {
				token.id = user.id
				token.role = user.role
				token.sessionVersion = user.sessionVersion
				return token
			}
			if (!token.id) return token
			const [row] = await getDb()
				.select({
					sessionVersion: users.sessionVersion,
					role: users.role,
					email: users.email,
					name: users.name,
				})
				.from(users)
				.where(eq(users.id, token.id))
				.limit(1)
			if (!row || row.sessionVersion !== token.sessionVersion) {
				const { id: _id, sessionVersion: _version, role: _role, ...rest } = token
				return rest
			}
			token.role = row.role
			token.email = row.email
			token.name = row.name
			return token
		},
		session({ session, token }) {
			if (token.id && token.role) {
				session.user.id = token.id
				session.user.role = token.role
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
