import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: {
		completionMessages: vi.fn(),
		stopCompletion: vi.fn(),
		runWorkflow: vi.fn(),
		stopWorkflow: vi.fn(),
		workflowEvents: vi.fn(),
		getHumanInputForm: vi.fn(),
		submitHumanInput: vi.fn(),
	},
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/dify/client')>()),
	difyClient: () => client,
}))

import { POST as completion } from '@/app/api/dify/[appId]/completion-messages/route'
import { POST as stopCompletion } from '@/app/api/dify/[appId]/completion-messages/[taskId]/stop/route'
import {
	GET as getForm,
	POST as submitForm,
} from '@/app/api/dify/[appId]/form/human_input/[formToken]/route'
import { GET as events } from '@/app/api/dify/[appId]/workflow/[workflowRunId]/events/route'
import { POST as runWorkflow } from '@/app/api/dify/[appId]/workflows/run/route'
import { POST as stopWorkflow } from '@/app/api/dify/[appId]/workflows/tasks/[taskId]/stop/route'
import { DifyError } from '@/lib/dify/errors'

const USER = 'jane@example.com'
const actor = { id: 'u1', email: USER, name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } }
const base = 'http://app/api/dify/app-1'
const json = (path: string, body: unknown) =>
	new NextRequest(`${base}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
const get = (path: string) => new NextRequest(`${base}${path}`)
const params = <P extends Record<string, string>>(extra?: P) => ({
	params: Promise.resolve({ appId: 'app-1', ...extra } as { appId: string } & P),
})
const stream = () =>
	new Response('event: ping\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })

beforeEach(() => {
	verifySession.mockReset()
	verifySession.mockResolvedValue(actor)
	getAppAccess.mockReset()
	getAppAccess.mockResolvedValue(access)
	for (const fn of Object.values(client)) fn.mockReset()
})

describe('runs', () => {
	it('completion-messages validates, sets the user and passes the stream through', async () => {
		client.completionMessages.mockResolvedValue(stream())
		const response = await completion(
			json('/completion-messages', {
				inputs: { topic: 'tea' },
				response_mode: 'streaming',
				user: 'evil',
			}),
			params(),
		)
		expect(client.completionMessages).toHaveBeenCalledWith(
			{ inputs: { topic: 'tea' }, response_mode: 'streaming' },
			USER,
			expect.any(AbortSignal),
		)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		await expect(response.text()).resolves.toBe('event: ping\n\n')
	})
	it('workflows/run does the same', async () => {
		client.runWorkflow.mockResolvedValue(stream())
		const response = await runWorkflow(
			json('/workflows/run', {
				inputs: { topic: 'tea' },
				response_mode: 'streaming',
				user: 'evil',
			}),
			params(),
		)
		expect(client.runWorkflow).toHaveBeenCalledWith(
			{ inputs: { topic: 'tea' }, response_mode: 'streaming' },
			USER,
			expect.any(AbortSignal),
		)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
	})
	it('answers 400 invalid_param for a body without inputs, without calling Dify', async () => {
		const response = await runWorkflow(
			json('/workflows/run', { response_mode: 'streaming' }),
			params(),
		)
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toMatchObject({ code: 'invalid_param' })
		expect(client.runWorkflow).not.toHaveBeenCalled()
		expect((await completion(json('/completion-messages', {}), params())).status).toBe(400)
		expect(client.completionMessages).not.toHaveBeenCalled()
	})
	it("passes Dify's refusal through before any stream", async () => {
		client.runWorkflow.mockRejectedValue(new DifyError(400, 'invalid_param', 'topic is not valid.'))
		const response = await runWorkflow(
			json('/workflows/run', { inputs: { topic: 'invalid' } }),
			params(),
		)
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toEqual({
			code: 'invalid_param',
			message: 'topic is not valid.',
			status: 400,
		})
	})
	it('the two stops post the task id with the session user', async () => {
		client.stopCompletion.mockResolvedValue({ result: 'success' })
		client.stopWorkflow.mockResolvedValue({ result: 'success' })
		await stopCompletion(json('/completion-messages/t1/stop', {}), params({ taskId: 't1' }))
		expect(client.stopCompletion).toHaveBeenCalledWith('t1', USER)
		const response = await stopWorkflow(
			json('/workflows/tasks/t2/stop', {}),
			params({ taskId: 't2' }),
		)
		expect(client.stopWorkflow).toHaveBeenCalledWith('t2', USER)
		await expect(response.json()).resolves.toEqual({ result: 'success' })
	})
	it('refuses without a session before reading the body', async () => {
		verifySession.mockResolvedValue(null)
		expect((await completion(json('/completion-messages', {}), params())).status).toBe(401)
		expect((await runWorkflow(json('/workflows/run', {}), params())).status).toBe(401)
		expect(client.completionMessages).not.toHaveBeenCalled()
		expect(client.runWorkflow).not.toHaveBeenCalled()
	})
})

describe('workflow events', () => {
	it('validates the flags, sets the user and passes the stream through', async () => {
		client.workflowEvents.mockResolvedValue(stream())
		const response = await events(
			get('/workflow/run-1/events?continue_on_pause=true&user=evil'),
			params({ workflowRunId: 'run-1' }),
		)
		expect(client.workflowEvents).toHaveBeenCalledWith(
			'run-1',
			USER,
			{ continue_on_pause: true },
			expect.any(AbortSignal),
		)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
	})
	it('refuses a flag that is not true/false', async () => {
		const response = await events(
			get('/workflow/run-1/events?continue_on_pause=yes'),
			params({ workflowRunId: 'run-1' }),
		)
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toMatchObject({ code: 'invalid_param' })
		expect(client.workflowEvents).not.toHaveBeenCalled()
	})
})

describe('human input form', () => {
	it('GET answers the definition', async () => {
		const form = {
			form_content: 'Review',
			inputs: [],
			resolved_default_values: {},
			user_actions: [],
			expiration_time: 1,
		}
		client.getHumanInputForm.mockResolvedValue(form)
		const response = await getForm(get('/form/human_input/tok'), params({ formToken: 'tok' }))
		expect(client.getHumanInputForm).toHaveBeenCalledWith('tok')
		await expect(response.json()).resolves.toEqual(form)
	})
	it('POST validates, sets the user, answers {} and passes 412 through', async () => {
		client.submitHumanInput.mockResolvedValue({})
		const response = await submitForm(
			json('/form/human_input/tok', {
				inputs: { feedback: 'ok' },
				action: 'approve',
				user: 'evil',
			}),
			params({ formToken: 'tok' }),
		)
		expect(client.submitHumanInput).toHaveBeenCalledWith(
			'tok',
			{ inputs: { feedback: 'ok' }, action: 'approve' },
			USER,
		)
		await expect(response.json()).resolves.toEqual({})
		client.submitHumanInput.mockRejectedValue(
			new DifyError(412, 'human_input_form_expired', 'This form has expired.'),
		)
		const refused = await submitForm(
			json('/form/human_input/tok', { inputs: {}, action: 'approve' }),
			params({ formToken: 'tok' }),
		)
		expect(refused.status).toBe(412)
		await expect(refused.json()).resolves.toEqual({
			code: 'human_input_form_expired',
			message: 'This form has expired.',
			status: 412,
		})
	})
	it('POST refuses a body without an action before calling Dify', async () => {
		const response = await submitForm(
			json('/form/human_input/tok', { inputs: {} }),
			params({ formToken: 'tok' }),
		)
		expect(response.status).toBe(400)
		expect(client.submitHumanInput).not.toHaveBeenCalled()
	})
	it('accepts a form token shaped like ft-<uuid>', async () => {
		const token = 'ft-3b241101-e2bb-4255-8caf-4136c566a962'
		client.getHumanInputForm.mockResolvedValue({})
		const response = await getForm(get(`/form/human_input/${token}`), params({ formToken: token }))
		expect(response.status).toBe(200)
		expect(client.getHumanInputForm).toHaveBeenCalledWith(token)
	})
})

describe('path segments', () => {
	// A bare `.` or `..` collapses in fetch's URL parser, so encoding is not enough: every route with a segment
	// refuses it before the body is read or Dify is called (Task 8's `parsePathParams`).
	const dotDot = '..'
	const refusals = [
		[
			'taskId',
			() => stopCompletion(json('/completion-messages/../stop', {}), params({ taskId: dotDot })),
		],
		[
			'taskId',
			() => stopWorkflow(json('/workflows/tasks/../stop', {}), params({ taskId: dotDot })),
		],
		['workflowRunId', () => events(get('/workflow/../events'), params({ workflowRunId: dotDot }))],
		['formToken', () => getForm(get('/form/human_input/..'), params({ formToken: dotDot }))],
		[
			'formToken',
			() =>
				submitForm(
					json('/form/human_input/..', { inputs: {}, action: 'approve' }),
					params({ formToken: dotDot }),
				),
		],
	] as const
	it.each(refusals)(
		'answers 400 invalid_param naming %s for ".." without calling Dify',
		async (name, call) => {
			const response = await call()
			expect(response.status).toBe(400)
			const body = await response.json()
			expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
			expect(body.message).toContain(name)
			for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled()
		},
	)
	it('validates the segment before the query or the body is read', async () => {
		const badFlag = await events(
			get('/workflow/../events?continue_on_pause=yes'),
			params({ workflowRunId: dotDot }),
		)
		expect((await badFlag.json()).message).toContain('workflowRunId')
		const badBody = await submitForm(
			new NextRequest(`${base}/form/human_input/..`, { method: 'POST', body: 'not json' }),
			params({ formToken: dotDot }),
		)
		expect((await badBody.json()).message).toContain('formToken')
	})
})
