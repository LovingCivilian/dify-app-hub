import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { connectionOutcome } from '@/components/admin/apps/connection-outcome'

const t = ((key: string, options?: Record<string, unknown>) =>
	options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction

// Spec §4.2 (E7): success, warning or error, each with a title and a description.
describe('connectionOutcome', () => {
	it('is a success when the provider was reached', () => {
		expect(
			connectionOutcome(t, 'dify', { ok: true, data: { outcome: 'reachable' } }, 'chat'),
		).toEqual({
			type: 'success',
			title: 'connection_test.reachable_title',
			description: 'connection_test.reachable_description',
		})
	})
	it('is a warning naming both types when the provider reports another one', () => {
		expect(
			connectionOutcome(
				t,
				'dify',
				{ ok: true, data: { outcome: 'type_mismatch', reported: 'workflow' } },
				'chat',
			),
		).toEqual({
			type: 'warning',
			title: 'connection_test.type_mismatch_title',
			description: `connection_test.type_mismatch_description:${JSON.stringify({
				reported: 'app_mode.name.workflow',
				chosen: 'app_mode.name.chatbot',
			})}`,
		})
	})
	// Part 2 spec §2.4: an AG-UI agent that ran on the test's invalid input is reachable, with a warning.
	it('is a warning when the agent ran on the test request', () => {
		expect(
			connectionOutcome(t, 'dify', { ok: true, data: { outcome: 'ran_on_invalid_input' } }),
		).toEqual({
			type: 'warning',
			title: 'connection_test.ran_on_invalid_input_title',
			description: 'connection_test.ran_on_invalid_input_description',
		})
	})

	it('names a type the client does not know as the provider wrote it', () => {
		const outcome = connectionOutcome(
			t,
			'dify',
			{ ok: true, data: { outcome: 'type_mismatch', reported: 'rag-pipeline' } },
			'chat',
		)
		expect(outcome.description).toContain('"reported":"rag-pipeline"')
	})
	it.each([
		['provider_key_refused', 'key_refused'],
		['provider_unreachable', 'unreachable'],
		['provider_error', 'upstream_error'],
		['provider_agent_not_found', 'agent_not_found'],
	] as const)('is an error with its own words for %s', (code, words) => {
		expect(connectionOutcome(t, 'dify', { ok: false, code })).toEqual({
			type: 'error',
			title: `connection_test.${words}_title`,
			description: `connection_test.${words}_description`,
		})
	})
	it('is an error with the action’s own message for any other failure', () => {
		expect(connectionOutcome(t, 'dify', { ok: false, code: 'invalid_input' })).toEqual({
			type: 'error',
			title: 'connection_test.failed_title',
			description: 'admin_apps.invalid_input',
		})
	})
})
