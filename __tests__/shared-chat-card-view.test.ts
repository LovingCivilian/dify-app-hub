import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import {
	answeredBadge,
	CARD_BADGES,
	draftTagColor,
	interruptIcon,
	openInterruptBadge,
	planBadge,
} from '@/components/shared-chat/chat-card-view'
import en from '@/locales/en/translation.json'

/** A dotted key's value in the English file, or undefined. */
const english = (key: string): unknown =>
	key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

const NOW = new Date('2026-10-15T12:00:00Z')

/** An approval for a call the turn does not hold (plan call P8): its own card. */
const unbound: Interrupt = {
	id: 'int-1',
	reason: 'tool_call',
	toolCallId: 'call-x',
	responseSchema: {
		type: 'object',
		properties: { accepted: { type: 'boolean' } },
		required: ['accepted'],
	},
}
const confirm: Interrupt = { id: 'int-2', reason: 'confirmation', message: 'Proceed?' }
const form: Interrupt = {
	id: 'int-3',
	reason: 'input_required',
	responseSchema: { type: 'object', properties: { region: { type: 'string' } } },
}
/** A reason the hub does not know, without a schema: it can only be cancelled (plan call P8). */
const other: Interrupt = { id: 'int-4', reason: 'policy_hold', message: 'On hold.' }

describe('interruptIcon (the interrupt card’s header icon, by how it is answered)', () => {
	it('marks a form, a confirmation and an unbound approval each with their own icon', () => {
		expect(interruptIcon(form)).toBe('form')
		expect(interruptIcon(confirm)).toBe('confirm')
		expect(interruptIcon(unbound)).toBe('approval')
	})

	it('marks anything else as information: an unknown reason, or a schema that is no flat form', () => {
		expect(interruptIcon(other)).toBe('other')
		expect(
			interruptIcon({
				id: 'int-5',
				reason: 'input_required',
				responseSchema: { type: 'object', properties: { nested: { type: 'object' } } },
			}),
		).toBe('other')
	})
})

describe('openInterruptBadge (an open interrupt’s card)', () => {
	it('waits for the user until the interrupt expires', () => {
		expect(openInterruptBadge(confirm, NOW)).toBe('waiting')
		expect(openInterruptBadge({ ...confirm, expiresAt: '2026-10-15T13:00:00Z' }, NOW)).toBe(
			'waiting',
		)
		expect(openInterruptBadge({ ...confirm, expiresAt: '2026-10-15T11:00:00Z' }, NOW)).toBe(
			'expired',
		)
	})
})

describe('answeredBadge (an answered interrupt’s card, by its receipt)', () => {
	it('shows an unbound approval’s decision, Cancelled, and Answered for anything else', () => {
		expect(answeredBadge('approved')).toBe('approved')
		expect(answeredBadge('rejected')).toBe('rejected')
		expect(answeredBadge('cancelled')).toBe('cancelled')
		// A confirmation reads Answered in the header; its receipt says Yes or No.
		expect(answeredBadge('yes')).toBe('answered')
		expect(answeredBadge('no')).toBe('answered')
		expect(answeredBadge('answered')).toBe('answered')
		// A form's answer reads Submitted, in the header as in its receipt (the owner, 2026-10-15: "make it submitted").
		expect(answeredBadge('submitted')).toBe('submitted')
	})
})

describe('planBadge (the plan panel’s header)', () => {
	it('shows the progress while a step is left, and Completed once every step is', () => {
		expect(planBadge({ complete: false })).toBe('progress')
		expect(planBadge({ complete: true })).toBe('completed')
	})
})

describe('draftTagColor (a drafted decision’s Tag in an open interrupt’s card)', () => {
	it('colours each decision as the tool card and the receipts do', () => {
		expect(draftTagColor('shared_chat.answer.approved')).toBe('success')
		expect(draftTagColor('shared_chat.answer.rejected')).toBe('error')
		expect(draftTagColor('shared_chat.answer.cancelled')).toBe('default')
		expect(draftTagColor('shared_chat.answer.submitted')).toBe('success')
		expect(draftTagColor('shared_chat.interrupt.yes')).toBe('success')
		expect(draftTagColor('shared_chat.interrupt.no')).toBe('error')
	})
})

describe('CARD_BADGES', () => {
	it('words every badge through an English key, in antd Tag’s preset status colours', () => {
		for (const { key } of Object.values(CARD_BADGES))
			expect(english(key)).toEqual(expect.any(String))
		expect(
			Object.fromEntries(Object.entries(CARD_BADGES).map(([badge, { color }]) => [badge, color])),
		).toEqual({
			waiting: 'warning',
			expired: 'warning',
			answered: 'success',
			submitted: 'success',
			approved: 'success',
			rejected: 'error',
			cancelled: 'default',
			progress: 'processing',
			completed: 'success',
		})
	})

	it('reuses the existing words, with two new keys for the waiting card and the plan’s progress', () => {
		expect(CARD_BADGES.waiting.key).toBe('shared_chat.interrupt.waiting')
		expect(CARD_BADGES.expired.key).toBe('shared_chat.answer.expired')
		expect(CARD_BADGES.answered.key).toBe('shared_chat.answer.answered')
		expect(CARD_BADGES.cancelled.key).toBe('shared_chat.answer.cancelled')
		expect(CARD_BADGES.progress.key).toBe('shared_chat.plan.progress')
		expect(CARD_BADGES.completed.key).toBe('shared_chat.tool_status.completed')
		expect(english('shared_chat.plan.progress')).toBe('{{done}}/{{total}}')
		expect(english('shared_chat.plan.label')).toBe('Plan')
	})
})
