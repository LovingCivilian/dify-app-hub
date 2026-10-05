import { describe, expect, it } from 'vitest'

import { runScenario } from '@/e2e/fixtures/stub/scenarios'
import {
	displayRunWorkflow,
	initialRunState,
	reduceRunEvent,
	type RunState,
} from '@/components/chat/hooks/run-reducer'
import { parseEvent } from '@/components/chat/provider/dify-chat-provider'
import type { DifyStreamEvent } from '@/components/chat/provider/message'

const base = { task_id: 't', message_id: 'm', conversation_id: '', created_at: 1 }

describe('reduceRunEvent', () => {
	it('tracks nodes, appends text chunks and finishes with outputs', () => {
		let s = reduceRunEvent(initialRunState, {
			event: 'workflow_started',
			workflow_run_id: 'run-1',
			data: { id: 'run-1' },
			...base,
		})
		s = reduceRunEvent(s, {
			event: 'node_started',
			workflow_run_id: 'run-1',
			data: { id: 'n1', node_id: 'llm', node_type: 'llm', title: 'Answer' },
			...base,
		})
		s = reduceRunEvent(s, {
			event: 'text_chunk',
			workflow_run_id: 'run-1',
			data: { text: 'A short ' },
			...base,
		})
		s = reduceRunEvent(s, {
			event: 'text_chunk',
			workflow_run_id: 'run-1',
			data: { text: 'note.' },
			...base,
		})
		s = reduceRunEvent(s, {
			event: 'workflow_finished',
			workflow_run_id: 'run-1',
			data: {
				id: 'run-1',
				status: 'succeeded',
				outputs: { text: 'A short note.' },
				files: null,
				error: null,
			},
			...base,
		})
		expect(s).toMatchObject({
			status: 'finished',
			runId: 'run-1',
			taskId: 't',
			text: 'A short note.',
			outputs: { text: 'A short note.' },
		})
		expect(s.workflow?.nodes).toHaveLength(1)
	})
	it('handles completion apps through message and message_end', () => {
		let s = reduceRunEvent(initialRunState, { event: 'message', answer: 'Hel', ...base })
		s = reduceRunEvent(s, { event: 'message', answer: 'lo', ...base })
		s = reduceRunEvent(s, { event: 'message_end', ...base })
		expect(s).toMatchObject({ status: 'finished', text: 'Hello' })
	})
	it('records a failed run and a stream error', () => {
		expect(
			reduceRunEvent(initialRunState, {
				event: 'workflow_finished',
				workflow_run_id: 'r',
				data: { id: 'r', status: 'failed', outputs: null, error: 'boom' },
				...base,
			}),
		).toMatchObject({ status: 'failed', error: 'boom' })
		expect(
			reduceRunEvent(initialRunState, {
				event: 'error',
				code: 'x',
				message: 'bad',
				status: 500,
				...base,
			}),
		).toMatchObject({ status: 'failed', error: 'bad' })
	})
})

/** Feeds a stub stream through the same parse step the hook uses (the `data:` payloads as text). */
const replay = (events: Array<Record<string, unknown>>, from: RunState = initialRunState) =>
	events.reduce<RunState>((state, raw) => {
		const event = parseEvent(JSON.stringify(raw))
		return event ? reduceRunEvent(state, event) : state
	}, from)

const ctx = {
	base: { task_id: 't1', message_id: 'm1', conversation_id: '', created_at: 1_700_000_000 },
	runId: 'run-1',
	formToken: '',
	fileUrl: 'http://127.0.0.1:5399/files/stub-image.png',
}

