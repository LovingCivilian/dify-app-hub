import 'server-only'

/*
 * The runs this process is streaming, by run id (spec §3.2 step 5, §4.5): the stop route aborts a run's upstream request
 * through its AbortController, and a run stored as `running` that no process holds is truncated by the next request. One
 * map per process; several hub containers would need a shared one (spec §3.2 step 5, a follow-up). The map lives on
 * globalThis so a development reload keeps it, as lib/directory/schedule.ts keeps its job (Rallly's guard).
 */

export type StopReason = 'stop' | 'disconnect'

interface ActiveRun {
	conversationId: string
	controller: AbortController
	reason?: StopReason
}

const globalForRuns = globalThis as unknown as { aiAppHubActiveRuns?: Map<string, ActiveRun> }
const runs = (globalForRuns.aiAppHubActiveRuns ??= new Map<string, ActiveRun>())

export const activeRuns = {
	register(runId: string, entry: { conversationId: string; controller: AbortController }): void {
		runs.set(runId, { ...entry })
	},
	/**
	 * Aborts the run's upstream request; false when this process holds no such run of this conversation. The first reason
	 * stays: a Stop followed by the browser closing the stream is still a Stop. `abort()` takes no reason on purpose: fetch
	 * rejects with the signal's reason (MDN AbortController.abort(): "reason … Defaults to an 'AbortError' DOMException"),
	 * and `@ag-ui/client` recognises an abort by the AbortError's name (src/transform/http.ts, src/agent/agent.ts onError).
	 */
	stop(runId: string, conversationId: string, reason: StopReason): boolean {
		const run = runs.get(runId)
		if (!run || run.conversationId !== conversationId) return false
		run.reason ??= reason
		run.controller.abort()
		return true
	},
	reasonOf(runId: string): StopReason | undefined {
		return runs.get(runId)?.reason
	},
	has(runId: string): boolean {
		return runs.has(runId)
	},
	release(runId: string): void {
		runs.delete(runId)
	},
}
