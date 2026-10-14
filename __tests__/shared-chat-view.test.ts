import type { Interrupt } from '@ag-ui/core'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { toBubbleItems } from '@/components/shared-chat/bubble-items'
import {
	AGENT_ERROR_CODES,
	HUB_ERROR_CODES,
	requestFailureText,
	runErrorView,
	stoppedCaptionKey,
} from '@/components/shared-chat/run-error'
import {
	groupParts,
	inputHint,
	prettyJson,
	standaloneInterrupts,
} from '@/components/shared-chat/turn-parts'
import { emptyAssistantTurn, userTurn, type Turn, type TurnPart } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'
import en from '@/locales/en/translation.json'

const t = ((key: string) => `t:${key}`) as unknown as TFunction

/** A dotted key's value in the English file, or undefined. */
const english = (key: string): unknown =>
	key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

describe('runErrorView (spec §5.3, §8)', () => {
	it.each([...AGENT_ERROR_CODES])('titles the agent code %s and shows its message', code => {
		expect(runErrorView({ code, message: 'Safe to show.' })).toEqual({
			titleKey: `shared_chat.error.${code}`,
			description: 'Safe to show.',
		})
	})
	it.each([...HUB_ERROR_CODES])('titles the hub code %s and never shows its text', code => {
		const view = runErrorView({ code, message: 'English from the hub' })
		expect(view.description).toBeUndefined()
		expect(english(view.titleKey)).toEqual(expect.any(String))
	})
	// A message over the length limit answers invalid_param (the Sender has no cap): its own title, not "could not answer".
	it('titles invalid_param as a message that could not be sent', () => {
		expect(runErrorView({ code: 'invalid_param', message: 'too long' })).toEqual({
			titleKey: 'shared_chat.error.invalid_param',
		})
	})
	it('gives any other code, or none, the generic title with the message', () => {
		expect(runErrorView({ code: 'quota_gone', message: 'Out of credits.' })).toEqual({
			titleKey: 'shared_chat.error.generic',
			description: 'Out of credits.',
		})
		expect(runErrorView({ message: '' })).toEqual({
			titleKey: 'shared_chat.error.generic',
			description: undefined,
		})
	})
	it('names only keys the English file has', () => {
		for (const code of [...AGENT_ERROR_CODES, ...HUB_ERROR_CODES, 'other'])
			expect(english(runErrorView({ code, message: '' }).titleKey)).toEqual(expect.any(String))
	})
})

describe('requestFailureText', () => {
	it('words a hub code and falls back for anything else', () => {
		expect(
			requestFailureText(new RequestError(404, 'conversation_not_found', 'x'), t, 'fallback'),
		).toBe('t:shared_chat.error.conversation_not_found')
		expect(requestFailureText(new RequestError(500, 'internal_error', 'x'), t, 'fallback')).toBe(
			'fallback',
		)
		expect(requestFailureText(new TypeError('Failed to fetch'), t)).toBe('')
	})
})

describe('stoppedCaptionKey', () => {
	const ended = (run: Turn['runs'][number]): Turn => ({ ...emptyAssistantTurn(), runs: [run] })
	it('says Stopped for a cancelled or truncated last run, and the time limit when the agent hit it', () => {
		expect(stoppedCaptionKey(ended({ runId: 'r1', outcome: 'cancelled' }))).toBe('chat.stopped')
		expect(stoppedCaptionKey(ended({ runId: 'r1', outcome: 'truncated' }))).toBe('chat.stopped')
		expect(
			stoppedCaptionKey(
				ended({ runId: 'r1', outcome: 'cancelled', cancelledReason: 'run_timeout' }),
			),
		).toBe('shared_chat.stopped_time_limit')
	})
	it('says nothing for a finished, failed, interrupted or running run', () => {
		for (const outcome of ['success', 'error', 'interrupt', 'running'] as const)
			expect(stoppedCaptionKey(ended({ runId: 'r1', outcome }))).toBeUndefined()
		expect(stoppedCaptionKey(emptyAssistantTurn())).toBeUndefined()
	})
})

