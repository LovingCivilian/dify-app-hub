import { beforeEach, describe, expect, it, vi } from 'vitest'

// No DOM here (vitest node): useTransition is replaced by a start function that runs the action at once and keeps
// the promise React would receive, so the test sees both what `run` resolves and what React is handed.
const { started } = vi.hoisted(() => ({ started: [] as Promise<void>[] }))
vi.mock('react', async importOriginal => ({
	...(await importOriginal<typeof import('react')>()),
	useTransition: () => [false, (action: () => Promise<void>) => started.push(action())],
}))

import { useActionTransition } from '@/hooks/use-action-transition'

const PENDING = Symbol('pending')
const settled = (promise: Promise<void>) =>
	Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(PENDING), 20))])

beforeEach(() => {
	started.length = 0
})

describe('useActionTransition', () => {
	it('resolves run once the work is done', async () => {
		const { run } = useActionTransition()
		const work = vi.fn(async () => {})
		await expect(settled(run(work))).resolves.toBeUndefined()
		expect(work).toHaveBeenCalledTimes(1)
	})
	it('still resolves run when the work throws, and hands the error to React', async () => {
		const { run } = useActionTransition()
		const failure = new Error('Failed to find Server Action')
		// A pending promise would keep a Modal's onOk loading over the error page.
		await expect(settled(run(() => Promise.reject(failure)))).resolves.toBeUndefined()
		// The transition's action rejects, so React shows the nearest error boundary (react.dev useTransition).
		await expect(started[0]).rejects.toBe(failure)
	})
})
