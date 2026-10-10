import { describe, expect, it } from 'vitest'

import { accessSummary, supportsAnnotations } from '@/components/admin/apps/admin-app-row'

describe('supportsAnnotations', () => {
	it('is true for the modes Dify documents annotations for', () => {
		expect(supportsAnnotations('chat')).toBe(true)
		expect(supportsAnnotations('advanced-chat')).toBe(true)
		expect(supportsAnnotations('agent-chat')).toBe(true)
	})
	it('is false for workflow, completion, the new agent app and no mode', () => {
		expect(supportsAnnotations('workflow')).toBe(false)
		expect(supportsAnnotations('completion')).toBe(false)
		expect(supportsAnnotations('agent')).toBe(false)
		expect(supportsAnnotations(null)).toBe(false)
	})
})

describe('accessSummary (spec §4.4: the table tag)', () => {
	it('says everyone, admins only, or how many groups and people', () => {
		expect(accessSummary({ mode: 'everyone', groupIds: ['g1'], userIds: [] })).toEqual({
			kind: 'everyone',
		})
		expect(accessSummary({ mode: 'restricted', groupIds: [], userIds: [] })).toEqual({
			kind: 'admins_only',
		})
		expect(accessSummary({ mode: 'restricted', groupIds: ['g1', 'g2'], userIds: ['u1'] })).toEqual({
			kind: 'restricted',
			groups: 2,
			people: 1,
		})
	})
})
