import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { PROVIDER_IDS } from '@/lib/providers/ids'
import { PROVIDERS } from '@/lib/providers/registry'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'workflow' as const,
	answerForm: { enabled: true, feedbackText: 'Sent' },
	enableUpdateAfterConversationStarts: true,
	openingStatementDisplayMode: 'always' as const,
}

describe('the server registry (spec §3)', () => {
	it('has one definition per provider id (DV 11)', () => {
		expect(Object.keys(PROVIDERS).sort()).toEqual([...PROVIDER_IDS].sort())
		expect(PROVIDERS.dify.id).toBe('dify')
	})
})

// Spec §2.3: what each DTO may carry of Dify's settings and secrets.
describe("Dify's DTO fields", () => {
	it('give the chat the type and its three switches, never the API base', () => {
		const fields = PROVIDERS.dify.chatFields(settings)
		expect(fields).toEqual({
			appType: 'workflow',
			settings: {
				answerForm: { enabled: true, feedbackText: 'Sent' },
				enableUpdateAfterConversationStarts: true,
				openingStatementDisplayMode: 'always',
			},
		})
		expect(JSON.stringify(fields)).not.toContain('dify.example')
	})
	it('give the gallery the type only', () => {
		expect(PROVIDERS.dify.summaryFields(settings)).toEqual({ appType: 'workflow' })
	})
	it('say whether the key is set, never its value', () => {
		const set = PROVIDERS.dify.secretsSet({ apiKey: 'app-secret' })
		expect(set).toEqual({ apiKey: true })
		expect(JSON.stringify(set)).not.toContain('app-secret')
	})
})
