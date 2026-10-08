import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { appFromPath, modeFromPath, type StubMode } from './apps'
import { STUB_PNG, STUB_WAV } from './assets'
import * as ev from './events'
import type { StreamEvent } from './events'
import {
	chatScenario,
	has,
	hasWord,
	parametersFor,
	resumeScenario,
	REVIEW_NODE,
	runDelay,
	runScenario,
	SECOND_REVIEW_NODE,
	snapshotScenario,
	streamDelay,
} from './scenarios'
import {
	annotationsFor,
	forUser,
	now,
	type PendingForm,
	pendingForms,
	type StoredConversation,
	type StoredMessage,
} from './store'

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(body))
}
/** Dify's error body: `{ code, message, status }` (OpenAPI error examples). */
const difyError = (res: ServerResponse, status: number, code: string, message: string) =>
	json(res, status, { code, message, status })

/**
 * Dify's service API answers cross-origin calls: flask-cors defaults on the service_api blueprint (any origin,
 * no credentials; api/extensions/ext_blueprints.py). The admin pages call it from the browser with the app's key.
 */
const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': 'Content-Type, X-App-Code, X-App-Passport, Authorization',
	'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS, PATCH',
	'access-control-expose-headers': 'X-Version, X-Env, X-Trace-Id, X-Dify-Catalog',
}

const readBuffer = (req: IncomingMessage) =>
	new Promise<Buffer>(resolve => {
		const parts: Buffer[] = []
		req.on('data', (chunk: Buffer) => parts.push(chunk))
		req.on('end', () => resolve(Buffer.concat(parts)))
		req.on('error', () => resolve(Buffer.concat(parts)))
	})
const readBody = async (req: IncomingMessage) => (await readBuffer(req)).toString('utf8')

/** Dify-shaped 400 on unparsable JSON instead of a crash. */
const parseJson = async (
	req: IncomingMessage,
	res: ServerResponse,
): Promise<Record<string, unknown> | null> => {
	const raw = await readBody(req)
	if (!raw) return {}
	try {
		const parsed: unknown = JSON.parse(raw)
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>
		}
	} catch {
		// fall through to the 400 below
	}
	difyError(res, 400, 'invalid_param', 'Request body is not valid JSON.')
	return null
}

/**
 * Writes the events as server-sent `data:` frames. Streams of workflow-based apps open with a bare
 * `event: ping` keep-alive frame in the OpenAPI examples (chatflow, workflow run, resumed run).
 */
const sse = (
	res: ServerResponse,
	events: StreamEvent[],
	delayMs: number,
	options: { ping?: boolean; onDone?: () => void } = {},
) => {
	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive',
	})
	if (options.ping) res.write(ev.PING_FRAME)
	let i = 0
	let timer: NodeJS.Timeout | undefined
	// A client that went away (abort, navigation) ends the stream: no further writes to a closed response.
	res.on('close', () => clearTimeout(timer))
	const tick = () => {
		if (res.destroyed || res.writableEnded) return
		if (i === events.length) {
			options.onDone?.()
			return res.end()
		}
		res.write(`data: ${JSON.stringify(events[i++])}\n\n`)
		timer = setTimeout(tick, delayMs)
	}
	tick()
}

/**
 * The listeners of each paused or resumed run, by run id. Dify publishes a run's events to a Redis pub/sub topic
 * (1.17.1, MessageGenerator.retrieve_events): a listener gets the events published while it listens, and nothing is
 * kept for one that comes later.
 */
const runListeners = new Map<string, Set<(event: StreamEvent) => void>>()
const listen = (runId: string, listener: (event: StreamEvent) => void) => {
	const listeners = runListeners.get(runId) ?? new Set()
	runListeners.set(runId, listeners)
	listeners.add(listener)
	return () => listeners.delete(listener)
}
const publish = (runId: string, event: StreamEvent) => {
	// A listener may leave while it is called (the end of its stream); a Set's iteration allows that.
	for (const listener of runListeners.get(runId) ?? []) listener(event)
}

