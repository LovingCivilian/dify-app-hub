import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { handle as Handle } from '@/e2e/fixtures/stub/router'

let server: Server
let base: string
let handle: typeof Handle

beforeAll(async () => {
	server = createServer((req, res) => {
		handle(req, res, (server.address() as AddressInfo).port).catch(() => res.end())
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))
// The stub keeps its state in module scope: a fresh import per test is a fresh stub (vitest
// `vi.resetModules`: "useful to isolate modules where local state conflicts between tests").
beforeEach(async () => {
	vi.resetModules()
	;({ handle } = await import('@/e2e/fixtures/stub/router'))
})

const post = (path: string, body: unknown) =>
	fetch(`${base}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	})

type Frame = { event: string; [key: string]: unknown }
/** Reads an SSE response into its `data:` frames and notes whether it opened with a bare `event: ping`. */
const readStream = async (response: Response) => {
	const frames = (await response.text()).split('\n\n').filter(Boolean)
	return {
		openedWithPing: frames[0] === 'event: ping',
		events: frames.filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)) as Frame),
	}
}

const chat = async (prefix: string, user: string, query: string, conversationId?: string) =>
	readStream(
		await post(`/v1${prefix}/chat-messages`, {
			query,
			user,
			inputs: {},
			response_mode: 'streaming',
			conversation_id: conversationId,
		}),
	)

const conversations = async (prefix: string, user: string) =>
	(await (await fetch(`${base}/v1${prefix}/conversations?user=${user}`)).json()) as {
		data: { id: string; name: string }[]
		has_more: boolean
	}

describe('stub router', () => {
	it('answers unparsable JSON and a missing user with Dify 400 invalid_param, unknown routes with a Dify 404', async () => {
		const bad = await post('/v1/chat-messages', '{not json')
		expect(bad.status).toBe(400)
		expect(await bad.json()).toMatchObject({ code: 'invalid_param', status: 400 })
		const noUser = await post('/v1/chat-messages', { query: 'hi' })
		expect(noUser.status).toBe(400)
		expect(await noUser.json()).toMatchObject({ code: 'invalid_param', status: 400 })
		const unknown = await fetch(`${base}/v1/nope`)
		expect(unknown.status).toBe(404)
		expect(await unknown.json()).toEqual({
			code: 'not_found',
			message: 'stub has no route for GET /v1/nope',
			status: 404,
		})
	})

	it('rejects a run on an app of another mode with the documented error codes', async () => {
		const chatOnWorkflow = await post('/v1/workflow/chat-messages', { query: 'x', user: 'u' })
		expect(await chatOnWorkflow.json()).toMatchObject({ code: 'not_chat_app', status: 400 })
		const runOnChat = await post('/v1/workflows/run', { inputs: {}, user: 'u' })
		expect(await runOnChat.json()).toMatchObject({ code: 'not_workflow_app', status: 400 })
	})

	it('scopes conversations per end user and per app', async () => {
		await chat('', 'alice', 'hi from alice')
		await chat('', 'bob', 'hi from bob')
		await chat('/agent', 'alice', 'hi agent')
		expect((await conversations('', 'alice')).data.map(c => c.name)).toEqual(['hi from alice'])
		expect((await conversations('', 'bob')).data.map(c => c.name)).toEqual(['hi from bob'])
		expect((await conversations('/agent', 'alice')).data.map(c => c.name)).toEqual(['hi agent'])
	})

	it('lists the most recently active conversation first and pages with last_id', async () => {
		const first = await chat('', 'alice', 'first')
		await chat('', 'alice', 'second')
		await chat('', 'alice', 'again', first.events[0].conversation_id as string)
		const page = await (await fetch(`${base}/v1/conversations?user=alice&limit=1`)).json()
		expect(page.data.map((c: { name: string }) => c.name)).toEqual(['first'])
		expect(page.has_more).toBe(true)
		const next = await (
			await fetch(`${base}/v1/conversations?user=alice&limit=1&last_id=${page.data[0].id}`)
		).json()
		expect(next.data.map((c: { name: string }) => c.name)).toEqual(['second'])
		expect(next.has_more).toBe(false)
	})

	it('returns each history page oldest first, the latest page first, and pages backward with first_id', async () => {
		const run = await chat('', 'alice', 'history40 start')
		const cid = run.events[0].conversation_id as string
		const url = (extra = '') =>
			`${base}/v1/messages?conversation_id=${cid}&user=alice&limit=3${extra}`
		const queries = (page: { data: { query: string }[] }) => page.data.map(m => m.query)
		// Dify: MessageService.pagination_by_first_id(order="asc") reverses the newest-first query, so a page
		// reads oldest first; the first page holds the latest `limit` messages.
		const latest = await (await fetch(url())).json()
		expect(queries(latest)).toEqual(['earlier 39', 'earlier 40', 'history40 start'])
		expect(latest.has_more).toBe(true)
		// first_id is the first message the client holds (data[0]); the next page is the `limit` before it.
		const older = await (await fetch(url(`&first_id=${latest.data[0].id}`))).json()
		expect(queries(older)).toEqual(['earlier 36', 'earlier 37', 'earlier 38'])
		expect(older.has_more).toBe(true)
		// 41 messages in total: 13 full pages of 3 and a last page of 2 when paging back to the start.
		let page = older
		let pages = 2
		while (page.has_more) {
			page = await (await fetch(url(`&first_id=${page.data[0].id}`))).json()
			pages++
		}
		expect(pages).toBe(14)
		expect(queries(page)).toEqual(['earlier 1', 'earlier 2'])
		const unknown = await fetch(url('&first_id=nope'))
		expect(unknown.status).toBe(404)
		expect(await unknown.json()).toEqual({
			code: 'not_found',
			message: 'First Message Not Exists.',
			status: 404,
		})
		const noConversation = await fetch(`${base}/v1/messages?user=alice`)
		expect(noConversation.status).toBe(400)
		// The item has the ConversationMessageItem fields, including the history shape of agent thoughts.
		expect(latest.data[2]).toMatchObject({
			id: expect.any(String),
			conversation_id: cid,
			answer: 'Echo: history40 start',
			feedback: null,
			message_files: [],
			agent_thoughts: [],
			retriever_resources: [],
			extra_contents: [],
			status: 'normal',
			error: null,
		})
	})

	it('echoes a slowhistory seed at once and delays the history of that conversation by 1.5 s', async () => {
		const started = Date.now()
		const run = await chat('', 'alice', 'slowhistory seed')
		// `slow` alone would stream 40 chunks at 100 ms (4 s); the race marker only slows the history.
		expect(Date.now() - started).toBeLessThan(2000)
		expect(run.events.map(e => e.event)).toEqual(['message', 'message', 'message_end'])
		const asked = Date.now()
		const history = await fetch(
			`${base}/v1/messages?conversation_id=${run.events[0].conversation_id}&user=alice`,
		)
		expect(Date.now() - asked).toBeGreaterThanOrEqual(1400)
		expect((await history.json()).data[0].answer).toBe('Echo: slowhistory seed')
	})

	it("fails the first history load of a brokenhistory conversation with Dify's 404, then answers", async () => {
		const run = await chat('', 'alice', 'brokenhistory seed')
		expect(run.events.map(e => e.event)).toEqual(['message', 'message', 'message_end'])
		const url = `${base}/v1/messages?conversation_id=${run.events[0].conversation_id}&user=alice`
		const failed = await fetch(url)
		expect(failed.status).toBe(404)
		expect(await failed.json()).toEqual({
			code: 'not_found',
			message: 'Conversation Not Exists.',
			status: 404,
		})
		const retried = await fetch(url)
		expect(retried.status).toBe(200)
		expect((await retried.json()).data[0].answer).toBe('Echo: brokenhistory seed')
	})

	it('answers the retired reset route like any unknown route (the late-history race is fixed)', async () => {
		const reset = await post('/v1/__e2e/reset', {})
		expect(reset.status).toBe(404)
	})

	it('stores agent thoughts, files and citations the way GET /messages returns them', async () => {
		const agent = await chat('/agent', 'alice', 'think')
		const agentCid = agent.events[0].conversation_id as string
		const agentHistory = await (
			await fetch(`${base}/v1/agent/messages?conversation_id=${agentCid}&user=alice`)
		).json()
		expect(agentHistory.data[0].agent_thoughts).toHaveLength(2)
		expect(agentHistory.data[0].agent_thoughts[1]).toMatchObject({
			position: 2,
			tool: 'web_search',
			tool_labels: {},
			files: [],
			chain_id: null,
		})
		const filed = await chat('', 'alice', 'send files')
		const cited = await chat('', 'alice', 'cite this')
		const history = (cid: string) =>
			fetch(`${base}/v1/messages?conversation_id=${cid}&user=alice`).then(r => r.json())
		expect(
			(await history(filed.events[0].conversation_id as string)).data[0].message_files,
		).toEqual([
			expect.objectContaining({
				belongs_to: 'assistant',
				type: 'image',
				filename: 'stub-image.png',
			}),
		])
		const stored = (await history(cited.events[0].conversation_id as string)).data[0]
			.retriever_resources as Record<string, unknown>[]
		expect(stored).toHaveLength(2)
		// The history row has an id; the streamed citation does not.
		expect(stored.map(r => typeof r.id)).toEqual(['string', 'string'])
		const streamed = cited.events.at(-1) as unknown as {
			metadata: { retriever_resources: object[] }
		}
		expect(streamed.metadata.retriever_resources[0]).not.toHaveProperty('id')
	})

	it('records feedback per message and answers an unknown message with Dify 404', async () => {
		const run = await chat('', 'alice', 'rate me')
		const messageId = run.events[0].message_id as string
		const rated = await post(`/v1/messages/${messageId}/feedbacks`, {
			rating: 'like',
			user: 'alice',
		})
		expect(await rated.json()).toEqual({ result: 'success' })
		const history = await (
			await fetch(`${base}/v1/messages?conversation_id=${run.events[0].conversation_id}&user=alice`)
		).json()
		expect(history.data[0].feedback).toEqual({ rating: 'like' })
		const other = await post(`/v1/messages/${messageId}/feedbacks`, { rating: 'like', user: 'bob' })
		expect(other.status).toBe(404)
		expect(await other.json()).toMatchObject({ code: 'not_found', status: 404 })
	})

	it('renames a conversation and deletes it with 204', async () => {
		const run = await chat('', 'alice', 'name me')
		const cid = run.events[0].conversation_id as string
		const renamed = await post(`/v1/conversations/${cid}/name`, { name: 'Renamed', user: 'alice' })
		expect(await renamed.json()).toMatchObject({ id: cid, name: 'Renamed', status: 'normal' })
		const removed = await fetch(`${base}/v1/conversations/${cid}`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ user: 'alice' }),
		})
		expect(removed.status).toBe(204)
		expect((await conversations('', 'alice')).data).toHaveLength(0)
	})

	it('offers suggestions only where the parameters enable them', async () => {
		const plain = await chat('', 'alice', 'hello')
		const disabled = await fetch(
			`${base}/v1/messages/${plain.events[0].message_id}/suggested?user=alice`,
		)
		expect(disabled.status).toBe(400)
		expect(await disabled.json()).toMatchObject({ code: 'bad_request', status: 400 })
		const flow = await chat('/chatflow', 'alice', 'hello')
		const enabled = await fetch(
			`${base}/v1/chatflow/messages/${flow.events[0].message_id}/suggested?user=alice`,
		)
		expect(await enabled.json()).toEqual({
			result: 'success',
			data: ['Why is that?', 'Can you give an example?'],
		})
	})

	it('opens streams of workflow-based apps with an event: ping frame and the others with data', async () => {
		expect((await chat('/chatflow', 'alice', 'hello')).openedWithPing).toBe(true)
		expect((await chat('', 'alice', 'hello')).openedWithPing).toBe(false)
		expect((await chat('/agent', 'alice', 'hello')).openedWithPing).toBe(false)
		const run = await readStream(
			await post('/v1/workflow/workflows/run', { inputs: { topic: 'tea' }, user: 'alice' }),
		)
		expect(run.openedWithPing).toBe(true)
		expect(run.events.at(-1)?.event).toBe('workflow_finished')
		const completion = await readStream(
			await post('/v1/completion/completion-messages', { inputs: { topic: 'tea' }, user: 'alice' }),
		)
		expect(completion.openedWithPing).toBe(false)
		expect(completion.events.map(e => e.event)).toEqual(['message', 'message', 'message_end'])
	})

	it('refuses a run whose topic is `invalid` with Dify 400 invalid_param before any stream', async () => {
		for (const path of ['/v1/workflow/workflows/run', '/v1/completion/completion-messages']) {
			const refused = await post(path, { inputs: { topic: 'invalid tea' }, user: 'alice' })
			expect(refused.status).toBe(400)
			expect(await refused.json()).toEqual({
				code: 'invalid_param',
				message: 'topic is not valid.',
				status: 400,
			})
		}
	})

	it('runs the human-input flow: pause, form, one submission, resumed stream, answer in history', async () => {
		const run = await chat('/chatflow', 'alice', 'please hitl')
		const required = run.events.find(e => e.event === 'human_input_required') as unknown as {
			workflow_run_id: string
			data: { form_token: string }
		}
		const token = required.data.form_token
		const messages = async () =>
			(
				await (
					await fetch(
						`${base}/v1/chatflow/messages?conversation_id=${run.events[0].conversation_id}&user=alice`,
					)
				).json()
			).data as { answer: string; extra_contents: Record<string, unknown>[] }[]
		// Paused: the history carries the form's definition (HumanInputContent, not submitted yet).
		expect((await messages())[0].extra_contents).toEqual([
			{
				type: 'human_input',
				workflow_run_id: required.workflow_run_id,
				submitted: false,
				form_definition: required.data,
				form_submission_data: null,
			},
		])
		const form = await (await fetch(`${base}/v1/chatflow/form/human_input/${token}`)).json()
		expect(form).toMatchObject({
			form_content: expect.any(String),
			user_actions: [{ id: 'approve' }, { id: 'reject' }],
			resolved_default_values: { feedback: '' },
			expiration_time: expect.any(Number),
		})
		const invalid = await post(`/v1/chatflow/form/human_input/${token}`, {
			action: 'nope',
			inputs: {},
			user: 'alice',
		})
		expect(invalid.status).toBe(400)
		expect(await invalid.json()).toMatchObject({ code: 'invalid_form_data' })
		const submitted = await post(`/v1/chatflow/form/human_input/${token}`, {
			action: 'approve',
			inputs: { feedback: 'ship it', priority: 'high' },
			user: 'alice',
		})
		expect(await submitted.json()).toEqual({})
		// Submitted: the history carries the submission instead (`form_definition` null, per the document).
		expect((await messages())[0].extra_contents).toEqual([
			{
				type: 'human_input',
				workflow_run_id: required.workflow_run_id,
				submitted: true,
				form_definition: null,
				form_submission_data: {
					node_id: 'review',
					node_title: 'Review',
					action_id: 'approve',
					action_text: 'Approve',
					rendered_content: 'Review: ship it (high)',
				},
			},
		])
		const again = await post(`/v1/chatflow/form/human_input/${token}`, {
			action: 'approve',
			inputs: {},
			user: 'alice',
		})
		expect(again.status).toBe(412)
		expect(await again.json()).toMatchObject({ code: 'human_input_form_submitted' })

		const wrongUser = await fetch(
			`${base}/v1/chatflow/workflow/${required.workflow_run_id}/events?user=bob`,
		)
		expect(wrongUser.status).toBe(404)
		const resumed = await readStream(
			await fetch(`${base}/v1/chatflow/workflow/${required.workflow_run_id}/events?user=alice`),
		)
		expect(resumed.openedWithPing).toBe(true)
		expect(resumed.events.map(e => e.event)).toEqual([
			'workflow_started',
			'human_input_form_filled',
			'node_finished',
			'node_started',
			'message',
			'message',
			'node_finished',
			'message_end',
			'workflow_finished',
		])
		expect((await messages())[0].answer).toBe('Approved: ship it')
		// Forms are one-shot: after the resume the form stays and answers 412 as submitted.
		const submittedAgain = await fetch(`${base}/v1/chatflow/form/human_input/${token}`)
		expect(submittedAgain.status).toBe(412)
		expect(await submittedAgain.json()).toMatchObject({
			code: 'human_input_form_submitted',
			status: 412,
		})
		// A finished run answers a single workflow_finished instead of replaying the resumed stream.
		const finished = await readStream(
			await fetch(`${base}/v1/chatflow/workflow/${required.workflow_run_id}/events?user=alice`),
		)
		expect(finished.events.map(e => e.event)).toEqual(['workflow_finished'])
	})

	it('describes an uploaded file back with 201 and answers an empty upload with Dify 400', async () => {
		const form = new FormData()
		form.append('user', 'alice')
		form.append('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
		const uploaded = await fetch(`${base}/v1/files/upload`, { method: 'POST', body: form })
		expect(uploaded.status).toBe(201)
		expect(await uploaded.json()).toMatchObject({
			id: expect.any(String),
			name: 'notes.txt',
			size: 5,
			extension: 'txt',
			mime_type: 'text/plain',
		})
		const empty = await fetch(`${base}/v1/files/upload`, { method: 'POST', body: new FormData() })
		expect(empty.status).toBe(400)
		expect(await empty.json()).toMatchObject({ code: 'no_file_uploaded', status: 400 })
	})
})
