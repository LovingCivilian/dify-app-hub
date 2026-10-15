import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { EventType, type Event, type Interrupt, type RunFinishedOutcome } from '@ag-ui/core'
import { RunAgentInputSchema } from '@ag-ui/core/schemas'
import { EventEncoder } from '@ag-ui/encoder'
import { jwtVerify } from 'jose'
import type * as z from 'zod'

import { e2eEnv } from '../env'
import { STUB_AGUI_AGENT, STUB_AGUI_AUDIENCE } from './agui-apps'
import { hasWord } from './scenarios'

/*
 * A spec-level AG-UI 1.0 producer for the e2e suite (Part 2 spec §10: "the second producer decision 7 asks for"; the
 * spike's Appendix B grown up). It checks the hub's JWT as the owner's agent service does (spec §2.3; decision 45) and
 * refuses a bad request with a plain HTTP status before any stream ("Input rejected before the run starts — malformed
 * JSON, failed validation, refused auth — is an HTTP error status with no event stream", AG-UI 1.0 HTTP + SSE binding,
 * Errors). Scenarios are picked by the last user text, as the Dify stub's are: the default (reasoning and Markdown
 * text), `tool`, `nested`, `error <code>`, `timeout`, `slow` and `invalid`; 2b's human-in-the-loop scenarios (HITL_KEYWORDS) are
 * checked first.
 */

/** lib/env.ts's AGENT_JWT_ISSUER default: the e2e `next dev` sets none, so the hub signs with it. */
const ISSUER = 'nextjs-bff'
/** The owner's service allows 10 s of clock skew (spec §2.3). */
const CLOCK_TOLERANCE_SECONDS = 10
const WORD_DELAY_MS = 20
/** One word every 100 ms, long enough for Stop to land mid-stream. */
const SLOW_WORD_DELAY_MS = 100
const SLOW_WORDS = 200

const AGENT_PATH = /^\/agui\/agents\/([^/]+)$/

/** Whether the last slow stream was closed by the client before its end, and how many words it wrote (the Stop check). */
let slow = { closedEarly: false, words: 0 }
/** The claims of the last run whose token passed, so a spec can check what the hub sent (spec §2.3's identity). */
let lastCaller: { sub: string; auth_source: string; roles: string[] } | null = null

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(body))
}
/** A refusal as a FastAPI service words it (`{ detail }`); the hub reads none of it (spec §2.4). */
const refuse = (res: ServerResponse, status: number, detail: string) =>
	json(res, status, { detail })

const readBody = (req: IncomingMessage) =>
	new Promise<string>(resolve => {
		const parts: Buffer[] = []
		req.on('data', (chunk: Buffer) => parts.push(chunk))
		req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
		req.on('error', () => resolve(Buffer.concat(parts).toString('utf8')))
	})

/**
 * The owner's contract (spec §2.3): HS256 with the app's secret as UTF-8 bytes (jose's symmetric-secret example), the
 * issuer and the audience, `exp` within 10 s of tolerance, a subject, `auth_source` `local` or `ldap`, `roles` strings.
 */
const verifyCaller = async (authorization: string | undefined) => {
	const jwt = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
	if (!jwt) return null
	try {
		const { payload } = await jwtVerify(jwt, new TextEncoder().encode(e2eEnv.E2E_AGUI_JWT_SECRET), {
			algorithms: ['HS256'],
			issuer: ISSUER,
			audience: STUB_AGUI_AUDIENCE,
			clockTolerance: CLOCK_TOLERANCE_SECONDS,
			requiredClaims: ['sub', 'iat', 'exp'],
		})
		const { sub, auth_source: source, roles } = payload
		if (typeof sub !== 'string' || (source !== 'local' && source !== 'ldap')) return null
		if (!Array.isArray(roles) || !roles.every(role => typeof role === 'string')) return null
		return { sub, auth_source: source, roles: roles as string[] }
	} catch {
		return null
	}
}