/** The run's latest form: its state is the run's (paused while unanswered, resumed once answered, then finished). */
const latestFormOf = (runId: string) =>
	[...pendingForms.values()].filter(form => form.workflowRunId === runId).at(-1)

const baseOf = (form: PendingForm) => ({
	task_id: form.taskId,
	message_id: form.messageId,
	conversation_id: form.conversationId,
	created_at: now(),
})

/**
 * Runs the continuation of an answered form the way Dify does: at once, in a worker (1.17.1,
 * HumanInputService.enqueue_resume), whoever listens. `fast` publishes the whole continuation before the submission
 * is answered (a run with nothing slow after its form); otherwise one event every 20 ms from the next tick. A
 * `chain` run pauses again at a second form, which is registered as the run's latest form.
 */
const resumeRun = (form: PendingForm, mode: StubMode, fileUrl: string) => {
	const submitted = form.submitted
	if (!submitted) return
	const runId = form.workflowRunId
	const base = baseOf(form)
	const next = form.chain ? { formToken: randomUUID(), expiresAt: form.expiresAt } : undefined
	const events = resumeScenario(
		{ base, runId, formToken: form.formToken, fileUrl },
		submitted.action,
		submitted.inputs,
		{ node: form.node, next },
	)
	const store = forUser(form.user, mode)
	const message = () => store.messages.find(m => m.id === form.messageId)
	const onEvent = (event: StreamEvent) => {
		if (event.event !== 'human_input_required' || !next) return
		pendingForms.set(next.formToken, {
			...form,
			formToken: next.formToken,
			node: SECOND_REVIEW_NODE,
			chain: false,
			submitted: undefined,
		})
		// Dify lists a message's contents oldest first: the answered form, then the one the run waits on.
		const stored = message()
		if (stored)
			stored.extra_contents = [...stored.extra_contents, ev.pendingHumanInputContent(event)]
	}
	const onDone = () => {
		if (next) return
		const stored = message()
		if (stored) {
			stored.answer = events
				.filter(e => e.event === 'message')
				.map(e => String((e as { answer?: string }).answer ?? ''))
				.join('')
		}
		// The form stays (answering 412 as submitted); the run is finished from now on.
		form.finished = true
	}
	let i = 0
	const step = () => {
		while (i < events.length) {
			const event = events[i++]
			onEvent(event)
			// The run's records are written before its last event goes out.
			if (i === events.length) onDone()
			publish(runId, event)
			if (!form.fast && i < events.length) {
				setTimeout(step, 20)
				return
			}
		}
	}
	if (form.fast) step()
	else setTimeout(step, 0)
}

const userOf = (url: URL, body: Record<string, unknown> | null) =>
	String(body?.user ?? url.searchParams.get('user') ?? 'anonymous')

/** `user` is required on the run, stop and feedback endpoints; answers 400 and returns null without it. */
const requireUser = (res: ServerResponse, body: Record<string, unknown>) => {
	if (typeof body.user === 'string' && body.user) return body.user
	difyError(res, 400, 'invalid_param', 'Arg user must be provided.')
	return null
}

const limitOf = (url: URL) =>
	Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20))

const CHAT_MODES: StubMode[] = ['chat', 'agent-chat', 'advanced-chat']

const conversationItem = (c: StoredConversation) => ({ ...c, status: 'normal', introduction: '' })

const idAt = (path: string, index: number) => path.split('/')[index]

/** Forms are one-shot: the first response wins (OpenAPI: 412 human_input_form_submitted). */
const formSubmitted = (res: ServerResponse, form: PendingForm) =>
	difyError(
		res,
		412,
		'human_input_form_submitted',
		`This form has already been submitted by another user, form_id=form-${form.formToken}`,
	)

