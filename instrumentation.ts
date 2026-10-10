/**
 * Next calls register() once when a server instance starts, in every runtime ("Next.js calls `register` in all
 * environments, so it's important to conditionally import any code that doesn't support specific runtimes",
 * node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). The directory schedule runs in the Node runtime
 * only (ADR-0029); NEXT_RUNTIME is Next's own variable, read here as the guide shows, beside lib/env.ts. Decision ai:
 * nothing escapes, since a failing register() stops the server from starting.
 */
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== 'nodejs') return
	try {
		const { startDirectorySchedule } = await import('./lib/directory/schedule')
		startDirectorySchedule()
	} catch (error) {
		// Final review M9: logged through describeError (decision g), so the cause stays readable without a secret.
		// lib/error-log.ts imports ldapts, Node-only like the schedule, so it is imported here as well; if it cannot load
		// either, the error's name is logged, and still nothing escapes.
		const described = await import('./lib/error-log').then(
			({ describeError }) => describeError(error),
			() => (error instanceof Error ? error.name : 'unknown error'),
		)
		console.error('instrumentation: the directory schedule did not start:', described)
	}
}
