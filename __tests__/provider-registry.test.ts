import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { PROVIDER_IDS } from '@/lib/providers/ids'
import { aguiChat } from '@/lib/providers/agui/chat'
import { chatAdapterOf, PROVIDERS } from '@/lib/providers/registry'

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
		expect(PROVIDERS.agui.id).toBe('agui')
	})
	// Part 2 spec §4.1: the hub keeps AG-UI conversations; Dify's stay in Dify until Part 3.
	it('says which providers the hub keeps the history of', () => {
		expect(PROVIDERS.dify.hubHistory).toBe(false)
		expect(PROVIDERS.agui.hubHistory).toBe(true)
	})
})

// Part 2 spec §2.2: what each DTO may carry of an AG-UI app's documents.
describe("AG-UI's DTO fields", () => {
	const aguiSettings = {
		agentUrl: 'http://agents:8000/agents/assistant',
		audience: 'assistant',
		askUser: true,
	}
	it('give the chat the ask_user switch only, and the gallery nothing', () => {
		expect(PROVIDERS.agui.chatFields(aguiSettings)).toEqual({ askUser: true })
		expect(PROVIDERS.agui.chatFields({ ...aguiSettings, askUser: false })).toEqual({
			askUser: false,
		})
		expect(PROVIDERS.agui.summaryFields()).toEqual({})
	})
	it('say whether the secret is set, never its value', () => {
		const set = PROVIDERS.agui.secretsSet({ jwtSecret: 'k'.repeat(32) })
		expect(set).toEqual({ jwtSecret: true })
		expect(JSON.stringify(set)).not.toContain('kkkk')
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

// Spec §4.1: the shared chat reaches a provider's turn through the registry; Dify has none until Part 3.
describe('chatAdapterOf', () => {
	it('gives the AG-UI adapter, and none for Dify', () => {
		expect(chatAdapterOf('agui')).toBe(aguiChat)
		expect(chatAdapterOf('dify')).toBeUndefined()
	})
})
