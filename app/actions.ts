'use server'

import * as z from 'zod'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import type { ActionResult } from '@/lib/action-result'
import { passwordField } from '@/lib/auth/fields'
import { requireActor } from '@/lib/auth/session'
import { changeOwnPassword } from '@/lib/data/users'

/*
 * The account actions the shell uses (charter §4.3: app/actions.ts). Any signed-in role; each acts on the caller's
 * own account only.
 */

/**
 * The current password has no maximum, as at sign-in: one set before the 72-byte cap (the inherited reset form has
 * none) must still be accepted, and bcrypt reads its first 72 bytes either way (decision f). The request body is
 * bounded by the Server Action body limit (next.config.js `serverActions.bodySizeLimit`, 1MB by default).
 */
const changePasswordInput = z.object({
	currentPassword: z.string().min(1),
	newPassword: passwordField,
})

/**
 * Changes the caller's password. On success every session is revoked, this one included, and the client signs
 * out; next-auth's session update() is not used, since a revoked token could call it too (charter §4.2).
 */
export async function changePasswordAction(input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireActor()
		const parsed = changePasswordInput.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		return await changeOwnPassword(actor, parsed.data)
	} catch (error) {
		return toActionFailure(error, 'changePasswordAction')
	}
}
