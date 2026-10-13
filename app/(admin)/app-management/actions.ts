'use server'

import { refresh } from 'next/cache'

import { toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createApp, deleteApp, getStoredSecrets, updateApp } from '@/lib/data/apps'
import { isForeignKeyViolation } from '@/lib/data/db-errors'
import { isId } from '@/lib/ids'
import { PROVIDERS } from '@/lib/providers/registry'
import { documentFieldErrors, mergeSecrets } from '@/lib/providers/schemas'

import {
	connectionTestSchema,
	createAppFormSchema,
	formFieldErrors,
	updateAppFormSchema,
} from './schemas'

/*
 * Thin Server Actions (charter §4.2; Part 1 spec §4.3): verify the admin, validate, call the DAL, refresh the route
 * (next/cache `refresh`: the page reads the database directly, so the current route's RSC payload is refetched in the
 * same round trip), answer a plain ActionResult. Every expected failure is a result, never a throw. The save actions
 * take FormData, because the icon is a file (the branding page's pattern).
 */

export async function createAppAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
	try {
		const actor = await requireAdmin()
		const parsed = createAppFormSchema.safeParse(Object.fromEntries(formData))
		if (!parsed.success) return fail('invalid_input', formFieldErrors(parsed.error))
		const result = await createApp(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		// B3a deviation 3: a group or account picked in the drawer was deleted before the save; nothing was written.
		if (isForeignKeyViolation(error)) return fail('invalid_input', { access: ['unknown'] })
		return toActionFailure(error, 'createAppAction')
	}
}

export async function updateAppAction(id: string, formData: FormData): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!isId(id)) return fail('not_found')
		const parsed = updateAppFormSchema.safeParse(Object.fromEntries(formData))
		if (!parsed.success) return fail('invalid_input', formFieldErrors(parsed.error))
		// Spec §2.3: the provider is the stored one; updateApp takes none.
		const { common, access, settings, secrets, icon } = parsed.data
		const result = await updateApp(actor, id, { common, access, settings, secrets, icon })
		if (result.ok) refresh()
		return result
	} catch (error) {
		// B3a deviation 3: a group or account picked in the drawer was deleted before the save; nothing was written.
		if (isForeignKeyViolation(error)) return fail('invalid_input', { access: ['unknown'] })
		return toActionFailure(error, 'updateAppAction')
	}
}

export async function deleteAppAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!isId(id) || !(await deleteApp(actor, id))) return fail('not_found')
		refresh()
		return ok(undefined)
	} catch (error) {
		return toActionFailure(error, 'deleteAppAction')
	}
}

/** What a test that reached the provider found (spec §4.2): reachable, or reachable while the provider reports another type. */
export type ConnectionTestOutcome =
	| { outcome: 'reachable' }
	| { outcome: 'type_mismatch'; reported: string }

/** Plan decision g: the test's failures have codes of their own. */
const TEST_FAILURES = {
	key_refused: 'provider_key_refused',
	unreachable: 'provider_unreachable',
	upstream_error: 'provider_error',
} as const

/**
 * Test connection (spec §4.2; decision 18): verifies the admin (ADR-0024), reads the stored secret on the server when the
 * app exists and a field is blank, and asks the provider through the registry. It saves nothing and copies nothing. A
 * refused input answers by field with codes only, as the save actions do (review B7: a zod message can echo the input).
 */
export async function testAppConnectionAction(
	input: unknown,
): Promise<ActionResult<ConnectionTestOutcome>> {
	try {
		const actor = await requireAdmin()
		const parsed = connectionTestSchema.safeParse(input)
		if (!parsed.success) return fail('invalid_input', formFieldErrors(parsed.error))
		const { appId, provider, settings, secrets } = parsed.data
		const definition = PROVIDERS[provider]
		// Spec §4.2 step 2: the stored secrets are read only for a saved app with a secret field left blank.
		const blank = Object.keys(definition.defaultSecrets).some(
			key => (secrets as Record<string, string | undefined>)[key] === undefined,
		)
		let stored: unknown = {}
		if (appId && blank) {
			const found = await getStoredSecrets(actor, appId, provider)
			if (!found) return fail('not_found')
			stored = found.secrets
		}
		const merged = definition.secretsSchema.safeParse(mergeSecrets(stored, secrets))
		if (!merged.success) return fail('invalid_input', documentFieldErrors('secrets', merged.error))
		const result = await definition.testConnection(settings, merged.data)
		if (!result.ok) return fail(TEST_FAILURES[result.code])
		return ok(
			result.warning
				? { outcome: 'type_mismatch', reported: result.warning.reported }
				: { outcome: 'reachable' },
		)
	} catch (error) {
		return toActionFailure(error, 'testAppConnectionAction')
	}
}
