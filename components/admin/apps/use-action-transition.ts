'use client'

import { startTransition, useTransition } from 'react'

/**
 * Runs a Server Action from an event handler inside a transition (Next, Server Actions: invoke from an event
 * handler wrapped in startTransition), so the action's refresh() lands and `pending` covers the round trip.
 * `run` resolves once the work is done, which lets a Modal's onOk keep its loading state.
 */
export const useActionTransition = () => {
	const [pending, start] = useTransition()
	const run = (work: () => Promise<void>) =>
		new Promise<void>(resolve => {
			start(async () => {
				await work()
				resolve()
			})
		})
	return { pending, run }
}

export { startTransition }
