import 'server-only'

import { eq } from 'drizzle-orm'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

import { getDb } from '@/db'
import { users } from '@/db/schema'

import { verifyPassword } from './password'

/**
 * next-auth v4 with the credentials provider and the JWT strategy (ADR-0006). The jwt callback re-checks the
 * account's sessionVersion on every call: a mismatch (a password reset or change bumped it) strips `id` and
 * `sessionVersion` from the token, the session callback then sets no `user.id`, and verifySession() treats
 * that as "no live session" (ADR-0018). Returning a token without the claims keeps the callback within its
 * documented return type instead of returning null.
 */
export const authOptions: NextAuthOptions = {
	providers: [
		CredentialsProvider({
			name: 'credentials',
			credentials: {
				email: { label: 'Email', type: 'email' },
				password: { label: 'Password', type: 'password' },
			},
			async authorize(credentials) {
				if (!credentials?.email || !credentials?.password) return null
				const [user] = await getDb()
					.select({
						id: users.id,
						email: users.email,
						name: users.name,
						password: users.password,
						sessionVersion: users.sessionVersion,
					})
					.from(users)
					.where(eq(users.email, credentials.email))
					.limit(1)
				if (!user) return null
				if (!(await verifyPassword(credentials.password, user.password))) return null
				return {
					id: user.id,
					email: user.email,
					name: user.name,
					sessionVersion: user.sessionVersion,
				}
			},
		}),
	],
	session: { strategy: 'jwt' },
	pages: { signIn: '/login' },
	callbacks: {
		async jwt({ token, user }) {
			if (user) {
				token.id = user.id
				token.sessionVersion = user.sessionVersion
				return token
			}
			if (token.id) {
				const [row] = await getDb()
					.select({ sessionVersion: users.sessionVersion })
					.from(users)
					.where(eq(users.id, token.id))
					.limit(1)
				if (!row || row.sessionVersion !== token.sessionVersion) {
					const { id: _id, sessionVersion: _version, ...rest } = token
					return rest
				}
			}
			return token
		},
		session({ session, token }) {
			if (token.id) session.user.id = token.id
			return session
		},
	},
}