describe('reduceRunEvent on the stub streams', () => {
	it('folds the workflow run: two finished nodes, the text, the outputs and the generated file', () => {
		const state = replay(runScenario('workflow', { topic: 'tea' }, ctx))
		expect(state).toMatchObject({
			status: 'finished',
			runId: 'run-1',
			taskId: 't1',
			text: 'A short note about tea.',
			outputs: { text: 'A short note about tea.' },
		})
		expect(state.workflow?.status).toBe('finished')
		expect(state.workflow?.nodes.map(n => [n.title, n.status])).toStrictEqual([
			['Start', 'success'],
			['Answer', 'success'],
		])
		// WorkflowFinishedData.files items are free-form; the stub's follows the message_end file shape.
		expect(state.files).toStrictEqual([
			{
				id: 'file-m1',
				type: 'image',
				url: ctx.fileUrl,
				belongsTo: 'assistant',
				filename: 'stub-image.png',
				size: expect.any(Number),
				mimeType: 'image/png',
			},
		])
	})

	it('folds the completion stream into the generated text', () => {
		expect(replay(runScenario('completion', { topic: 'tea' }, ctx))).toMatchObject({
			status: 'finished',
			text: 'A short note about tea.',
		})
	})

	it('ends a failed workflow run as failed with the error, its failed node kept', () => {
		const state = replay(runScenario('workflow', { topic: 'error' }, ctx))
		expect(state).toMatchObject({ status: 'failed', error: 'The model is unavailable.' })
		expect(state.workflow?.status).toBe('failed')
		expect(state.workflow?.nodes.map(n => n.status)).toStrictEqual(['success', 'error'])
	})

	it('ends a completion that streams an error event as failed with its message', () => {
		expect(replay(runScenario('completion', { topic: 'error' }, ctx))).toMatchObject({
			status: 'failed',
			error: 'The model is unavailable.',
		})
	})
})

describe('reduceRunEvent edge cases', () => {
	const running: RunState = { ...initialRunState, status: 'running', text: 'partial' }

	it('ignores junk: unparsable chunks never reach it, unknown events leave the state as it is', () => {
		for (const data of ['[DONE]', '', 'not json {', '[]', '{"no":"event"}', 'null', undefined]) {
			expect(parseEvent(data)).toBeNull()
		}
		for (const event of [
			'ping',
			'tts_message',
			'tts_message_end',
			'iteration_started',
			'agent_log',
		]) {
			expect(reduceRunEvent(running, { event, ...base })).toBe(running)
		}
	})

	it('reads only the text of a text_chunk and only object outputs and file lists', () => {
		expect(reduceRunEvent(running, { event: 'text_chunk', ...base }).text).toBe('partial')
		expect(reduceRunEvent(running, { event: 'text_chunk', data: { text: 42 }, ...base }).text).toBe(
			'partial',
		)
		expect(reduceRunEvent(running, { event: 'text_chunk', data: 'x', ...base }).text).toBe(
			'partial',
		)
		const finished = reduceRunEvent(running, {
			event: 'workflow_finished',
			data: { status: 'succeeded', outputs: ['not', 'a', 'record'], files: 'nope' },
			...base,
		})
		expect(finished).toMatchObject({ status: 'finished', text: 'partial', files: [] })
		expect(finished.outputs).toBeUndefined()
	})

	it("takes a single string output as the result (it is final; text chunks may be partial, as in Dify's example)", () => {
		const state = reduceRunEvent(
			{ ...running, text: 'Bonjour' },
			{
				event: 'workflow_finished',
				data: { status: 'succeeded', outputs: { result: 'Bonjour le monde' } },
				...base,
			},
		)
		expect(state.text).toBe('Bonjour le monde')
	})

	it('keeps the streamed text when the outputs are several values or not a string', () => {
		const several = reduceRunEvent(running, {
			event: 'workflow_finished',
			data: { status: 'succeeded', outputs: { a: 'x', b: 'y' } },
			...base,
		})
		expect(several).toMatchObject({ text: 'partial', outputs: { a: 'x', b: 'y' } })
		const numeric = reduceRunEvent(running, {
			event: 'workflow_finished',
			data: { status: 'succeeded', outputs: { n: 3 } },
			...base,
		})
		expect(numeric.text).toBe('partial')
	})

	it('maps a run Dify reports as stopped to stopped, and a failed status without text to failed', () => {
		expect(
			reduceRunEvent(running, {
				event: 'workflow_finished',
				data: { status: 'stopped', outputs: null },
				...base,
			}).status,
		).toBe('stopped')
		expect(
			reduceRunEvent(running, {
				event: 'workflow_finished',
				data: { status: 'failed', outputs: null, error: null },
				...base,
			}),
		).toMatchObject({ status: 'failed', error: '' })
	})

	it("keeps an earlier error text when an error event has none (the view shows the generic text for '')", () => {
		const failed = reduceRunEvent(running, {
			event: 'workflow_finished',
			data: { status: 'failed', outputs: null, error: 'boom' },
			...base,
		})
		expect(reduceRunEvent(failed, { event: 'error', ...base })).toMatchObject({
			status: 'failed',
			error: 'boom',
		})
		expect(reduceRunEvent(running, { event: 'error', message: 42, ...base })).toMatchObject({
			status: 'failed',
			error: '',
		})
	})

	it('folds message_replace and message_file of completion apps', () => {
		let s = reduceRunEvent(running, { event: 'message_replace', answer: 'Replaced', ...base })
		expect(s.text).toBe('Replaced')
		s = reduceRunEvent(s, {
			event: 'message_file',
			id: 'f1',
			type: 'image',
			url: 'https://x/y.png',
			belongs_to: 'assistant',
			...base,
		})
		expect(s.files).toStrictEqual([
			{ id: 'f1', type: 'image', url: 'https://x/y.png', belongsTo: 'assistant' },
		])
	})

	it('changes nothing once the run was stopped: no later chunk renders', () => {
		const stopped: RunState = { ...running, status: 'stopped' }
		const late: DifyStreamEvent[] = [
			{ event: 'text_chunk', data: { text: ' more' }, ...base },
			{ event: 'message', answer: ' more', ...base },
			{ event: 'node_started', data: { id: 'n2', title: 'Late' }, ...base },
			{ event: 'workflow_finished', data: { status: 'succeeded', outputs: { a: 'b' } }, ...base },
			{ event: 'error', message: 'late', ...base },
		]
		for (const event of late) expect(reduceRunEvent(stopped, event)).toBe(stopped)
	})

	it('keeps a finished or failed run final when node events trail it', () => {
		const failed: RunState = { ...running, status: 'failed', error: 'boom' }
		expect(
			reduceRunEvent(failed, { event: 'text_chunk', data: { text: '!' }, ...base }).status,
		).toBe('failed')
	})

	it('records a paused run (Dify closes the stream after workflow_paused)', () => {
		const s = replay([
			{ event: 'workflow_started', workflow_run_id: 'r', data: { id: 'r' }, ...base },
			{ event: 'workflow_paused', workflow_run_id: 'r', data: { status: 'paused' }, ...base },
		])
		expect(s.workflow?.status).toBe('paused')
	})
})

