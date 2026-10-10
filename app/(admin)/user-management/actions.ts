'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import type { SyncRunCounts } from '@/lib/data/directory'
import { createUser, deleteUser, setUserActive, updateUser, updateUserRole } from '@/lib/data/users'
import { syncDirectoryNow } from '@/lib/directory/admin'
import type { SyncErrorCode, SyncOutcome } from '@/lib/directory-status'

import {
	createUserInputSchema,
	userIdSchema,
	userInputSchema,
	userRoleInputSchema,
} from './schemas'

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

export async function updateUserRoleAction(id: string, input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const parsed = userRoleInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await updateUserRole(actor, id, parsed.data.role)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'updateUserRoleAction')
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

export async function syncDirectoryAction(): Promise<
	ActionResult<{
		outcome: Exclude<SyncOutcome, 'running'>
		counts: SyncRunCounts
		errorCode: SyncErrorCode | null
	}>
> {
	try {
		const actor = await requireAdmin()
		const result = await syncDirectoryNow(actor)
		if (result === null) return fail('not_found')
		// A manual slot is unique, so `skipped` cannot happen; both mean "another run has it".
		if (result.status !== 'finished') return fail('sync_running')
		refresh()
		return ok({ outcome: result.outcome, counts: result.counts, errorCode: result.errorCode })
	} catch (error) {
		return toActionFailure(error, 'syncDirectoryAction')
	}
}
