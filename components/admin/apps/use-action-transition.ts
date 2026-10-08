'use client'

import { useTransition } from 'react'

/**
 * Runs a Server Action from an event handler inside a transition (Next, Server Actions: invoke from an event
 * handler wrapped in startTransition), so the action's refresh() lands and `pending` covers the round trip.
 * `run` resolves once the work is done, which lets a Modal's onOk keep its loading state. It resolves when the
 * work throws too (a network failure, a stale action id after a deploy): the error still reaches React, which
 * shows the nearest error boundary (react.dev useTransition), and no dialog keeps spinning over it.
 */
export const useActionTransition = () => {
	const [pending, start] = useTransition()
	const run = (work: () => Promise<void>) =>
		new Promise<void>(resolve => {
			start(async () => {
				try {
					await work()
				} finally {
					resolve()
				}
			})
		})
	return { pending, run }
}
