import { describe, expect, it } from 'vitest'

import { supportsAnnotations } from '@/components/admin/apps/admin-app-row'

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