const isJson = (contentType: string | undefined) =>
	contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'

/** The parsed input and its messages (zod 4 "Type inference": `z.output<typeof schema>`). */
type RunInput = z.output<typeof RunAgentInputSchema>
type Messages = RunInput['messages']

const lastUserText = (messages: Messages): string => {
	const user = messages.findLast(message => message.role === 'user')
	if (!user) return ''
	if (typeof user.content === 'string') return user.content
	return user.content
		.map(part => (part.type === 'text' ? part.text : ''))
		.filter(Boolean)
		.join(' ')
}

const textMessage = (text: string, messageId: string = randomUUID()): Event[] => {
	const words = text.split(' ')
	return [
		{ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' },
		...words.map(
			(word, index): Event => ({
				type: EventType.TEXT_MESSAGE_CONTENT,
				messageId,
				delta: index < words.length - 1 ? `${word} ` : word,
			}),
		),
		{ type: EventType.TEXT_MESSAGE_END, messageId },
	]
}

const reasoning = (text: string): Event[] => {
	const messageId = randomUUID()
	return [
		{ type: EventType.REASONING_START, messageId },
		{ type: EventType.REASONING_MESSAGE_START, messageId, role: 'reasoning' },
		{ type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta: text },
		{ type: EventType.REASONING_MESSAGE_END, messageId },
		{ type: EventType.REASONING_END, messageId },
	]
}

/** A backend tool call and its result; ids are unique per call (the spike's finding: a reused id hides the second call). */
const weatherCall = (parentMessageId: string): Event[] => {
	const toolCallId = `call-${randomUUID()}`
	return [
		{ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: 'get_weather', parentMessageId },
		{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: '{"city": ' },
		{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: '"Paris"}' },
		{ type: EventType.TOOL_CALL_END, toolCallId },
		{
			type: EventType.TOOL_CALL_RESULT,
			messageId: randomUUID(),
			toolCallId,
			role: 'tool',
			content: JSON.stringify({ city: 'Paris', temperature_c: 18, conditions: 'cloudy' }),
		},
	]
}

/**
 * The `nested` scenario's call (the json-tree brief): arguments with an array of scalars, an object and an array of
 * objects, streamed in two deltas as `weatherCall`'s are, and a nested JSON result with a long string value.
 */
const emailCall = (parentMessageId: string): Event[] => {
	const toolCallId = `call-${randomUUID()}`
	const args = JSON.stringify({
		subject: 'Office closed',
		to: ['ana@x.com', 'bo@x.com'],
		options: { urgent: true, channel: 'email' },
		attachments: [
			{ name: 'plan.pdf', size: 1204 },
			{ name: 'map.png', size: 88 },
		],
	})
	const half = Math.floor(args.length / 2)
	return [
		{ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: 'send_email', parentMessageId },
		{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: args.slice(0, half) },
		{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: args.slice(half) },
		{ type: EventType.TOOL_CALL_END, toolCallId },
		{
			type: EventType.TOOL_CALL_RESULT,
			messageId: randomUUID(),
			toolCallId,
			role: 'tool',
			content: JSON.stringify({
				id: 'msg-42',
				status: 'queued',
				recipients: [
					{ address: 'ana@x.com', accepted: true },
					{ address: 'bo@x.com', accepted: true },
				],
				delivery: { channel: 'email', eta_s: 30 },
				note: 'Queued for both recipients; the attachments go as links that expire in seven days.',
			}),
		},
	]
}

type Plan = { refuse: true } | { events: Event[]; delayMs: number; slow?: true }

const planFor = (threadId: string, runId: string, text: string): Plan => {
	const said = text.toLowerCase()
	if (said.includes('invalid')) return { refuse: true }
	const started: Event = { type: EventType.RUN_STARTED, threadId, runId, protocolVersion: '1.0' }
	const finished: Event = {
		type: EventType.RUN_FINISHED,
		threadId,
		runId,
		outcome: { type: 'success' },
	}
	if (said.startsWith('error')) {
		const code = said.split(/\s+/)[1] || 'agent_error'
		// The owner's service: "its message is safe to show" (spec §2.3).
		return {
			events: [
				started,
				{ type: EventType.RUN_ERROR, code, message: `The stub agent stopped with ${code}.` },
			],
			delayMs: WORD_DELAY_MS,
		}
	}
	if (said.includes('timeout')) {
		// The owner's service on its time limit (spec §2.3): CUSTOM run_cancelled, then a bare RUN_FINISHED, as its
		// Pydantic AI 0.x stream ends one (no outcome: "Absent means success").
		return {
			events: [
				started,
				...textMessage('Here is what I found before the time limit.'),
				{ type: EventType.CUSTOM, name: 'run_cancelled', value: { reason: 'run_timeout' } },
				{ type: EventType.RUN_FINISHED, threadId, runId },
			],
			delayMs: WORD_DELAY_MS,
		}
	}
	if (said.includes('slow')) {
		const words = Array.from({ length: SLOW_WORDS }, (_, index) => `word${index}`).join(' ')
		return {
			events: [started, ...textMessage(words), finished],
			delayMs: SLOW_WORD_DELAY_MS,
			slow: true,
		}
	}
	if (said.includes('nested')) {
		const askId = randomUUID()
		return {
			events: [
				started,
				...textMessage('Let me send the email.', askId),
				...emailCall(askId),
				...textMessage('The email is queued.'),
				finished,
			],
			delayMs: WORD_DELAY_MS,
		}
	}
	if (said.includes('tool')) {
		const askId = randomUUID()
		return {
			events: [
				started,
				...textMessage('Let me check the weather.', askId),
				...weatherCall(askId),
				...textMessage('It is 18 °C and cloudy in Paris.'),
				finished,
			],
			delayMs: WORD_DELAY_MS,
		}
	}
	return {
		events: [
			started,
			...reasoning('The user greets me. I will greet them back.'),
			...textMessage(
				'Hello from the **stub agent**. Ask for a tool, an error, a timeout or a slow answer.',
			),
			finished,
		],
		delayMs: WORD_DELAY_MS,
	}
}

/*
 * Part 2b's scenarios (spec §6, §10; plan call P18): human in the loop. Each is picked by a keyword that is a whole word
 * of the last user text (the Dify stub's `hasWord`), tried in this order before 2a's scenarios; no 2a prompt holds one.
 * An answering run carries no user message (spec §4.2), so its last user text is still the prompt that asked.
 */
const HITL_KEYWORDS = [
	'gated',
	'double',
	'fragile',
	'badquestion',
	'question',
	'form',
	'confirm',
	'expired',
	'finish',
	'plan',
	'activity',
] as const
type HitlKeyword = (typeof HITL_KEYWORDS)[number]

/** The hub's own frontend tool (spec §6.2), by the name the hub advertises it under in `RunAgentInput.tools`. */
const ASK_USER = 'ask_user'
/** The gated tool: Pydantic AI's `requires_approval` example (agui-spike.md, Findings › Agent side). */
const GATED_TOOL = 'delete_file'
/** Pydantic AI's approval schema, as the spike recorded it: `approved` required, `editedArgs` and `reason` optional. */
const APPROVAL_SCHEMA = {
	type: 'object',
	properties: {
		approved: { type: 'boolean' },
		editedArgs: { type: 'object' },
		reason: { type: 'string' },
	},
	required: ['approved'],
}
/** The `question` scenario's arguments, in the template's shape (spec §6.2): one question with options, one without. */
const QUESTIONS = {
	questions: [
		{ question: 'Which city?', options: ['Paris', 'Rome'] },
		{ question: 'Which month?' },
	],
}
const PLAN_STEPS = ['Gather the sources', 'Draft the summary', 'Review the draft']

/** The threads whose `fragile` resume was refused once: the hub keeps the answers open (decision 62), and a retry passes. */
const refusedOnce = new Set<string>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/** A 2b run: RUN_STARTED, its events, and RUN_FINISHED with the outcome given. */
const hitlRun = (
	input: RunInput,
	events: Event[],
	outcome: RunFinishedOutcome = { type: 'success' },
): Plan => ({
	events: [
		{
			type: EventType.RUN_STARTED,
			threadId: input.threadId,
			runId: input.runId,
			protocolVersion: '1.0',
		},
		...events,
		{ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId, outcome },
	],
	delayMs: WORD_DELAY_MS,
})

/**
 * AG-UI concepts › Interrupts, Error handling: "A resume references an `interruptId` the agent cannot correlate" or
 * "fails to address every open interrupt" → RUN_ERROR.
 */
const resumeError = (input: RunInput, message: string): Plan => ({
	events: [
		{
			type: EventType.RUN_STARTED,
			threadId: input.threadId,
			runId: input.runId,
			protocolVersion: '1.0',
		},
		{ type: EventType.RUN_ERROR, code: 'agent_error', message },
	],
	delayMs: WORD_DELAY_MS,
})

/**
 * Calls to the gated tool, left without a result, and the run's end on one approval interrupt per call in Pydantic AI's
 * exact shape (agui-spike.md, Findings › Agent side): `int-<toolCallId>`, reason `tool_call`, "Approve <tool>(<args>)?",
 * the call's id and the approval schema. The result comes from the resumed run (AG-UI "Tool-bound interrupts").
 */
const gatedRun = (input: RunInput, paths: readonly string[]): Plan => {
	const messageId = randomUUID()
	const calls = paths.map(path => ({
		toolCallId: `call-${randomUUID()}`,
		args: `{"path": "${path}"}`,
	}))
	return hitlRun(
		input,
		[
			...textMessage(`I need your approval to delete ${paths.join(' and ')}.`, messageId),
			...calls.flatMap(({ toolCallId, args }): Event[] => [
				{
					type: EventType.TOOL_CALL_START,
					toolCallId,
					toolCallName: GATED_TOOL,
					parentMessageId: messageId,
				},
				{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: args },
				{ type: EventType.TOOL_CALL_END, toolCallId },
			]),
		],
		{
			type: 'interrupt',
			interrupts: calls.map(({ toolCallId, args }) => ({
				id: `int-${toolCallId}`,
				reason: 'tool_call',
				message: `Approve ${GATED_TOOL}(${args})?`,
				toolCallId,
				responseSchema: APPROVAL_SCHEMA,
			})),
		},
	)
}

/**
 * A call to the hub's ask_user tool, left unanswered: a frontend tool's run ends with the success outcome, whose
 * `pendingToolCallIds` names the call (AG-UI 1.0 "Tool calls", Frontend tools: the producer "MUST NOT answer it" and
 * "SHOULD send it"). A producer "SHOULD call frontend tools only from the advertised list", so without ask_user in
 * `tools` the stub says so instead.
 */
const askUserRun = (input: RunInput, args: unknown): Plan => {
	if (!input.tools.some(tool => tool.name === ASK_USER))
		return hitlRun(input, textMessage('No ask_user tool was offered, so I cannot ask you.'))
	const messageId = randomUUID()
	const toolCallId = `call-${randomUUID()}`
	return hitlRun(
		input,
		[
			...textMessage('I need a few answers before I go on.', messageId),
			{
				type: EventType.TOOL_CALL_START,
				toolCallId,
				toolCallName: ASK_USER,
				parentMessageId: messageId,
			},
			{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(args) },
			{ type: EventType.TOOL_CALL_END, toolCallId },
		],
		{ type: 'success', pendingToolCallIds: [toolCallId] },
	)
}

/** One interrupt that is not bound to a tool call (AG-UI concepts › Interrupts, reason taxonomy), after a text. */
const interruptRun = (input: RunInput, text: string, interrupt: Omit<Interrupt, 'id'>): Plan =>
	hitlRun(input, textMessage(text), {
		type: 'interrupt',
		interrupts: [{ id: `int-${randomUUID()}`, ...interrupt }],
	})

/** The plan as Pydantic AI's example sends it (spec §6.4): a snapshot of pending steps, then JSON Patch deltas. */
const planRun = (input: RunInput): Plan =>
	hitlRun(input, [
		{
			type: EventType.STATE_SNAPSHOT,
			snapshot: { steps: PLAN_STEPS.map(description => ({ description, status: 'pending' })) },
		},
		{
			type: EventType.STATE_DELTA,
			delta: [{ op: 'replace', path: '/steps/0/status', value: 'in_progress' }],
		},
		{
			type: EventType.STATE_DELTA,
			delta: [
				{ op: 'replace', path: '/steps/0/status', value: 'completed' },
				{ op: 'replace', path: '/steps/1/status', value: 'in_progress' },
			],
		},
		...textMessage('I made a plan and finished its first step.'),
	])

/** Completes the plan in the state the hub sends back (spec §3.3: the conversation's last state), else the stub's own. */
const finishRun = (input: RunInput): Plan => {
	const state = isRecord(input.state) ? input.state : {}
	const sent = (Array.isArray(state.steps) ? state.steps : []).flatMap(step =>
		isRecord(step) && typeof step.description === 'string' ? [step.description] : [],
	)
	const steps = (sent.length ? sent : PLAN_STEPS).map(description => ({
		description,
		status: 'completed',
	}))
	return hitlRun(input, [
		{ type: EventType.STATE_SNAPSHOT, snapshot: { ...state, steps } },
		...textMessage('Every step of the plan is done.'),
	])
}

/** The spike's activity scenario (Appendix B): a `progress` snapshot, then three deltas to done 3 of 3. */
const activityRun = (input: RunInput): Plan => {
	const messageId = randomUUID()
	return hitlRun(input, [
		{
			type: EventType.ACTIVITY_SNAPSHOT,
			messageId,
			activityType: 'progress',
			content: { label: 'Indexing', done: 0, total: 3 },
		},
		...[1, 2, 3].map(
			(done): Event => ({
				type: EventType.ACTIVITY_DELTA,
				messageId,
				activityType: 'progress',
				patch: [{ op: 'replace', path: '/done', value: done }],
			}),
		),
		...textMessage('Indexing finished.'),
	])
}

/** The first run of each 2b scenario. */
const FIRST_RUNS: Record<HitlKeyword, (input: RunInput) => Plan> = {
	gated: input => gatedRun(input, ['report.pdf']),
	double: input => gatedRun(input, ['report.pdf', 'notes.txt']),
	fragile: input => gatedRun(input, ['report.pdf']),
	badquestion: input => askUserRun(input, { questions: [] }),
	question: input => askUserRun(input, QUESTIONS),
	// AG-UI concepts › Interrupts, "Non-tool input request" (its `expiresAt` left out: the example's date has passed).
	form: input =>
		interruptRun(input, 'I need the filing details first.', {
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
		}),
	// Reason taxonomy: `confirmation`, "`responseSchema` optional; boolean default".
	confirm: input =>
		interruptRun(input, 'I want to check one thing.', {
			reason: 'confirmation',
			message: 'Archive the old reports?',
		}),
	expired: input =>
		interruptRun(input, 'I needed a slot a minute ago.', {
			reason: 'input_required',
			message: 'Pick a delivery slot.',
			responseSchema: {
				type: 'object',
				properties: { slot: { type: 'string', enum: ['Morning', 'Evening'] } },
				required: ['slot'],
			},
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
		}),
	finish: finishRun,
	plan: planRun,
	activity: activityRun,
}

/** The path a gated call's arguments name. */
const pathOf = (args: string): string => {
	try {
		const parsed: unknown = JSON.parse(args)
		return isRecord(parsed) && typeof parsed.path === 'string' ? parsed.path : 'the file'
	} catch {
		return 'the file'
	}
}

/**
 * The resumed run of an approval scenario: a TOOL_CALL_RESULT on each open gated call (one in the input's assistant
 * messages that no tool message answers), then a text (AG-UI "Tool-bound interrupts": "it emits `ToolCallResult` against
 * the original `toolCallId`"). Pydantic AI answers a denial with its reason as the result (spike, Agent side). The
 * resume must address every open call ("Cover all open interrupts").
 */
const approvalResults = (input: RunInput): Plan => {
	const answered = new Set(
		input.messages.flatMap(message => (message.role === 'tool' ? [message.toolCallId] : [])),
	)
	const open = input.messages.flatMap(message =>
		message.role === 'assistant'
			? (message.toolCalls ?? []).filter(
					call => call.function.name === GATED_TOOL && !answered.has(call.id),
				)
			: [],
	)
	const entries = new Map((input.resume ?? []).map(entry => [entry.interruptId, entry]))
	const decided = open.flatMap(call => {
		const entry = entries.get(`int-${call.id}`)
		return entry ? [{ call, entry }] : []
	})
	if (decided.length === 0 || decided.length !== open.length)
		return resumeError(input, 'The resume did not answer every open approval.')
	const results = decided.map(({ call, entry }) => {
		const path = pathOf(call.function.arguments)
		const payload = entry.status === 'resolved' && isRecord(entry.payload) ? entry.payload : {}
		const approved = payload.approved === true
		const reason = typeof payload.reason === 'string' ? payload.reason : 'cancelled'
		return {
			toolCallId: call.id,
			outcome: `${path} ${approved ? 'deleted' : 'kept'}`,
			content: approved ? `Deleted ${path}.` : `Not deleted: ${reason}`,
		}
	})
	return hitlRun(input, [
		...results.map(
			({ toolCallId, content }): Event => ({
				type: EventType.TOOL_CALL_RESULT,
				messageId: randomUUID(),
				toolCallId,
				role: 'tool',
				content,
			}),
		),
		...textMessage(`Done: ${results.map(result => result.outcome).join(', ')}.`),
	])
}

/**
 * A run that carries `resume` (AG-UI concepts › Interrupts, "Resuming a run"), answered by the scenario that asked.
 * `fragile` refuses its first resume per thread with a plain 422 before any stream (spec §4.3 step 4), the case decision
 * 62 keeps the items open for (#67).
 */
const resumedRun = (input: RunInput, keyword: HitlKeyword): Plan => {
	const [entry] = input.resume ?? []
	switch (keyword) {
		case 'fragile':
			if (refusedOnce.has(input.threadId)) return approvalResults(input)
			refusedOnce.add(input.threadId)
			return { refuse: true }
		case 'gated':
		case 'double':
			return approvalResults(input)
		case 'form':
			return hitlRun(
				input,
				textMessage(
					entry?.status === 'resolved'
						? `Filed: ${JSON.stringify(entry.payload)}`
						: 'The form was cancelled.',
				),
			)
		case 'confirm':
			return hitlRun(
				input,
				textMessage(
					entry?.status === 'resolved'
						? `Confirmed: ${JSON.stringify(entry.payload)}`
						: 'The confirmation was cancelled.',
				),
			)
		case 'expired':
			return hitlRun(input, textMessage('The request expired.'))
		default:
			return resumeError(input, 'Nothing in this thread waits for an answer.')
	}
}

/**
 * The tool message the input ends with when it answers an ask_user call: the answers the hub wrote (spec §6.2; the
 * hub places each tool message right after the call it answers, lib/chat/thread.ts).
 */
const askUserAnswerOf = (messages: Messages) => {
	const last = messages.at(-1)
	if (last?.role !== 'tool') return undefined
	const asked = messages.some(
		message =>
			message.role === 'assistant' &&
			(message.toolCalls ?? []).some(
				call => call.id === last.toolCallId && call.function.name === ASK_USER,
			),
	)
	return asked ? last : undefined
}

/** 2b's plan for a run, or null when no 2b scenario applies (then 2a's planFor decides). */
const hitlPlanFor = (input: RunInput): Plan | null => {
	const answer = askUserAnswerOf(input.messages)
	if (answer) {
		const content =
			typeof answer.content === 'string'
				? answer.content
				: answer.content.map(part => (part.type === 'text' ? part.text : '')).join('')
		// A dismissed invalid question is answered by the hub with an `error` (plan call P3).
		return hitlRun(
			input,
			textMessage(
				answer.error === undefined
					? `Got your answers: ${content.replace(/\n+/g, ' / ')}`
					: 'The question was dismissed.',
			),
		)
	}
	const text = lastUserText(input.messages)
	const keyword = HITL_KEYWORDS.find(word => hasWord(text, word))
	if (!keyword) return null
	return input.resume?.length ? resumedRun(input, keyword) : FIRST_RUNS[keyword](input)
}

/**
 * Writes the events one by one with `EventEncoder.encodeSSE` (one JSON event per `data:` line, LF framing: the HTTP +
 * SSE binding), each stamped with the time it leaves. A client that goes away ends the stream (no writes to a closed
 * response); a slow stream records whether that happened before its end.
 */
const streamEvents = (res: ServerResponse, plan: Extract<Plan, { events: Event[] }>) => {
	const encoder = new EventEncoder()
	res.writeHead(200, { 'content-type': encoder.getContentType(), 'cache-control': 'no-cache' })
	if (plan.slow) slow = { closedEarly: false, words: 0 }
	let index = 0
	let timer: NodeJS.Timeout | undefined
	res.on('close', () => {
		clearTimeout(timer)
		// Node http: `writableFinished` is true once the whole response was flushed; a close before it is the client's.
		if (plan.slow && !res.writableFinished) slow.closedEarly = true
	})
	const tick = () => {
		if (res.destroyed || res.writableEnded) return
		if (index === plan.events.length) {
			res.end()
			return
		}
		const event = plan.events[index++]!
		res.write(encoder.encodeSSE({ ...event, timestamp: Date.now() }))
		if (plan.slow && event.type === EventType.TEXT_MESSAGE_CONTENT) slow.words++
		timer = setTimeout(tick, plan.delayMs)
	}
	tick()
}

/**
 * `/agui/...` on the stub server. In the owner's service's order: the token (401), the agent (404), the body's type
 * (415), the body (422: not JSON, or not a RunAgentInput, which Test connection's `{}` is), then the scenario.
 */
export const handleAgui = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
	const method = req.method ?? 'GET'
	if (method === 'GET' && url.pathname === '/agui/_slow') return json(res, 200, slow)
	if (method === 'GET' && url.pathname === '/agui/_caller') return json(res, 200, lastCaller ?? {})
	const agent = AGENT_PATH.exec(url.pathname)?.[1]
	if (method !== 'POST' || !agent) return refuse(res, 404, 'Not Found')
	const caller = await verifyCaller(req.headers.authorization)
	if (!caller) return refuse(res, 401, 'Invalid or expired token')
	if (agent !== STUB_AGUI_AGENT) return refuse(res, 404, `Unknown agent: ${agent}`)
	if (!isJson(req.headers['content-type']))
		return refuse(res, 415, 'Content-Type must be application/json')
	let raw: unknown
	try {
		raw = JSON.parse(await readBody(req))
	} catch {
		return refuse(res, 422, 'The body is not valid JSON')
	}
	const parsed = RunAgentInputSchema.safeParse(raw)
	if (!parsed.success) return refuse(res, 422, 'The body is not a valid RunAgentInput')
	lastCaller = caller
	const { threadId, runId, messages } = parsed.data
	const plan = hitlPlanFor(parsed.data) ?? planFor(threadId, runId, lastUserText(messages))
	if ('refuse' in plan) return refuse(res, 422, 'The stub agent refuses this input')
	streamEvents(res, plan)
}