describe('turn parts', () => {
	const tool = (id: string): TurnPart => ({
		kind: 'tool',
		toolCallId: id,
		name: 'search',
		args: '{}',
		status: 'done',
	})
	it('groups consecutive tool calls into one chain and keeps arrival order', () => {
		const text: TurnPart = { kind: 'text', messageId: 'm1', text: 'Looking.' }
		const after: TurnPart = { kind: 'text', messageId: 'm2', text: 'Found it.' }
		expect(groupParts([text, tool('c1'), tool('c2'), after, tool('c3')])).toEqual([
			text,
			{ kind: 'tools', key: 'c1', tools: [tool('c1'), tool('c2')] },
			after,
			{ kind: 'tools', key: 'c3', tools: [tool('c3')] },
		])
	})
	it('hints at the input on one line, at most 60 characters', () => {
		expect(inputHint('{\n  "city": "Paris"\n}')).toBe('{ "city": "Paris" }')
		expect(inputHint('x'.repeat(70))).toBe(`${'x'.repeat(60)}…`)
	})
	it('pretty-prints JSON and keeps any other text', () => {
		expect(prettyJson('{"city":"Paris"}')).toBe('{\n  "city": "Paris"\n}')
		expect(prettyJson('{"city":')).toBe('{"city":')
		expect(prettyJson('18 °C')).toBe('18 °C')
	})
})

describe('toBubbleItems', () => {
	it('does not show the loading dots for an answer that only interrupts', () => {
		const interrupted: Turn = {
			...emptyAssistantTurn(),
			interrupts: [{ id: 'i1', reason: 'tool_calls' } as Turn['interrupts'][number]],
		}
		expect(toBubbleItems([{ id: 'a', message: interrupted, status: 'loading' }])[0]).toMatchObject({
			loading: false,
		})
	})
	it('shows the loading dots only for an empty placeholder and streams while updating', () => {
		const answer: Turn = {
			...emptyAssistantTurn(),
			parts: [{ kind: 'text', messageId: 'm1', text: 'Hi' }],
		}
		expect(
			toBubbleItems([
				{ id: 'u', message: userTurn('local', 'hi'), status: 'local' },
				{ id: 'a', message: emptyAssistantTurn(), status: 'loading' },
				{ id: 'b', message: answer, status: 'updating' },
			]),
		).toEqual([
			{
				key: 'u',
				role: 'user',
				content: userTurn('local', 'hi'),
				loading: false,
				streaming: false,
				status: 'local',
			},
			{
				key: 'a',
				role: 'assistant',
				content: emptyAssistantTurn(),
				loading: true,
				streaming: false,
				status: 'loading',
			},
			{
				key: 'b',
				role: 'assistant',
				content: answer,
				loading: false,
				streaming: true,
				status: 'updating',
			},
		])
	})
})

describe('standaloneInterrupts (spec §6.3, plan call P8)', () => {
	const call = (id: string): TurnPart => ({
		kind: 'tool',
		toolCallId: id,
		name: 'delete_file',
		args: '{}',
		status: 'waiting',
	})
	const approval: Interrupt = { id: 'i1', reason: 'tool_call', toolCallId: 'c1' }
	const elsewhere: Interrupt = { id: 'i2', reason: 'tool_call', toolCallId: 'c9' }
	const unbound: Interrupt = { id: 'i3', reason: 'tool_call' }
	const input: Interrupt = { id: 'i4', reason: 'input_required', message: 'Which city?' }
	const confirm: Interrupt = { id: 'i5', reason: 'confirmation', toolCallId: 'c1' }
	it("leaves an approval to its own call's card and keeps every other interrupt in order", () => {
		expect(
			standaloneInterrupts([call('c1')], [approval, elsewhere, unbound, input, confirm]),
		).toEqual([elsewhere, unbound, input, confirm])
	})
	it('keeps an approval as its own card when the turn holds no such call', () => {
		expect(standaloneInterrupts([], [approval])).toEqual([approval])
		expect(standaloneInterrupts([call('c2')], [approval])).toEqual([approval])
	})
	it('shows nothing when nothing is open', () => {
		expect(standaloneInterrupts([call('c1')], [])).toEqual([])
	})
})

describe('toBubbleItems with a waiting call (plan call P9)', () => {
	it('does not show the loading dots for an answer whose only part waits for an answer', () => {
		const asking: Turn = {
			...emptyAssistantTurn(),
			parts: [{ kind: 'tool', toolCallId: 'c1', name: 'ask_user', args: '{}', status: 'waiting' }],
		}
		expect(toBubbleItems([{ id: 'a', message: asking, status: 'loading' }])[0]).toMatchObject({
			loading: false,
		})
	})
})
