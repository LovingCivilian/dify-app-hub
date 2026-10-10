import type { DefaultSession } from 'next-auth'

import type { AccountSource } from '@/lib/auth/account-source'
import type { Role } from '@/lib/auth/roles'

// next-auth v4 module augmentation (TypeScript guide): the top-level import makes this file a module, and
// `& DefaultSession['user']` keeps name, email and image.
declare module 'next-auth' {
	/** What `authorize` returns and the `jwt` callback receives at sign-in. */
	interface User {
		id: string
		role: Role
		sessionVersion: number
		source: AccountSource
	}

	interface Session {
		user: {
			/** Absent for a revoked JWT: the token lost its id (lib/auth/options.ts jwt callback, ADR-0018). */
			id?: string
			/** Absent with the id. */
			role?: Role
			/** Absent with the id. */
			source?: AccountSource
		} & DefaultSession['user']
	}
}

declare module 'next-auth/jwt' {
	interface JWT {
		id?: string
		role?: Role
		sessionVersion?: number
		source?: AccountSource
	}
}
