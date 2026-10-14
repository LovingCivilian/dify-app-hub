import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { EventType, type Event } from '@ag-ui/core'
import { RunAgentInputSchema } from '@ag-ui/core/schemas'
import { EventEncoder } from '@ag-ui/encoder'
import { jwtVerify } from 'jose'
import type * as z from 'zod'

import { e2eEnv } from '../env'
import { STUB_AGUI_AGENT, STUB_AGUI_AUDIENCE } from './agui-apps'

/*
 * A spec-level AG-UI 1.0 producer for the e2e suite (Part 2 spec §10: "the second producer decision 7 asks for"; the
 * spike's Appendix B grown up). It checks the hub's JWT as the owner's agent service does (spec §2.3; decision 45) and
 * refuses a bad request with a plain HTTP status before any stream ("Input rejected before the run starts — malformed
 * JSON, failed validation, refused auth — is an HTTP error status with no event stream", AG-UI 1.0 HTTP + SSE binding,
 * Errors). Scenarios are picked by the last user text, as the Dify stub's are: the default (reasoning and Markdown
 * text), `tool`, `error <code>`, `timeout`, `slow` and `invalid`.
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

/** The parsed input's messages (zod 4 "Type inference": `z.output<typeof schema>`). */
type Messages = z.output<typeof RunAgentInputSchema>['messages']

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
	const plan = planFor(threadId, runId, lastUserText(messages))
	if ('refuse' in plan) return refuse(res, 422, 'The stub agent refuses this input')
	streamEvents(res, plan)
}