/** The form of a pending human-input pause as GET /form/human_input/{token} returns it. */
const formResponse = (formToken: string, runId: string, expiresAt: number) => {
	const required = ev.humanInputRequired(
		{ task_id: '', message_id: '', conversation_id: '', created_at: now() },
		runId,
		formToken,
		REVIEW_NODE.nodeId,
		expiresAt,
	)
	const data = required.data as Record<string, unknown>
	return {
		form_content: data.form_content,
		inputs: data.inputs,
		resolved_default_values: data.resolved_default_values,
		user_actions: data.actions,
		expiration_time: data.expiration_time,
	}
}

export const handle = async (req: IncomingMessage, res: ServerResponse, port: number) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
	const method = req.method ?? 'GET'
	// setHeader values are merged into every later writeHead (Node http), so each answer carries them.
	for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
	if (method === 'OPTIONS') {
		res.writeHead(200)
		return res.end()
	}

	if (method === 'GET' && url.pathname === '/files/stub-image.png') {
		res.writeHead(200, { 'content-type': 'image/png' })
		return res.end(STUB_PNG)
	}

	const { mode, path } = modeFromPath(url.pathname)
	const matched = appFromPath(url.pathname)

	const fileUrl = `http://127.0.0.1:${port}/files/stub-image.png`

	if (method === 'GET' && path === '/parameters') return json(res, 200, parametersFor(mode))
	if (method === 'GET' && path === '/meta') return json(res, 200, { tool_icons: {} })
	if (method === 'GET' && path === '/info') {
		return json(res, 200, {
			name: matched.name,
			description: 'e2e',
			tags: [],
			mode: matched.mode,
			author_name: 'e2e',
		})
	}
	if (method === 'GET' && path === '/site') {
		// Dify answers 403 forbidden when the app has no site (OpenAPI getChatWebAppSettings).
		if (matched.site === 'none') return difyError(res, 403, 'forbidden', 'Site not found.')
		const icon =
			matched.site === 'image'
				? { icon_type: 'image', icon: 'stub-icon-file', icon_url: fileUrl, icon_background: null }
				: { icon_type: 'emoji', icon: '🤖', icon_background: '#FFEAD5', icon_url: null }
		return json(res, 200, {
			title: matched.name,
			...icon,
			description: 'e2e',
			default_language: 'en-US',
			chat_color_theme: '',
			show_workflow_steps: true,
			use_icon_as_answer_icon: false,
			custom_disclaimer: 'Answers come from the stub.',
		})
	}

	if (method === 'GET' && path === '/conversations') {
		// The Map holds conversations in order of last activity (a message re-inserts its conversation), so
		// the reverse is Dify's default sort_by=-updated_at, newest first even within one second.
		const all = [...forUser(userOf(url, null), mode).conversations.values()].reverse()
		const limit = limitOf(url)
		const lastId = url.searchParams.get('last_id')
		const from = lastId ? all.findIndex(c => c.id === lastId) + 1 : 0
		if (lastId && from === 0) {
			return difyError(res, 404, 'not_found', 'Last Conversation Not Exists.')
		}
		const page = all.slice(from, from + limit)
		return json(res, 200, {
			data: page.map(conversationItem),
			has_more: from + limit < all.length,
			limit,
		})
	}
	if (method === 'GET' && path === '/messages') {
		const store = forUser(userOf(url, null), mode)
		const cid = url.searchParams.get('conversation_id')
		if (!cid) return difyError(res, 400, 'invalid_param', 'conversation_id is required.')
		const name = store.conversations.get(cid)?.name.toLowerCase() ?? ''
		// A conversation whose first query asked for a broken history fails its first load with Dify's
		// documented 404 and answers the next one: the history-error spec retries.
		if (name.includes('brokenhistory') && !store.failedHistory.has(cid)) {
			store.failedHistory.add(cid)
			return difyError(res, 404, 'not_found', 'Conversation Not Exists.')
		}
		const limit = limitOf(url)
		const firstId = url.searchParams.get('first_id')
		// Dify answers each page oldest first (MessageService.pagination_by_first_id, order "asc"): the first page
		// holds the latest `limit` messages and `first_id` (the first message the client has) pages backward to the
		// `limit` messages before it. The array is in insertion order, which is chronological.
		const all = store.messages.filter(m => m.conversation_id === cid)
		let older = all
		if (firstId) {
			const idx = all.findIndex(m => m.id === firstId)
			if (idx < 0) return difyError(res, 404, 'not_found', 'First Message Not Exists.')
			older = all.slice(0, idx)
		}
		const page = older.slice(-limit)
		const respond = () => json(res, 200, { data: page, has_more: older.length > limit, limit })
		// Reopening a conversation whose first query asked for a slow history: the race test sends during this wait.
		return name.includes('slowhistory') ? void setTimeout(respond, 1500) : respond()
	}
	if (method === 'GET' && /^\/messages\/[^/]+\/suggested$/.test(path)) {
		if (!parametersFor(mode).suggested_questions_after_answer.enabled) {
			return difyError(res, 400, 'bad_request', 'Suggested Questions Is Disabled.')
		}
		const store = forUser(userOf(url, null), mode)
		if (!store.messages.some(m => m.id === idAt(path, 2))) {
			return difyError(res, 404, 'not_found', 'Message Not Exists.')
		}
		return json(res, 200, {
			result: 'success',
			data: ['Why is that?', 'Can you give an example?'],
		})
	}
	if (method === 'POST' && /^\/messages\/[^/]+\/feedbacks$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		const user = requireUser(res, body)
		if (!user) return
		if (
			body.rating !== undefined &&
			body.rating !== null &&
			!['like', 'dislike'].includes(String(body.rating))
		) {
			return difyError(res, 400, 'invalid_param', 'rating must be like, dislike or null.')
		}
		const msg = forUser(user, mode).messages.find(m => m.id === idAt(path, 2))
		if (!msg) return difyError(res, 404, 'not_found', 'Message Not Exists.')
		msg.feedback = body.rating ? { rating: body.rating as 'like' | 'dislike' } : null
		return json(res, 200, { result: 'success' })
	}
	if (method === 'POST' && /^\/conversations\/[^/]+\/name$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		const store = forUser(userOf(url, body), mode)
		const c = store.conversations.get(idAt(path, 2))
		if (c) {
			if (typeof body.name === 'string' && body.name) c.name = body.name
			// Like Dify's ConversationService.auto_generate_name: a name from the conversation's first message.
			else if (body.auto_generate) {
				const first = store.messages.find(m => m.conversation_id === c.id)
				c.name = first ? first.query.slice(0, 40) : 'Generated title'
			}
		}
		return json(res, 200, c ? conversationItem(c) : {})
	}
	if (method === 'DELETE' && /^\/conversations\/[^/]+$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		forUser(userOf(url, body), mode).conversations.delete(idAt(path, 2))
		res.writeHead(204)
		return res.end()
	}
	if (
		method === 'POST' &&
		/^\/(chat-messages|completion-messages|workflows\/tasks)\/[^/]+\/stop$/.test(path)
	) {
		const body = await parseJson(req, res)
		if (!body || !requireUser(res, body)) return
		return json(res, 200, { result: 'success' })
	}

	if (method === 'POST' && path === '/files/upload') {
		// Multipart body parsed with the standard Response.formData(); the part named `file` is described back.
		const raw = await readBuffer(req)
		const contentType = req.headers['content-type'] ?? ''
		const file = await new Response(new Uint8Array(raw), {
			headers: { 'content-type': contentType },
		})
			.formData()
			.then(form => form.get('file'))
			.catch(() => null)
		if (!(file instanceof File)) {
			return difyError(res, 400, 'no_file_uploaded', 'No file was provided in the request.')
		}
		const id = randomUUID()
		return json(res, 201, {
			id,
			name: file.name,
			size: file.size,
			extension: file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : null,
			mime_type: file.type,
			created_by: randomUUID(),
			created_at: now(),
			conversation_id: null,
			preview_url: null,
			source_url: `http://127.0.0.1:${port}/v1/files/${id}/preview`,
		})
	}
	if (method === 'GET' && /^\/files\/[^/]+\/preview$/.test(path)) {
		res.writeHead(200, {
			'content-type': 'image/png',
			...(url.searchParams.get('as_attachment') === 'true'
				? { 'content-disposition': 'attachment; filename="stub-image.png"' }
				: {}),
		})
		return res.end(STUB_PNG)
	}
	if (method === 'POST' && path === '/text-to-audio') {
		if (!(await parseJson(req, res))) return
		res.writeHead(200, { 'content-type': 'audio/wav' })
		return res.end(STUB_WAV)
	}
	if (method === 'POST' && path === '/audio-to-text') {
		await readBody(req)
		return json(res, 200, { text: 'transcribed from the stub' })
	}
	if (path === '/apps/annotations' || path.startsWith('/apps/annotations/')) {
		const annotations = annotationsFor(matched.id)
		const invalid = () => difyError(res, 400, 'invalid_param', 'question and answer are required.')
		if (method === 'GET' && path === '/apps/annotations') {
			// Newest first; `keyword` filters question or answer; `limit` ≤ 100 (OpenAPI GET /apps/annotations).
			const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase()
			const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
			const limit = limitOf(url)
			const found = keyword
				? annotations.filter(
						a =>
							a.question.toLowerCase().includes(keyword) ||
							a.answer.toLowerCase().includes(keyword),
					)
				: annotations
			return json(res, 200, {
				data: found.slice((page - 1) * limit, page * limit),
				has_more: page * limit < found.length,
				limit,
				total: found.length,
				page,
			})
		}
		if (method === 'POST' && path === '/apps/annotations') {
			const body = await parseJson(req, res)
			if (!body) return
			if (typeof body.question !== 'string' || typeof body.answer !== 'string') return invalid()
			const item = {
				id: randomUUID(),
				question: body.question,
				answer: body.answer,
				hit_count: 0,
				created_at: now(),
			}
			annotations.unshift(item)
			return json(res, 201, item)
		}
		const index = annotations.findIndex(a => a.id === idAt(path, 3))
		if (method === 'PUT') {
			const body = await parseJson(req, res)
			if (!body) return
			if (typeof body.question !== 'string' || typeof body.answer !== 'string') return invalid()
			if (index < 0) return difyError(res, 404, 'not_found', 'Annotation not found.')
			annotations[index] = { ...annotations[index], question: body.question, answer: body.answer }
			return json(res, 200, annotations[index])
		}
		if (method === 'DELETE') {
			if (index < 0) return difyError(res, 404, 'not_found', 'Annotation not found.')
			annotations.splice(index, 1)
			res.writeHead(204)
			return res.end()
		}
	}

	if (method === 'GET' && /^\/form\/human_input\/[^/]+$/.test(path)) {
		const form = pendingForms.get(idAt(path, 3))
		if (!form) return difyError(res, 404, 'not_found', 'Form not found')
		if (form.submitted) return formSubmitted(res, form)
		return json(res, 200, formResponse(form.formToken, form.workflowRunId, form.expiresAt))
	}
	if (method === 'POST' && /^\/form\/human_input\/[^/]+$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		const form = pendingForms.get(idAt(path, 3))
		if (!form) return difyError(res, 404, 'not_found', 'Form not found')
		if (form.submitted) return formSubmitted(res, form)
		if (now() > form.expiresAt) {
			return difyError(
				res,
				412,
				'human_input_form_expired',
				`This form has expired, form_id=form-${form.formToken}`,
			)
		}
		const action = String(body.action ?? '')
		if (
			!['approve', 'reject'].includes(action) ||
			typeof body.inputs !== 'object' ||
			!body.inputs
		) {
			return difyError(
				res,
				400,
				'invalid_form_data',
				'Submission failed validation against the form definition.',
			)
		}
		form.submitted = { inputs: body.inputs as Record<string, string>, action }
		// The form is submitted from now on: the history lists its submission instead of its definition.
		const message = forUser(form.user, mode).messages.find(m => m.id === form.messageId)
		if (message) {
			message.extra_contents = [
				...message.extra_contents.filter(
					content =>
						(content as { form_definition?: { form_token?: string } | null }).form_definition
							?.form_token !== form.formToken,
				),
				ev.submittedHumanInputContent(
					form.workflowRunId,
					form.node.nodeId,
					action,
					form.submitted.inputs,
				),
			]
		}
		resumeRun(form, mode, fileUrl)
		return json(res, 200, {})
	}
	if (method === 'GET' && /^\/workflow\/[^/]+\/events$/.test(path)) {
		const runId = idAt(path, 2)
		const user = userOf(url, null)
		const form = latestFormOf(runId)
		if (form && form.user !== user) {
			return difyError(res, 404, 'not_found', 'Workflow run not found')
		}
		const base = form
			? baseOf(form)
			: { task_id: randomUUID(), message_id: randomUUID(), conversation_id: '', created_at: now() }
		// A finished run: "the stream emits a single workflow_finished event and closes" (no ping on that path).
		if (!form || form.finished) {
			return sse(res, [ev.workflowFinished(base, runId, {})], 20)
		}
		const snapshot = url.searchParams.get('include_state_snapshot') === 'true'
		const continueOnPause = url.searchParams.get('continue_on_pause') === 'true'
		res.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
		})
		res.write(ev.PING_FRAME)
		const write = (event: StreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`)
		// Each pause closes the stream unless `continue_on_pause` (stream_topic_events' terminal events).
		const terminal = (event: StreamEvent) =>
			event.event === 'workflow_finished' || (event.event === 'workflow_paused' && !continueOnPause)
		if (snapshot) {
			const waiting = !form.submitted
			const replay = snapshotScenario(
				{ base, runId, formToken: form.formToken, fileUrl },
				forUser(form.user, mode).messages.find(m => m.id === form.messageId)?.answer ?? '',
				form.node === SECOND_REVIEW_NODE || !waiting ? [REVIEW_NODE] : [],
				waiting
					? { node: form.node, formToken: form.formToken, expiresAt: form.expiresAt }
					: undefined,
			)
			for (const event of replay) write(event)
			if (replay.some(terminal)) return res.end()
		}
		const stop = listen(runId, event => {
			write(event)
			if (terminal(event)) {
				stop()
				res.end()
			}
		})
		res.on('close', stop)
		return
	}

	if (method === 'POST' && path === '/chat-messages') {
		const body = await parseJson(req, res)
		if (!body) return
		if (!CHAT_MODES.includes(mode)) {
			return difyError(
				res,
				400,
				'not_chat_app',
				'Please check if your app mode matches the right API route.',
			)
		}
		const user = requireUser(res, body)
		if (!user) return
		if (typeof body.query !== 'string' || !body.query) {
			return difyError(res, 400, 'invalid_param', 'query is required')
		}
		const store = forUser(user, mode)
		const query = body.query
		const inputs = (body.inputs as Record<string, unknown>) ?? {}
		const conversation_id = (body.conversation_id as string) || randomUUID()
		// A message re-inserts its conversation so the Map keeps them in order of last activity.
		const known = store.conversations.get(conversation_id)
		store.conversations.delete(conversation_id)
		store.conversations.set(
			conversation_id,
			known
				? { ...known, updated_at: now() }
				: {
						id: conversation_id,
						// Dify 1.17.1 `_init_generate_records`: the query's first 20 characters plus an ellipsis
						// ('New conversation' for an empty query), whatever `auto_generate_name` says; that flag
						// only gates the server's own naming thread (the rename API with auto_generate replaces it).
						name: query.length > 20 ? `${query.slice(0, 20)}…` : query,
						created_at: now(),
						updated_at: now(),
						inputs,
					},
		)
		const base = {
			task_id: randomUUID(),
			message_id: randomUUID(),
			conversation_id,
			created_at: now(),
		}
		const runId = randomUUID()
		const formToken = `ft-${randomUUID()}`
		const events = chatScenario(mode, query, { base, runId, formToken, fileUrl })
		const errorEvent = events.find(e => e.event === 'error')
		const messageEnd = events.find(e => e.event === 'message_end')
		const required = events.find(e => e.event === 'human_input_required')
		const answer = events
			.filter(e => e.event === 'message' || e.event === 'agent_message')
			.map(e => String((e as { answer?: string }).answer ?? ''))
			.join('')
		const stored: StoredMessage = {
			id: base.message_id,
			conversation_id,
			query,
			answer,
			created_at: base.created_at,
			feedback: null,
			inputs,
			message_files: events.filter(e => e.event === 'message_file').map(e => ev.toHistoryFile(e)),
			agent_thoughts: events
				.filter(e => e.event === 'agent_thought')
				.map(e => ev.toHistoryThought(e)),
			retriever_resources: (
				(
					messageEnd?.metadata as
						| { retriever_resources?: ReturnType<typeof ev.retrieverResource>[] }
						| undefined
				)?.retriever_resources ?? []
			).map(ev.toHistoryResource),
			// A paused run's form stays in the history until it is submitted (HumanInputContent).
			extra_contents: required ? [ev.pendingHumanInputContent(required)] : [],
			status: errorEvent ? 'error' : 'normal',
			error: errorEvent ? String(errorEvent.message) : null,
		}
		if (has(query, 'history40')) {
			for (let i = 0; i < 40; i++) {
				store.messages.push({
					...stored,
					id: randomUUID(),
					query: `earlier ${i + 1}`,
					answer: `Echo: earlier ${i + 1}`,
					created_at: base.created_at - 100 + i,
					message_files: [],
					agent_thoughts: [],
					retriever_resources: [],
					status: 'normal',
					error: null,
				})
			}
		}
		store.messages.push(stored)
		const form = required?.data as
			| { form_token: string | null; expiration_time: number }
			| undefined
		// A form without a token cannot be reached through the Service API at all.
		if (form?.form_token) {
			pendingForms.set(form.form_token, {
				formToken: form.form_token,
				workflowRunId: runId,
				user,
				conversationId: conversation_id,
				messageId: base.message_id,
				taskId: base.task_id,
				expiresAt: form.expiration_time,
				node: REVIEW_NODE,
				fast: hasWord(query, 'fast'),
				chain: hasWord(query, 'chain'),
			})
		}
		return sse(res, events, streamDelay(query, events), { ping: mode === 'advanced-chat' })
	}

	if (method === 'POST' && (path === '/workflows/run' || path === '/completion-messages')) {
		const body = await parseJson(req, res)
		if (!body) return
		if (path === '/workflows/run' && mode !== 'workflow') {
			return difyError(
				res,
				400,
				'not_workflow_app',
				'Please check if your app mode matches the right API route.',
			)
		}
		if (path === '/completion-messages' && mode !== 'completion') {
			return difyError(
				res,
				400,
				'app_unavailable',
				'App unavailable, please check your app configurations.',
			)
		}
		if (!requireUser(res, body)) return
		const inputs = (body.inputs as Record<string, unknown>) ?? {}
		// A refused request answers Dify's error body before any stream (OpenAPI: 400 invalid_param).
		if (has(String(inputs.topic ?? ''), 'invalid')) {
			return difyError(res, 400, 'invalid_param', 'topic is not valid.')
		}
		const base = {
			task_id: randomUUID(),
			message_id: randomUUID(),
			conversation_id: '',
			created_at: now(),
		}
		const events = runScenario(mode, inputs, {
			base,
			runId: randomUUID(),
			formToken: '',
			fileUrl,
		})
		return sse(res, events, runDelay(inputs), { ping: mode === 'workflow' })
	}

	difyError(res, 404, 'not_found', `stub has no route for ${method} ${url.pathname}`)
}
