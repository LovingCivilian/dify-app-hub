'use client'

import { XStream } from '@ant-design/x-sdk'
import { App } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import { apiInputs, pendingFileInputs } from '../chat-view/inputs-values'
import { parseEvent } from '../provider/dify-chat-provider'
import { envelopeError, toDifyError } from './dify-errors'
import { initialRunState, reduceRunEvent, type RunState } from './run-reducer'

/**
 * Runs a workflow app (POST /workflows/run) or a completion app (POST /completion-messages) and folds the
 * answer's server-sent events, read with x-sdk's XStream, into a RunState (spec §4.8). No useXChat: a run
 * is not a conversation.
 *
 * Each run has its own AbortController: stop(), a new run and unmounting abort it, which cancels the
 * response body (and so the fetch) and keeps anything of that run from reaching the state. The Dify run
 * itself goes on: the workflow and completion stop endpoints have no proxy route (spec §4.8, §12).
 */
export const useWorkflowRun = () => {
	const { t } = useTranslation()
	const { message: toast } = App.useApp()
	const { app, parameters, difyApi } = useAppContext()
	const [state, setState] = useState<RunState>(initialRunState)
	const controller = useRef<AbortController | null>(null)
	const mode = app.mode
	const form = parameters.user_input_form

	useEffect(() => () => controller.current?.abort(), [])

	/**
	 * Starts a run with the form's values; false when it did not start because a file input is still
	 * uploading or failed (the same refusal as the chat's send: apiInputs would leave those files out).
	 */
	const run = useCallback(
		async (values: Record<string, unknown>): Promise<boolean> => {
			const pending = pendingFileInputs(form, values)
			if (pending.uploading.length || pending.failed.length) {
				toast.error(
					t(pending.uploading.length ? 'sender.wait_for_uploads' : 'sender.remove_failed_uploads'),
				)
				return false
			}
			controller.current?.abort()
			const current = new AbortController()
			controller.current = current
			const { signal } = current
			const update = (next: (state: RunState) => RunState) => {
				if (!signal.aborted) setState(next)
			}
			setState({ ...initialRunState, status: 'running' })
			// File inputs go as Dify's file objects (OpenAPI InputFileObject), like the chat's inputs.
			const inputs = apiInputs(form, values)
			try {
				const response =
					mode === 'workflow'
						? await difyApi.runWorkflow({ inputs })
						: await difyApi.completion({ inputs })
				if (signal.aborted) {
					await response.body?.cancel().catch(() => {})
					return true
				}
				// The proxy passes Dify's status and error body through (`{ code, message, status }`); its own
				// failures answer `{ error }`, which has no text to show (the view uses the generic one).
				if (!response.ok || !response.body) {
					const body: unknown = await response.json().catch(() => null)
					update(s => ({
						...s,
						status: 'failed',
						error: envelopeError(body, response.status).message,
					}))
					return true
				}
				// XStream yields the SSE parts as `{ event?, data? }`; its reader is a standard ReadableStream
				// reader, whose cancel() also cancels the response body it reads from.
				const reader = XStream({ readableStream: response.body }).getReader()
				const cancel = () => void reader.cancel().catch(() => {})
				signal.addEventListener('abort', cancel, { once: true })
				try {
					for (;;) {
						const { done, value } = await reader.read()
						if (done || signal.aborted) break
						// `event: ping` parts carry no data; `[DONE]` and junk parse to null.
						const event = parseEvent(value?.data)
						if (event) update(s => reduceRunEvent(s, event))
					}
				} finally {
					signal.removeEventListener('abort', cancel)
				}
				// A stream that closed without its closing event has ended all the same.
				update(s => (s.status === 'running' ? { ...s, status: 'finished' } : s))
			} catch (error) {
				// A network failure keeps no text (the view shows the generic one).
				update(s => ({ ...s, status: 'failed', error: toDifyError(error).message }))
			}
			return true
		},
		[difyApi, form, mode, t, toast],
	)

	/** Cancels the response body and marks the run stopped; what arrived so far stays. */
	const stop = useCallback(() => {
		const current = controller.current
		if (!current || current.signal.aborted) return
		current.abort()
		setState(s => (s.status === 'running' ? { ...s, status: 'stopped' } : s))
	}, [])

	const reset = useCallback(() => {
		controller.current?.abort()
		setState(initialRunState)
	}, [])

	return { state, run, stop, reset }
}
