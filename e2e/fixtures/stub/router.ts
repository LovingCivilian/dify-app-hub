import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { modeFromPath, STUB_APPS, type StubMode } from './apps'
import { STUB_PNG, STUB_WAV } from './assets'
import * as ev from './events'
import type { StreamEvent } from './events'
import {
	chatScenario,
	has,
	parametersFor,
	resumeScenario,
	REVIEW_NODE,
	runScenario,
	streamDelay,
} from './scenarios'
import {
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

const appFor = (mode: StubMode) => STUB_APPS.find(a => a.mode === mode)!

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

	if (method === 'GET' && url.pathname === '/files/stub-image.png') {
		res.writeHead(200, { 'content-type': 'image/png' })
		return res.end(STUB_PNG)
	}

	const { mode, path } = modeFromPath(url.pathname)

	const app = appFor(mode)
	const fileUrl = `http://127.0.0.1:${port}/files/stub-image.png`

	if (method === 'GET' && path === '/parameters') return json(res, 200, parametersFor(mode))
	if (method === 'GET' && path === '/meta') return json(res, 200, { tool_icons: {} })
	if (method === 'GET' && path === '/info') {
		return json(res, 200, {
			name: app.name,
			description: 'e2e',
			tags: [],
			mode,
			author_name: 'e2e',
		})
	}
	if (method === 'GET' && path === '/site') {
		return json(res, 200, {
			title: app.name,
			icon_type: 'emoji',
			icon: '🤖',
			icon_background: '#FFEAD5',
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
		const c = forUser(userOf(url, body), mode).conversations.get(idAt(path, 2))
		if (c) {
			if (typeof body.name === 'string' && body.name) c.name = body.name
			else if (body.auto_generate) c.name = 'Generated title'
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
	if (method === 'POST' && path === '/apps/annotations') {
		const body = await parseJson(req, res)
		if (!body) return
		if (typeof body.question !== 'string' || typeof body.answer !== 'string') {
			return difyError(res, 400, 'invalid_param', 'question and answer are required.')
		}
		return json(res, 201, {
			id: randomUUID(),
			question: body.question,
			answer: body.answer,
			hit_count: 0,
			created_at: now(),
		})
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
				ev.submittedHumanInputContent(
					form.workflowRunId,
					REVIEW_NODE.nodeId,
					action,
					form.submitted.inputs,
				),
			]
		}
		return json(res, 200, {})
	}
	if (method === 'GET' && /^\/workflow\/[^/]+\/events$/.test(path)) {
		const runId = idAt(path, 2)
		const user = userOf(url, null)
		const form = [...pendingForms.values()].find(f => f.workflowRunId === runId)
		if (form && form.user !== user) {
			return difyError(res, 404, 'not_found', 'Workflow run not found')
		}
		const base = {
			task_id: form?.taskId ?? randomUUID(),
			message_id: form?.messageId ?? randomUUID(),
			conversation_id: form?.conversationId ?? '',
			created_at: now(),
		}
		// A run that is not paused here has finished: "the stream emits a single workflow_finished event and closes".
		if (!form || form.finished) {
			return sse(res, [ev.workflowFinished(base, runId, {})], 20, { ping: true })
		}
		// Still waiting for the form: the stream replays the pause and closes (continue_on_pause defaults to false).
		if (!form.submitted) {
			const required = ev.humanInputRequired(
				base,
				runId,
				form.formToken,
				REVIEW_NODE.nodeId,
				form.expiresAt,
			)
			const paused = ev.workflowPaused(
				base,
				runId,
				[REVIEW_NODE.nodeId],
				[ev.pauseReason(required)],
			)
			return sse(res, [paused], 20, { ping: true })
		}
		const events = resumeScenario(
			{ base, runId, formToken: form.formToken, fileUrl },
			form.submitted.action,
			form.submitted.inputs,
		)
		return sse(res, events, 20, {
			ping: true,
			onDone: () => {
				const msg = forUser(form.user, mode).messages.find(m => m.id === form.messageId)
				if (msg) {
					msg.answer = events
						.filter(e => e.event === 'message')
						.map(e => String((e as { answer?: string }).answer ?? ''))
						.join('')
				}
				// The form stays (answering 412 as submitted); the run is finished from now on.
				form.finished = true
			},
		})
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
						name: query.slice(0, 40),
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
		const base = {
			task_id: randomUUID(),
			message_id: randomUUID(),
			conversation_id: '',
			created_at: now(),
		}
		const events = runScenario(mode, (body.inputs as Record<string, unknown>) ?? {}, {
			base,
			runId: randomUUID(),
			formToken: '',
			fileUrl,
		})
		return sse(res, events, 20, { ping: mode === 'workflow' })
	}

	difyError(res, 404, 'not_found', `stub has no route for ${method} ${url.pathname}`)
}