describe('displayRunWorkflow', () => {
	const workflow = replay([
		{ event: 'workflow_started', workflow_run_id: 'r', data: { id: 'r' }, ...base },
		{ event: 'node_started', workflow_run_id: 'r', data: { id: 'n1', title: 'Answer' }, ...base },
	]).workflow

	it('shows the run as it streams', () => {
		expect(displayRunWorkflow({ ...initialRunState, status: 'running', workflow })).toBe(workflow)
	})

	it('stops the spinner once the run has ended without workflow_finished (stopped, failed, stream closed)', () => {
		for (const status of ['stopped', 'failed', 'finished'] as const) {
			const shown = displayRunWorkflow({ ...initialRunState, status, workflow })
			expect(shown?.status).toBe('failed')
			expect(shown?.nodes.map(n => n.status)).toStrictEqual(['error'])
		}
		// The run's own state is not changed.
		expect(workflow?.nodes[0].status).toBe('running')
	})

	it('leaves a finished or paused run alone', () => {
		const finished = { ...workflow!, status: 'finished' as const }
		expect(displayRunWorkflow({ ...initialRunState, status: 'finished', workflow: finished })).toBe(
			finished,
		)
		const paused = { ...workflow!, status: 'paused' as const }
		expect(displayRunWorkflow({ ...initialRunState, status: 'finished', workflow: paused })).toBe(
			paused,
		)
	})
})
