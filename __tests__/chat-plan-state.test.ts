import { describe, expect, it } from 'vitest'

import { planOf, planProgress, planStepStatus, type PlanStep } from '@/lib/chat/plan-state'

const step = (status: string, description = `Step ${status}`): PlanStep => ({ description, status })

// Spec §6.4: the Dojo's agentic_generative_ui and Pydantic AI's example shape, read with zod.
describe('planOf', () => {
	it('reads the steps, dropping keys beside them', () => {
		expect(
			planOf({
				steps: [
					{ description: 'Search flights', status: 'completed', id: 's1' },
					{ description: 'Book a hotel', status: 'pending' },
				],
				recipe: { title: 'Tea' },
			}),
		).toEqual([
			{ description: 'Search flights', status: 'completed' },
			{ description: 'Book a hotel', status: 'pending' },
		])
	})
	it('reads any status string; the panel maps the ones it knows', () => {
		expect(planOf({ steps: [step('enabled')] })).toEqual([step('enabled')])
	})
	it.each([
		['no state', undefined],
		['null', null],
		['an array', [step('pending')]],
		['a string', 'steps'],
		['state of another shape', { recipe: { title: 'Tea' } }],
		['no steps', { steps: [] }],
		['steps that are not a list', { steps: 'Search flights' }],
		['a step without a status', { steps: [{ description: 'Search flights' }] }],
		[
			'a step whose description is not a string',
			{ steps: [{ description: 1, status: 'pending' }] },
		],
		['a step that is not an object', { steps: ['Search flights'] }],
	])('answers null for %s', (_label, state) => {
		expect(planOf(state)).toBeNull()
	})
})

// 2b's plan call P17: the template's four statuses as antd Steps' four.
describe('planStepStatus', () => {
	it.each([
		['pending', 'wait'],
		['in_progress', 'process'],
		['completed', 'finish'],
		['blocked', 'error'],
	])('shows %s as %s', (status, shown) => {
		expect(planStepStatus(status)).toBe(shown)
	})
	it.each(['enabled', 'executing', 'Completed', '', 'toString', '__proto__'])(
		'shows any other status (%j) as wait',
		status => {
			expect(planStepStatus(status)).toBe('wait')
		},
	)
})

describe('planProgress', () => {
	it('counts the completed steps for "Plan 2/5", with the percent rounded', () => {
		expect(
			planProgress([
				step('completed'),
				step('completed'),
				step('in_progress'),
				step('blocked'),
				step('pending'),
			]),
		).toEqual({ done: 2, total: 5, percent: 40, complete: false })
		expect(planProgress([step('completed'), step('pending'), step('pending')]).percent).toBe(33)
		expect(planProgress([step('completed'), step('completed'), step('pending')]).percent).toBe(67)
	})
	// Spec §6.4: the panel collapses once every step is completed; a blocked step keeps it open.
	it('is complete once every step is completed', () => {
		expect(planProgress([step('completed'), step('completed')])).toEqual({
			done: 2,
			total: 2,
			percent: 100,
			complete: true,
		})
		expect(planProgress([step('completed'), step('blocked')]).complete).toBe(false)
	})
	it('answers nothing done and nothing complete for no steps', () => {
		expect(planProgress([])).toEqual({ done: 0, total: 0, percent: 0, complete: false })
	})
})
