'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createUser, deleteUser, setUserActive, updateUser } from '@/lib/data/users'

import { createUserInputSchema, userIdSchema, userInputSchema } from './schemas'

/*
 * Thin Server Actions (charter §4.2): verify the admin, validate, call the DAL, refresh the route (next/cache
 * `refresh`: the page reads the database directly), answer a plain ActionResult. Every expected failure is a
 * result, never a throw; the DAL checks the role again.
 */

export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
	try {
		const actor = await requireAdmin()
		const parsed = createUserInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await createUser(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'createUserAction')
	}
}

export async function updateUserAction(id: string, input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const parsed = userInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await updateUser(actor, id, {
			...parsed.data,
			password: parsed.data.password || undefined,
		})
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'updateUserAction')
	}
}

export async function deleteUserAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const result = await deleteUser(actor, id)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'deleteUserAction')
	}
}

export async function deactivateUserAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const result = await setUserActive(actor, id, false)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'deactivateUserAction')
	}
}

export async function reactivateUserAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const result = await setUserActive(actor, id, true)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'reactivateUserAction')
	}
}
