import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
	/** What `authorize` returns and the `jwt` callback receives at sign-in. */
	interface User {
		id: string
		sessionVersion: number
	}

	interface Session {
		user: {
			/** Absent for a revoked JWT: the token lost its id (lib/auth/options.ts jwt callback, ADR-0018). */
			id?: string
		} & DefaultSession['user']
	}
}

declare module 'next-auth/jwt' {
	interface JWT {
		id?: string
		sessionVersion?: number
	}
}
