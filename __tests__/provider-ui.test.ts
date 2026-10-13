import { ApartmentOutlined, AppstoreOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import {
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
	// E11: Dify's fallback icon, and the generic one for a provider the browser does not know.
	it('gives each provider its fallback icon, and an unknown one the generic icon', () => {
		expect(providerIcon('dify')).toBe(ApartmentOutlined)
		expect(providerIcon('agui')).toBe(AppstoreOutlined)
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
})
