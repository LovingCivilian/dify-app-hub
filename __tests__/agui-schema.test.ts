import { describe, expect, it } from 'vitest'

import {
	AGUI_DEFAULT_SECRETS,
	AGUI_DEFAULT_SETTINGS,
	aguiSecretsSchema,
	aguiSecretsUpdateSchema,
	aguiSettingsSchema,
} from '@/lib/providers/agui/schema'

const settings = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
const secret = 'k'.repeat(32)

describe("AG-UI's settings (Part 2 spec §2.2)", () => {
	it('reads a valid document and drops keys it does not know', () => {
		expect(aguiSettingsSchema.parse({ ...settings, askUser: true })).toEqual(settings)
	})
	it('takes a Docker service name and an https URL as the agent URL', () => {
		expect(aguiSettingsSchema.safeParse(settings).success).toBe(true)
		expect(
			aguiSettingsSchema.safeParse({ ...settings, agentUrl: 'https://agents.example/agents/a' })
				.success,
		).toBe(true)
	})
	it('trims the audience', () => {
		expect(aguiSettingsSchema.parse({ ...settings, audience: '  assistant ' }).audience).toBe(
			'assistant',
		)
	})
	it.each([
		['an agent URL that is not http(s)', { agentUrl: 'ftp://agents/a' }],
		['an agent URL that is not a URL', { agentUrl: 'agents' }],
		['a 501-character agent URL', { agentUrl: `http://a/${'x'.repeat(492)}` }],
		['an empty audience', { audience: '   ' }],
		['a 256-character audience', { audience: 'a'.repeat(256) }],
	])('refuses %s', (_label, over) => {
		expect(aguiSettingsSchema.safeParse({ ...settings, ...over }).success).toBe(false)
	})
})

describe("AG-UI's secret (spec §2.2; decision 45)", () => {
	it('takes 32 to 512 characters after trimming', () => {
		expect(aguiSecretsSchema.parse({ jwtSecret: ` ${secret} ` })).toEqual({ jwtSecret: secret })
		expect(aguiSecretsSchema.safeParse({ jwtSecret: 'k'.repeat(512) }).success).toBe(true)
	})
	it.each([
		['31 characters', 'k'.repeat(31)],
		['31 characters padded with blanks', ` ${'k'.repeat(31)} `],
		['513 characters', 'k'.repeat(513)],
	])('refuses %s', (_label, jwtSecret) => {
		expect(aguiSecretsSchema.safeParse({ jwtSecret }).success).toBe(false)
	})
	// ADR-0032: a blank secret on Edit keeps the stored one.
	it('reads a blank or missing secret on an edit as not given', () => {
		expect(aguiSecretsUpdateSchema.parse({ jwtSecret: '   ' })).toEqual({ jwtSecret: undefined })
		expect(aguiSecretsUpdateSchema.parse({})).toEqual({ jwtSecret: undefined })
		expect(aguiSecretsUpdateSchema.parse({ jwtSecret: secret })).toEqual({ jwtSecret: secret })
	})
})

describe('the form’s defaults', () => {
	it('start with empty fields, which the schemas refuse until filled', () => {
		expect(AGUI_DEFAULT_SETTINGS).toEqual({ agentUrl: '', audience: '' })
		expect(AGUI_DEFAULT_SECRETS).toEqual({ jwtSecret: '' })
		expect(aguiSettingsSchema.safeParse(AGUI_DEFAULT_SETTINGS).success).toBe(false)
		expect(aguiSecretsSchema.safeParse(AGUI_DEFAULT_SECRETS).success).toBe(false)
	})
})
