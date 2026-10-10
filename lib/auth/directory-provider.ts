import 'server-only'

import type { User } from 'next-auth'
import * as z from 'zod'

import { listGroupLinks, recordDirectorySignIn } from '@/lib/data/directory'
import { directoryConfig } from '@/lib/directory/config'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'
import { directoryResponseFloor } from '@/lib/directory/response-floor'
import { checkDirectoryCredentials } from '@/lib/directory/sign-in'
import {
	logActionError,
	logDirectoryEmailConflict,
	logSignInRefusal,
	type SignInRefusalReason,
} from '@/lib/error-log'

/** Decision w: the username trimmed, the password as typed, both bounded; nothing else of the POST body. */
export const directoryCredentialsSchema = z.object({
	username: z.string().trim().min(1).max(255),
	password: z.string().min(1).max(1024),
})

/**
 * The `ldap` Credentials provider's check (spec §6.3). A refusal answers null, next-auth's `CredentialsSignin`, the
 * same for every account-related reason (spec §7.3; OWASP "Authentication Responses"), logged with its reason and the
 * username, and padded to the response floor (decision t). The directory not answering, or refusing the connection
 * (decision u), throws `DirectoryUnavailable`, which next-auth hands `signIn()` as `result.error`
 * (`node_modules/next-auth/src/core/routes/callback.ts:348-355`); anything else throws `Default` (ADR-0024 decision g),
 * so no driver or directory message reaches the browser.
 */
export async function authorizeDirectory(credentials: unknown): Promise<User | null> {
	const parsed = directoryCredentialsSchema.safeParse(credentials)
	if (!parsed.success) return null
	const { username, password } = parsed.data
	const startedAt = performance.now()
	const refuse = async (reason: SignInRefusalReason) => {
		logSignInRefusal('authorizeDirectory', reason, { username })
		await directoryResponseFloor.pad(startedAt)
		return null
	}
	try {
		const config = directoryConfig()
		if (!config) return await refuse('directory_off')
		const check = await checkDirectoryCredentials(
			config,
			username,
			password,
			await listGroupLinks(),
		)
		if (!check.ok) return await refuse(check.reason)
		const result = await recordDirectorySignIn(
			{
				key: check.entry.key,
				idAttribute: config.idAttribute,
				username: check.entry.username ?? username,
				email: check.entry.email,
				name: check.entry.name,
			},
			check.groupIds,
		)
		if (!result.ok) return await refuse(result.reason)
		if (result.emailConflict)
			logDirectoryEmailConflict('authorizeDirectory', { userId: result.account.id })
		directoryResponseFloor.record(performance.now() - startedAt)
		return { ...result.account, source: 'ldap' }
	} catch (error) {
		logActionError(error, 'authorizeDirectory')
		const unavailable =
			error instanceof DirectoryUnavailableError || error instanceof DirectoryRefusedError
		throw new Error(unavailable ? 'DirectoryUnavailable' : 'Default')
	}
}
