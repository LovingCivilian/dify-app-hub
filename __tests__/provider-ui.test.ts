import { ApartmentOutlined, AppstoreOutlined, RobotOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import {
	adminAppType,
	PROVIDER_UI,
	providerIcon,
	providerLine,
	typeName,
} from '@/components/provider-ui/registry'
import { PROVIDER_IDS } from '@/lib/providers/ids'

const t = ((key: string) => key) as unknown as TFunction

describe('the client registry (spec §3)', () => {
	it('has an entry per provider id (DV 11)', () => {
		expect(Object.keys(PROVIDER_UI).sort()).toEqual([...PROVIDER_IDS].sort())
	})
	// E11: each provider's fallback icon (Part 2 spec §2.1: RobotOutlined for AG-UI), and the generic one for a provider
	// the browser does not know.
	it('gives each provider its fallback icon, and an unknown one the generic icon', () => {
		expect(providerIcon('dify')).toBe(ApartmentOutlined)
		expect(providerIcon('agui')).toBe(RobotOutlined)
		expect(providerIcon('openai')).toBe(AppstoreOutlined)
	})
	// Part 2 spec §2.2: "AG-UI agent", with no app types.
	it('names an AG-UI app by its provider alone', () => {
		expect(providerLine(t, 'agui')).toBe('provider.agui')
		expect(providerLine(t, 'agui', 'chat')).toBe('provider.agui')
		expect(typeName(t, 'agui', 'chat')).toBe('chat')
		expect(PROVIDER_UI.agui.types).toEqual([])
	})
	// E9 and E10: "Dify · Chatflow".
	it('names the provider and the app type, or the provider alone', () => {
		expect(providerLine(t, 'dify', 'advanced-chat')).toBe('provider.dify · app_mode.name.chatflow')
		expect(providerLine(t, 'dify', 'workflow')).toBe('provider.dify · app_mode.name.workflow')
		expect(providerLine(t, 'dify')).toBe('provider.dify')
		expect(providerLine(t, 'dify', 'rag-pipeline')).toBe('provider.dify')
		expect(providerLine(t, 'dify', 'toString')).toBe('provider.dify')
	})
	it('names a type, or gives a type it does not know back as written', () => {
		expect(typeName(t, 'dify', 'advanced-chat')).toBe('app_mode.name.chatflow')
		expect(typeName(t, 'dify', 'rag-pipeline')).toBe('rag-pipeline')
	})
	// E9: the table reads the type of an app whose documents read cleanly; an invalid one has none.
	it('reads the admin DTO’s type, and none for an invalid app', () => {
		const common = {
			id: 'a1',
			provider: 'dify' as const,
			name: 'Tea',
			description: '',
			tags: [],
			enabled: true,
			hasIcon: false,
			access: { mode: 'everyone' as const, groupIds: [], userIds: [] },
			createdAt: '',
			updatedAt: '',
		}
		expect(
			adminAppType({
				...common,
				invalid: false,
				settings: {
					apiBase: 'https://dify.example/v1',
					appType: 'workflow',
					answerForm: { enabled: false, feedbackText: '' },
					enableUpdateAfterConversationStarts: false,
					openingStatementDisplayMode: 'default',
				},
				secretsSet: { apiKey: true },
			}),
		).toBe('workflow')
		expect(adminAppType({ ...common, invalid: true })).toBeUndefined()
		expect(
			adminAppType({
				...common,
				provider: 'agui',
				invalid: false,
				settings: { agentUrl: 'http://agents:8000/agents/a', audience: 'a', askUser: false },
				secretsSet: { jwtSecret: true },
			}),
		).toBeUndefined()
	})
	it('lists Dify’s types in the console’s order', () => {
		expect(PROVIDER_UI.dify.types).toEqual([
			'chat',
			'agent',
			'advanced-chat',
			'agent-chat',
			'workflow',
			'completion',
		])
	})
})
