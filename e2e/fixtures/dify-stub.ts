import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const port = Number(process.env.E2E_DIFY_STUB_PORT ?? 5399)

interface StoredMessage {
	id: string
	conversation_id: string
	query: string
	answer: string
	created_at: number
	feedback: { rating: 'like' | 'dislike' } | null
}
const messages: StoredMessage[] = []
const conversations = new Map<string, { id: string; name: string; created_at: number }>()

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(body))
}

const readBody = (req: IncomingMessage) =>
	new Promise<string>(resolve => {
		let data = ''
		req.on('data', chunk => (data += chunk))
		req.on('end', () => resolve(data))
	})

const sse = (res: ServerResponse, events: Record<string, unknown>[]) => {
	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive',
	})
	let i = 0
	const tick = () => {
		if (i === events.length) return res.end()
		res.write(`data: ${JSON.stringify(events[i++])}\n\n`)
		setTimeout(tick, 20)
	}
	tick()
}

const parameters = {
	opening_statement: 'Hello from the stub',
	suggested_questions: ['What can you do?'],
	suggested_questions_after_answer: { enabled: false },
	speech_to_text: { enabled: false },
	text_to_speech: { enabled: false },
	retriever_resource: { enabled: false },
	annotation_reply: { enabled: false },
	user_input_form: [],
	file_upload: { enabled: false, image: { enabled: false } },
	system_parameters: {
		file_size_limit: 15,
		image_file_size_limit: 10,
		audio_file_size_limit: 50,
		video_file_size_limit: 100,
	},
}

createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
	const p = url.pathname.replace(/^\/v1/, '')
	const m = req.method

	if (m === 'GET' && p === '/parameters') return json(res, 200, parameters)
	if (m === 'GET' && p === '/meta') return json(res, 200, { tool_icons: {} })
	if (m === 'GET' && p === '/info')
		return json(res, 200, {
			name: 'Stub app',
			description: 'e2e',
			tags: [],
			mode: 'chat',
			author_name: 'e2e',
		})
	if (m === 'GET' && p === '/site')
		return json(res, 200, {
			title: 'Stub app',
			icon_type: 'emoji',
			icon: '🤖',
			icon_background: '#FFEAD5',
			description: 'e2e',
			default_language: 'en-US',
			chat_color_theme: '',
			show_workflow_steps: false,
			use_icon_as_answer_icon: false,
		})
	if (m === 'GET' && p === '/conversations')
		return json(res, 200, {
			data: [...conversations.values()].map(c => ({
				...c,
				inputs: {},
				status: 'normal',
				introduction: '',
				updated_at: c.created_at,
			})),
			has_more: false,
			limit: 20,
		})
	if (m === 'GET' && p === '/messages') {
		const cid = url.searchParams.get('conversation_id')
		const data = messages
			.filter(x => x.conversation_id === cid)
			.map(x => ({
				...x,
				inputs: {},
				message_files: [],
				agent_thoughts: [],
				retriever_resources: [],
				status: 'normal',
				error: null,
			}))
		return json(res, 200, { data, has_more: false, limit: 20 })
	}
	if (m === 'GET' && /^\/messages\/[^/]+\/suggested$/.test(p))
		return json(res, 200, { result: 'success', data: [] })
	if (m === 'POST' && /^\/messages\/[^/]+\/feedbacks$/.test(p)) {
		const id = p.split('/')[2]
		const body = JSON.parse((await readBody(req)) || '{}')
		const msg = messages.find(x => x.id === id)
		if (!msg)
			return json(res, 404, {
				code: 'message_not_exists',
				message: 'Message Not Exists.',
				status: 404,
			})
		msg.feedback = body.rating ? { rating: body.rating } : null
		return json(res, 200, { result: 'success' })
	}
	if (m === 'POST' && /^\/conversations\/[^/]+\/name$/.test(p)) {
		const c = conversations.get(p.split('/')[2])
		const body = JSON.parse((await readBody(req)) || '{}')
		if (c && body.name) c.name = body.name
		return json(res, 200, c ?? {})
	}
	if (m === 'DELETE' && /^\/conversations\/[^/]+$/.test(p)) {
		conversations.delete(p.split('/')[2])
		return json(res, 200, { result: 'success' })
	}
	if (m === 'POST' && /^\/chat-messages\/[^/]+\/stop$/.test(p))
		return json(res, 200, { result: 'success' })
	if (m === 'POST' && p === '/chat-messages') {
		const body = JSON.parse((await readBody(req)) || '{}')
		if (!body.user)
			return json(res, 400, { code: 'invalid_param', message: 'user is required', status: 400 })
		const conversation_id: string = body.conversation_id || randomUUID()
		if (!conversations.has(conversation_id))
			conversations.set(conversation_id, {
				id: conversation_id,
				name: String(body.query).slice(0, 20),
				created_at: Math.floor(Date.now() / 1000),
			})
		const message_id = randomUUID()
		const base = {
			task_id: randomUUID(),
			message_id,
			conversation_id,
			created_at: Math.floor(Date.now() / 1000),
		}
		const answer = `Echo: ${body.query}`
		messages.push({
			id: message_id,
			conversation_id,
			query: body.query,
			answer,
			created_at: base.created_at,
			feedback: null,
		})
		return sse(res, [
			{ event: 'message', answer: 'Echo: ', ...base },
			{ event: 'message', answer: String(body.query), ...base },
			{
				event: 'message_end',
				id: message_id,
				metadata: { usage: { total_tokens: 3, latency: 0.1 }, retriever_resources: [] },
				...base,
			},
		])
	}
	json(res, 404, { code: 'not_found', message: `stub has no route for ${m} ${p}`, status: 404 })
}).listen(port, '127.0.0.1', () =>
	console.log(`dify stub listening on http://127.0.0.1:${port}/v1`),
)
