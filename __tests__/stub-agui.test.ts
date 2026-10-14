import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { buildResumeArray, HttpAgent, type Message } from '@ag-ui/client'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { e2eEnv } from '@/e2e/fixtures/env'
import { handle } from '@/e2e/fixtures/stub/router'

let server: Server
let base: string

// The same ephemeral-port harness as __tests__/stub-router.test.ts.
beforeAll(async () => {
	server = createServer((req, res) => {
		handle(req, res, (server.address() as AddressInfo).port).catch(() => res.end())
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

/** A token as the hub mints it (Part 2 spec §2.3), with one claim or option changed per case. */
const token = async (
	over: {
		secret?: string
		audience?: string
		expiresAt?: number
		claims?: Record<string, unknown>
	} = {},
) => {
	const now = Math.floor(Date.now() / 1000)
	return new SignJWT({ auth_source: 'local', roles: ['owner'], ...over.claims })
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setSubject('e2e00000-0000-4000-8000-00000000beef')
		.setIssuer('nextjs-bff')
		.setAudience(over.audience ?? 'assistant')
		.setIssuedAt(now)
		.setExpirationTime(over.expiresAt ?? now + 60)
		.sign(new TextEncoder().encode(over.secret ?? e2eEnv.E2E_AGUI_JWT_SECRET))
}

/** A RunAgentInput for one user text; 2b's cases add the messages after it, the tools, the state or the resume. */
const input = (
	text: string,
	over: {
		threadId?: string
		after?: unknown[]
		tools?: unknown[]
		state?: unknown
		resume?: unknown[]
	} = {},
) => ({
	threadId: over.threadId ?? 'thread-1',
	runId: 'run-1',
	state: over.state ?? {},
	messages: [{ id: 'user-1', role: 'user', content: text }, ...(over.after ?? [])],
	tools: over.tools ?? [],
	context: [],
	forwardedProps: {},
	...(over.resume ? { resume: over.resume } : {}),
})

const post = (
	path: string,
	{ auth, body, contentType }: { auth?: string; body?: unknown; contentType?: string } = {},
) =>
	fetch(`${base}${path}`, {
		method: 'POST',
		headers: {
			'content-type': contentType ?? 'application/json',
			accept: 'text/event-stream',
			...(auth ? { authorization: `Bearer ${auth}` } : {}),
		},
		body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
	})

type Frame = { type: string; [key: string]: unknown }
const framesOf = async (response: Response): Promise<Frame[]> =>
	(await response.text())
		.split('\n\n')
		.filter(frame => frame.startsWith('data: '))
		.map(frame => JSON.parse(frame.slice(6)) as Frame)
/** The event types with repeats folded, so a streamed text reads as one CONTENT. */
const typesOf = (frames: Frame[]) =>
	frames.map(frame => frame.type).filter((type, index, all) => type !== all[index - 1])

const AGENT = '/agui/agents/assistant'

describe('the AG-UI stub agent (Part 2 spec §10)', () => {
	it('refuses a request without a valid token with 401, before anything else', async () => {
		const now = Math.floor(Date.now() / 1000)
		const refused = [
			undefined,
			await token({ secret: 'another-secret-another-secret-0000000000' }),
			await token({ expiresAt: now - 60 }),
			await token({ audience: 'someone-else' }),
			await token({ claims: { auth_source: undefined } }),
		]
		for (const auth of refused) {
			const response = await post(AGENT, { auth, body: input('hello') })
			expect(response.status).toBe(401)
			expect(response.headers.get('content-type')).toBe('application/json')
		}
		// The token first: an unknown agent without one is a 401 too.
		expect((await post('/agui/agents/missing', { body: input('hello') })).status).toBe(401)
	})

	it('answers 404 for an unknown agent and 415 for a body that is not JSON', async () => {
		const auth = await token()
		expect((await post('/agui/agents/missing', { auth, body: input('hello') })).status).toBe(404)
		expect((await post(AGENT, { auth, body: 'hello', contentType: 'text/plain' })).status).toBe(415)
	})

	it('answers 422 for Test connection’s {} and for the invalid scenario, before any stream', async () => {
		const auth = await token()
		const empty = await post(AGENT, { auth, body: {} })
		expect(empty.status).toBe(422)
		expect(empty.headers.get('content-type')).toBe('application/json')
		expect((await post(AGENT, { auth, body: input('please answer invalid') })).status).toBe(422)
	})

	it('streams the default scenario as a 1.0 run and records the caller', async () => {
		const response = await post(AGENT, { auth: await token(), body: input('hello') })
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		const frames = await framesOf(response)
		expect(typesOf(frames)).toEqual([
			'RUN_STARTED',
			'REASONING_START',
			'REASONING_MESSAGE_START',
			'REASONING_MESSAGE_CONTENT',
			'REASONING_MESSAGE_END',
			'REASONING_END',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'RUN_FINISHED',
		])
		expect(frames[0]).toMatchObject({
			threadId: 'thread-1',
			runId: 'run-1',
			protocolVersion: '1.0',
		})
		expect(frames.every(frame => typeof frame.timestamp === 'number')).toBe(true)
		const caller = await (await fetch(`${base}/agui/_caller`)).json()
		expect(caller).toEqual({
			sub: 'e2e00000-0000-4000-8000-00000000beef',
			auth_source: 'local',
			roles: ['owner'],
		})
	})

	it('is read by @ag-ui/client without a protocol error, scenario by scenario', async () => {
		const auth = await token()
		const runText = async (text: string) => {
			const seen: { errorCode?: string; custom?: { name: string; value: unknown } } = {}
			const agent = new HttpAgent({
				url: `${base}${AGENT}`,
				headers: { Authorization: `Bearer ${auth}` },
				threadId: `thread-${text}`,
				initialMessages: [{ id: `user-${text}`, role: 'user', content: text }],
			})
			const { newMessages } = await agent.runAgent(
				{ runId: `run-${text}` },
				{
					onRunErrorEvent: ({ event }) => {
						seen.errorCode = event.code
					},
					onCustomEvent: ({ event }) => {
						seen.custom = { name: event.name, value: event.value }
					},
				},
			)
			return { roles: newMessages.map((message: Message) => message.role), newMessages, seen }
		}
		expect((await runText('hello')).roles).toEqual(['reasoning', 'assistant'])
		const tool = await runText('use a tool')
		expect(tool.roles).toEqual(['assistant', 'tool', 'assistant'])
		const caller = tool.newMessages[0] as Extract<Message, { role: 'assistant' }>
		expect(caller.toolCalls?.[0]?.function.name).toBe('get_weather')
		// Any of the hub's five RUN_ERROR codes (Task 17 loops over them).
		for (const code of ['usage_limit', 'rate_limited', 'busy', 'model_unavailable', 'agent_error'])
			expect((await runText(`error ${code}`)).seen.errorCode).toBe(code)
		expect((await runText('timeout')).seen.custom).toEqual({
			name: 'run_cancelled',
			value: { reason: 'run_timeout' },
		})
	})

	it('records that a slow stream was closed early', async () => {
		const response = await post(AGENT, { auth: await token(), body: input('slow') })
		const reader = response.body!.getReader()
		const decoder = new TextDecoder()
		let read = ''
		while ((read.match(/TEXT_MESSAGE_CONTENT/g) ?? []).length < 3) {
			const chunk = await reader.read()
			if (chunk.done) break
			read += decoder.decode(chunk.value, { stream: true })
		}
		await reader.cancel()
		// The server sees the socket close on its next tick; one word interval is enough.
		await new Promise(resolve => setTimeout(resolve, 300))
		const slow = await (await fetch(`${base}/agui/_slow`)).json()
		expect(slow.closedEarly).toBe(true)
		expect(slow.words).toBeGreaterThanOrEqual(3)
		expect(slow.words).toBeLessThan(200)
	})

	it('leaves the Dify routes as they were', async () => {
		expect((await fetch(`${base}/v1/parameters`)).status).toBe(200)
	})
})

/** The hub's ask_user tool as a run advertises it (spec §6.2); the stub reads only its name. */
const ASK_USER_TOOL = {
	name: 'ask_user',
	description: 'Ask the user one or more questions.',
	parameters: { type: 'object' },
}
const APPROVAL_SCHEMA = {
	type: 'object',
	properties: {
		approved: { type: 'boolean' },
		editedArgs: { type: 'object' },
		reason: { type: 'string' },
	},
	required: ['approved'],
}

/** An assistant message as the hub stores a run's tool calls (AG-UI 1.0 `AssistantMessage.toolCalls`). */
const assistantWith = (...calls: { id: string; name: string; args: string }[]) => ({
	id: `assistant-${calls[0]?.id}`,
	role: 'assistant',
	toolCalls: calls.map(({ id, name, args }) => ({
		id,
		type: 'function',
		function: { name, arguments: args },
	})),
})
const deleteCall = (id: string, path: string) => ({
	id,
	name: 'delete_file',
	args: `{"path": "${path}"}`,
})

/** A 2b request with a fresh valid token, answered 200 with a stream. */
const runFrames = async (body: unknown) => {
	const response = await post(AGENT, { auth: await token(), body })
	expect(response.status).toBe(200)
	return framesOf(response)
}
const frameOf = (frames: Frame[], type: string) => frames.find(frame => frame.type === type)
const framesOfType = (frames: Frame[], type: string) => frames.filter(frame => frame.type === type)
/** The run's text, its deltas joined. */
const textOf = (frames: Frame[]) =>
	framesOfType(frames, 'TEXT_MESSAGE_CONTENT')
		.map(frame => frame.delta)
		.join('')
const outcomeOf = (frames: Frame[]) => frameOf(frames, 'RUN_FINISHED')?.outcome
const TEXT = ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END']
const CALL = ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END']

describe('the AG-UI stub agent’s human-in-the-loop scenarios (Part 2 spec §10, plan call P18)', () => {
	it('gated ends on Pydantic AI’s approval interrupt for its delete_file call', async () => {
		const frames = await runFrames(input('gated'))
		expect(typesOf(frames)).toEqual(['RUN_STARTED', ...TEXT, ...CALL, 'RUN_FINISHED'])
		const start = frameOf(frames, 'TOOL_CALL_START')!
		expect(start).toMatchObject({
			toolCallName: 'delete_file',
			parentMessageId: frameOf(frames, 'TEXT_MESSAGE_START')!.messageId,
		})
		expect(frameOf(frames, 'TOOL_CALL_ARGS')!.delta).toBe('{"path": "report.pdf"}')
		expect(outcomeOf(frames)).toEqual({
			type: 'interrupt',
			interrupts: [
				{
					id: `int-${start.toolCallId}`,
					reason: 'tool_call',
					message: 'Approve delete_file({"path": "report.pdf"})?',
					toolCallId: start.toolCallId,
					responseSchema: APPROVAL_SCHEMA,
				},
			],
		})
	})

	it('double ends on two approval interrupts, one per call, in call order', async () => {
		const frames = await runFrames(input('double'))
		const ids = framesOfType(frames, 'TOOL_CALL_START').map(frame => frame.toolCallId)
		expect(ids).toHaveLength(2)
		expect(outcomeOf(frames)).toMatchObject({
			type: 'interrupt',
			interrupts: [
				{
					id: `int-${ids[0]}`,
					toolCallId: ids[0],
					message: 'Approve delete_file({"path": "report.pdf"})?',
				},
				{
					id: `int-${ids[1]}`,
					toolCallId: ids[1],
					message: 'Approve delete_file({"path": "notes.txt"})?',
				},
			],
		})
	})

	it('a resumed approval answers the original call: approved, rejected with its reason, cancelled', async () => {
		const resumeGated = (entry: Record<string, unknown>) =>
			runFrames(
				input('gated', {
					after: [assistantWith(deleteCall('call-1', 'report.pdf'))],
					resume: [{ interruptId: 'int-call-1', ...entry }],
				}),
			)
		const approved = await resumeGated({ status: 'resolved', payload: { approved: true } })
		expect(typesOf(approved)).toEqual(['RUN_STARTED', 'TOOL_CALL_RESULT', ...TEXT, 'RUN_FINISHED'])
		expect(frameOf(approved, 'TOOL_CALL_RESULT')).toMatchObject({
			toolCallId: 'call-1',
			role: 'tool',
			content: 'Deleted report.pdf.',
		})
		expect(textOf(approved)).toBe('Done: report.pdf deleted.')
		const rejected = await resumeGated({
			status: 'resolved',
			payload: { approved: false, reason: 'Rejected by the user' },
		})
		expect(frameOf(rejected, 'TOOL_CALL_RESULT')?.content).toBe('Not deleted: Rejected by the user')
		expect(textOf(rejected)).toBe('Done: report.pdf kept.')
		const cancelled = await resumeGated({ status: 'cancelled' })
		expect(frameOf(cancelled, 'TOOL_CALL_RESULT')?.content).toBe('Not deleted: cancelled')
	})

	it('a resumed double answers both calls, and a resume that leaves one open is a RUN_ERROR', async () => {
		const after = [
			assistantWith(deleteCall('call-1', 'report.pdf'), deleteCall('call-2', 'notes.txt')),
		]
		const both = await runFrames(
			input('double', {
				after,
				resume: [
					{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
					{
						interruptId: 'int-call-2',
						status: 'resolved',
						payload: { approved: false, reason: 'Rejected by the user' },
					},
				],
			}),
		)
		expect(framesOfType(both, 'TOOL_CALL_RESULT').map(frame => frame.content)).toEqual([
			'Deleted report.pdf.',
			'Not deleted: Rejected by the user',
		])
		expect(textOf(both)).toBe('Done: report.pdf deleted, notes.txt kept.')
		const partial = await runFrames(
			input('double', {
				after,
				resume: [{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } }],
			}),
		)
		expect(typesOf(partial)).toEqual(['RUN_STARTED', 'RUN_ERROR'])
	})

	it('fragile refuses its first resume per thread with 422 before any stream, then answers it', async () => {
		const auth = await token()
		expect(outcomeOf(await runFrames(input('fragile')))).toMatchObject({ type: 'interrupt' })
		const resumeOn = (threadId: string) =>
			post(AGENT, {
				auth,
				body: input('fragile', {
					threadId,
					after: [assistantWith(deleteCall('call-1', 'report.pdf'))],
					resume: [{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } }],
				}),
			})
		const refused = await resumeOn('thread-fragile-1')
		expect(refused.status).toBe(422)
		expect(refused.headers.get('content-type')).toBe('application/json')
		const retried = await resumeOn('thread-fragile-1')
		expect(retried.status).toBe(200)
		expect(frameOf(await framesOf(retried), 'TOOL_CALL_RESULT')?.content).toBe(
			'Deleted report.pdf.',
		)
		// Another thread is refused once too.
		expect((await resumeOn('thread-fragile-2')).status).toBe(422)
	})

	it('question asks two questions through ask_user when it is offered, and says so when it is not', async () => {
		const frames = await runFrames(input('question', { tools: [ASK_USER_TOOL] }))
		expect(typesOf(frames)).toEqual(['RUN_STARTED', ...TEXT, ...CALL, 'RUN_FINISHED'])
		const start = frameOf(frames, 'TOOL_CALL_START')!
		expect(start.toolCallName).toBe('ask_user')
		expect(JSON.parse(String(frameOf(frames, 'TOOL_CALL_ARGS')!.delta))).toEqual({
			questions: [
				{ question: 'Which city?', options: ['Paris', 'Rome'] },
				{ question: 'Which month?' },
			],
		})
		// AG-UI 1.0 "Tool calls", Frontend tools: the success outcome names the call left pending.
		expect(outcomeOf(frames)).toEqual({ type: 'success', pendingToolCallIds: [start.toolCallId] })
		const unoffered = await runFrames(input('question'))
		expect(typesOf(unoffered)).toEqual(['RUN_STARTED', ...TEXT, 'RUN_FINISHED'])
		expect(textOf(unoffered)).toBe('No ask_user tool was offered, so I cannot ask you.')
	})

	it('badquestion calls ask_user with no questions', async () => {
		const frames = await runFrames(input('badquestion', { tools: [ASK_USER_TOOL] }))
		expect(frameOf(frames, 'TOOL_CALL_START')?.toolCallName).toBe('ask_user')
		expect(JSON.parse(String(frameOf(frames, 'TOOL_CALL_ARGS')!.delta))).toEqual({ questions: [] })
	})

	it('reads the answers to an ask_user call back, and says when the question was dismissed', async () => {
		const asked = assistantWith({ id: 'call-q', name: 'ask_user', args: '{"questions": []}' })
		const answered = await runFrames(
			input('question', {
				tools: [ASK_USER_TOOL],
				after: [
					asked,
					{
						id: 'tool-1',
						role: 'tool',
						toolCallId: 'call-q',
						content: 'Q: Which city?\nA: Paris\n\nQ: Which month?\nA: May',
					},
				],
			}),
		)
		expect(textOf(answered)).toBe(
			'Got your answers: Q: Which city? / A: Paris / Q: Which month? / A: May',
		)
		const dismissed = await runFrames(
			input('badquestion', {
				tools: [ASK_USER_TOOL],
				after: [
					asked,
					{
						id: 'tool-1',
						role: 'tool',
						toolCallId: 'call-q',
						content: 'The questions did not match the parameters of the ask_user tool.',
						error: 'invalid_arguments',
					},
				],
			}),
		)
		expect(textOf(dismissed)).toBe('The question was dismissed.')
	})

	it('form ends on the quarterly filing interrupt; its resume is filed or cancelled', async () => {
		const frames = await runFrames(input('form'))
		expect(outcomeOf(frames)).toEqual({
			type: 'interrupt',
			interrupts: [
				{
					id: expect.stringMatching(/^int-/),
					reason: 'input_required',
					message: 'Please provide the quarterly filing details.',
					responseSchema: {
						type: 'object',
						properties: {
							quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
							year: { type: 'integer', minimum: 2000 },
							revenue: { type: 'number' },
						},
						required: ['quarter', 'year', 'revenue'],
					},
				},
			],
		})
		const payload = { quarter: 'Q2', year: 2026, revenue: 1250 }
		const filed = await runFrames(
			input('form', { resume: [{ interruptId: 'int-form', status: 'resolved', payload }] }),
		)
		expect(textOf(filed)).toBe('Filed: {"quarter":"Q2","year":2026,"revenue":1250}')
		const cancelled = await runFrames(
			input('form', { resume: [{ interruptId: 'int-form', status: 'cancelled' }] }),
		)
		expect(textOf(cancelled)).toBe('The form was cancelled.')
	})

	it('confirm ends on a confirmation without a schema; its resume carries the boolean', async () => {
		const frames = await runFrames(input('confirm'))
		expect(outcomeOf(frames)).toEqual({
			type: 'interrupt',
			interrupts: [
				{
					id: expect.stringMatching(/^int-/),
					reason: 'confirmation',
					message: 'Archive the old reports?',
				},
			],
		})
		for (const answer of [true, false]) {
			const resumed = await runFrames(
				input('confirm', {
					resume: [{ interruptId: 'int-1', status: 'resolved', payload: answer }],
				}),
			)
			expect(textOf(resumed)).toBe(`Confirmed: ${answer}`)
		}
	})

	it('expired ends on an interrupt already past its expiresAt; its resume says it expired', async () => {
		const outcome = outcomeOf(await runFrames(input('expired'))) as {
			interrupts: { reason: string; expiresAt: string }[]
		}
		expect(outcome.interrupts).toHaveLength(1)
		expect(outcome.interrupts[0]?.reason).toBe('input_required')
		expect(Date.parse(outcome.interrupts[0]!.expiresAt)).toBeLessThan(Date.now())
		const resumed = await runFrames(
			input('expired', { resume: [{ interruptId: 'int-1', status: 'cancelled' }] }),
		)
		expect(textOf(resumed)).toBe('The request expired.')
	})

	it('plan sends its steps as a snapshot and two deltas; finish plan completes the state it is given', async () => {
		const plan = await runFrames(input('plan'))
		expect(typesOf(plan)).toEqual([
			'RUN_STARTED',
			'STATE_SNAPSHOT',
			'STATE_DELTA',
			...TEXT,
			'RUN_FINISHED',
		])
		expect(frameOf(plan, 'STATE_SNAPSHOT')?.snapshot).toEqual({
			steps: [
				{ description: 'Gather the sources', status: 'pending' },
				{ description: 'Draft the summary', status: 'pending' },
				{ description: 'Review the draft', status: 'pending' },
			],
		})
		expect(framesOfType(plan, 'STATE_DELTA')).toHaveLength(2)
		const finished = await runFrames(
			input('finish plan', {
				state: {
					note: 'kept',
					steps: [
						{ description: 'One', status: 'completed' },
						{ description: 'Two', status: 'in_progress' },
					],
				},
			}),
		)
		expect(frameOf(finished, 'STATE_SNAPSHOT')?.snapshot).toEqual({
			note: 'kept',
			steps: [
				{ description: 'One', status: 'completed' },
				{ description: 'Two', status: 'completed' },
			],
		})
		expect(textOf(finished)).toBe('Every step of the plan is done.')
	})

	it('activity sends a progress snapshot and three deltas, then text', async () => {
		const frames = await runFrames(input('activity'))
		expect(typesOf(frames)).toEqual([
			'RUN_STARTED',
			'ACTIVITY_SNAPSHOT',
			'ACTIVITY_DELTA',
			...TEXT,
			'RUN_FINISHED',
		])
		expect(frameOf(frames, 'ACTIVITY_SNAPSHOT')).toMatchObject({
			activityType: 'progress',
			content: { label: 'Indexing', done: 0, total: 3 },
		})
		expect(framesOfType(frames, 'ACTIVITY_DELTA').map(frame => frame.patch)).toEqual(
			[1, 2, 3].map(done => [{ op: 'replace', path: '/done', value: done }]),
		)
	})

	it('is read by @ag-ui/client without a protocol error, approval resume included', async () => {
		const auth = await token()
		const agentFor = (text: string) =>
			new HttpAgent({
				url: `${base}${AGENT}`,
				headers: { Authorization: `Bearer ${auth}` },
				threadId: `thread-client-${text}`,
				initialMessages: [{ id: `user-${text}`, role: 'user', content: text }],
			})
		// An approval and its resume on one agent, as the hub's runs continue a thread (spec §6.1).
		const gated = agentFor('gated')
		await gated.runAgent({ runId: 'run-gated-1' })
		expect(gated.pendingInterrupts).toHaveLength(1)
		const [interrupt] = gated.pendingInterrupts
		const { newMessages } = await gated.runAgent({
			runId: 'run-gated-2',
			resume: buildResumeArray(gated.pendingInterrupts, {
				[interrupt!.id]: { status: 'resolved', payload: { approved: true } },
			}),
		})
		expect(newMessages.map((message: Message) => message.role)).toEqual(['tool', 'assistant'])
		// The question's call, the plan's state after its deltas, the activity's content after its deltas.
		const question = agentFor('question')
		const asked = await question.runAgent({ runId: 'run-question', tools: [ASK_USER_TOOL] })
		const caller = asked.newMessages[0] as Extract<Message, { role: 'assistant' }>
		expect(caller.toolCalls?.[0]?.function.name).toBe('ask_user')
		const plan = agentFor('plan')
		await plan.runAgent({ runId: 'run-plan' })
		expect(plan.state).toEqual({
			steps: [
				{ description: 'Gather the sources', status: 'completed' },
				{ description: 'Draft the summary', status: 'in_progress' },
				{ description: 'Review the draft', status: 'pending' },
			],
		})
		const activity = await agentFor('activity').runAgent({ runId: 'run-activity' })
		expect(
			activity.newMessages.find((message: Message) => message.role === 'activity'),
		).toMatchObject({ activityType: 'progress', content: { label: 'Indexing', done: 3, total: 3 } })
	})
})
