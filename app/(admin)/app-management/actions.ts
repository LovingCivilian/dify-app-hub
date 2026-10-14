'use server'

import { refresh } from 'next/cache'

import { toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createApp, deleteApp, getStoredSecrets, updateApp } from '@/lib/data/apps'
import { isForeignKeyViolation } from '@/lib/data/db-errors'
import { isId } from '@/lib/ids'
import type { ProviderCaller } from '@/lib/providers/caller'
import type { ConnectionTestResult } from '@/lib/providers/connection'
import type { ProviderId } from '@/lib/providers/ids'
import { providerDefinition } from '@/lib/providers/registry'
import {
	documentFieldErrors,
	mergeSecrets,
	PROVIDER_SCHEMAS,
	secretsSchemaOf,
	type StoredSettings,
} from '@/lib/providers/schemas'

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

/**
 * What a test that reached the provider found (spec §4.2): reachable, reachable while the provider reports another type,
 * or reachable while an AG-UI agent started a run on input it should have refused (Part 2 spec §2.4).
 */
export type ConnectionTestOutcome =
	| { outcome: 'reachable' }
	| { outcome: 'type_mismatch'; reported: string }
	| { outcome: 'ran_on_invalid_input' }

/** Plan decision g: the test's failures have codes of their own (Part 2 spec §2.4 adds an agent the URL does not name). */
const TEST_FAILURES = {
	key_refused: 'provider_key_refused',
	unreachable: 'provider_unreachable',
	upstream_error: 'provider_error',
	agent_not_found: 'provider_agent_not_found',
} as const

/** The test's warning, if any, as the drawer reads it. */
const testOutcome = (
	warning: Extract<ConnectionTestResult, { ok: true }>['warning'],
): ConnectionTestOutcome => {
	if (warning?.code === 'type_mismatch')
		return { outcome: 'type_mismatch', reported: warning.reported }
	if (warning?.code === 'ran_on_invalid_input') return { outcome: 'ran_on_invalid_input' }
	return { outcome: 'reachable' }
}

/**
 * One provider's test, generic over its id so its settings, its merged secrets and its test go together (the registry's
 * `providerDefinition`): the merged secrets are parsed first, then the provider is asked as the admin (Part 2 plan call
 * P2: an AG-UI token's `sub` is the admin running the test).
 */
const runTest = async <P extends ProviderId>(
	documents: StoredSettings<P>,
	secrets: unknown,
	caller: ProviderCaller,
): Promise<ActionResult<ConnectionTestOutcome>> => {
	const merged = secretsSchemaOf(documents.provider).safeParse(secrets)
	if (!merged.success) return fail('invalid_input', documentFieldErrors('secrets', merged.error))
	const result = await providerDefinition(documents.provider).testConnection(
		documents.settings,
		merged.data,
		caller,
	)
	if (!result.ok) return fail(TEST_FAILURES[result.code])
	return ok(testOutcome(result.warning))
}

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
		const { appId, provider, secrets } = parsed.data
		// Spec §4.2 step 2: the stored secrets are read only for a saved app with a secret field left blank.
		const blank = Object.keys(PROVIDER_SCHEMAS[provider].defaultSecrets).some(
			key => (secrets as Record<string, string | undefined>)[key] === undefined,
		)
		let stored: unknown = {}
		if (appId && blank) {
			const found = await getStoredSecrets(actor, appId, provider)
			if (!found) return fail('not_found')
			stored = found.secrets
		}
		return await runTest(parsed.data, mergeSecrets(stored, secrets), actor)
	} catch (error) {
		return toActionFailure(error, 'testAppConnectionAction')
	}
}
