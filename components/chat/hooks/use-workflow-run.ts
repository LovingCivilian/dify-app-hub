'use client'

import { XStream } from '@ant-design/x-sdk'
import { App } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import { apiInputs, pendingFileInputs } from '../chat-view/inputs-values'
import { parseEvent } from '../provider/dify-chat-provider'
import { failureText } from './dify-errors'
import { initialRunState, reduceRunEvent, type RunState } from './run-reducer'

/**
 * Runs a workflow app (POST /workflows/run) or a completion app (POST /completion-messages) and folds the
 * answer's server-sent events, read with x-sdk's XStream, into a RunState (spec §4.8). No useXChat: a run
 * is not a conversation.
 *
 * Each run has its own AbortController: stop(), a new run and unmounting abort it, which cancels the
 * response body (and so the fetch) and keeps anything of that run from reaching the state. stop() also
 * posts Dify's stop for the run's task, so the run ends on the server too (charter §4.1).
 */
export const useWorkflowRun = () => {
	const { t } = useTranslation()
	const { message: toast } = App.useApp()
	const { app, parameters, difyApi } = useAppContext()
	const [state, setState] = useState<RunState>(initialRunState)
	const controller = useRef<AbortController | null>(null)
	// The committed run, read by stop() (React: refs are written in effects, read in event handlers).
	const latest = useRef(state)
	useLayoutEffect(() => {
		latest.current = state
	})
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
				// The browser client rejects a non-OK answer with DifyRequestError (caught below); an answer
				// without a body has no text to show (the view uses the generic one).
				if (!response.body) {
					update(s => ({ ...s, status: 'failed', error: '' }))
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
				// The failure's text; '' for a network failure or the like (the view shows the generic one).
				update(s => ({ ...s, status: 'failed', error: failureText(error, t) }))
			}
			return true
		},
		[difyApi, form, mode, t, toast],
	)

	/**
	 * Cancels the response body, marks the run stopped, and tells Dify to stop the task (its answer is not
	 * needed). The stop is posted here, once per click, never inside the state updater: React calls updaters
	 * twice in Strict Mode, and they must stay pure.
	 */
	const stop = useCallback(() => {
		const current = controller.current
		if (!current || current.signal.aborted) return
		current.abort()
		const { status, taskId } = latest.current
		setState(s => (s.status === 'running' ? { ...s, status: 'stopped' } : s))
		// A run that has not received its first event has no task id yet: nothing runs on Dify to stop.
		if (status !== 'running' || !taskId) return
		const stopOnDify =
			mode === 'workflow' ? difyApi.stopWorkflow(taskId) : difyApi.stopCompletion(taskId)
		void stopOnDify.catch(() => undefined)
	}, [difyApi, mode])

	const reset = useCallback(() => {
		controller.current?.abort()
		setState(initialRunState)
	}, [])

	return { state, run, stop, reset }
}
